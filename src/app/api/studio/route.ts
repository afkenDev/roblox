import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { snapshot, getSettings, runTask } from "@/lib/studio";
import { cancelRun, isRunActive } from "@/lib/codex-process.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const gameSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(1000), directory: z.string().trim().max(1000) });
const operationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("game"), id: z.string().optional(), data: gameSchema }),
  z.object({ action: z.literal("task"), prompt: z.string().trim().min(3).max(5000), gameId: z.string().nullable() }),
  z.object({ action: z.literal("status"), id: z.string(), status: z.enum(["BACKLOG", "PLANNED", "REVIEW", "DONE", "FAILED"]) }),
  z.object({ action: z.literal("queue"), running: z.boolean() }),
  z.object({ action: z.literal("settings"), routing: z.enum(["mock", "codex"]), automation: z.literal(false), publishingLocked: z.literal(true) }),
  z.object({ action: z.literal("run"), id: z.string(), confirmed: z.literal(true), simulateFailure: z.boolean(), provider: z.enum(["mock", "codex"]).default("mock"), directory: z.string().default(""), prompt: z.string().default("") }),
  z.object({ action: z.literal("cancel"), id: z.string(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("recover") })
]);
export async function GET() {
  try { return NextResponse.json(await snapshot()); }
  catch { return NextResponse.json({ error: "SQLite ist nicht verfügbar. Bitte npm run db:setup ausführen." }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || (origin && origin !== `http://${host}`)) return NextResponse.json({ error: "Fremder Ursprung ist nicht erlaubt." }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "JSON erforderlich." }, { status: 415 });
  try {
    const body = operationSchema.parse(await request.json());
    if (body.action === "game") {
      if (body.data.directory) {
        if (!path.isAbsolute(body.data.directory)) throw new Error("Bitte einen absoluten lokalen Verzeichnispfad angeben.");
        try { if (!(await stat(body.data.directory)).isDirectory()) throw new Error(); }
        catch { throw new Error("Das Projektverzeichnis existiert nicht oder ist nicht zugänglich."); }
      }
      await db.$transaction(async transaction => {
        if (body.id) await transaction.game.update({ where: { id: body.id }, data: body.data });
        else await transaction.game.create({ data: body.data });
        await transaction.activity.create({ data: { message: `Game ${body.id ? "aktualisiert" : "angelegt"}: ${body.data.name}` } });
      });
    } else if (body.action === "task") {
      await db.$transaction(async transaction => {
        await transaction.task.create({ data: { title: body.prompt.slice(0, 100), prompt: body.prompt, gameId: body.gameId } });
        await transaction.activity.create({ data: { message: `Aufgabe erstellt: ${body.prompt.slice(0, 100)}` } });
      });
    } else if (body.action === "status") {
      await db.$transaction(async transaction => {
        const task = await transaction.task.findUniqueOrThrow({ where: { id: body.id } });
        if (task.status === "RUNNING") throw new Error("Ein laufender Task kann nicht verschoben werden.");
        if (body.status === "DONE" && task.status !== "REVIEW") throw new Error("Bitte die Aufgabe zuerst im Review prüfen.");
        await transaction.task.update({ where: { id: body.id }, data: { status: body.status } });
        await transaction.activity.create({ data: { message: `${task.title}: ${body.status}` } });
      });
    } else if (body.action === "queue") {
      await getSettings();
      await db.$transaction([
        db.settings.update({ where: { id: 1 }, data: { queueRunning: body.running } }),
        db.activity.create({ data: { message: body.running ? "Warteschlange freigegeben. Jeder Lauf benötigt eine Bestätigung." : "Warteschlange pausiert. Laufende Simulationen werden abgeschlossen." } })
      ]);
    } else if (body.action === "settings") {
      await getSettings();
      await db.settings.update({ where: { id: 1 }, data: { routing: body.routing, automation: false, publishingLocked: true } });
      await db.activity.create({ data: { message: "Einstellungen gespeichert." } });
    } else if (body.action === "run") await runTask(body.id, body.simulateFailure, body.provider, body.directory, body.prompt);
    else if (body.action === "cancel") {
      const run = await db.run.findUniqueOrThrow({ where: { id: body.id } });
      if (run.status !== "RUNNING" || run.provider !== "codex") throw new Error("Kein laufender Codex-Prozess.");
      await cancelRun(run.id);
      await db.activity.create({ data: { message: `Abbruch angefordert: ${run.id}` } });
    }
    else if (body.action === "recover") {
      const stale = await db.run.findMany({ where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - 60_000) } } });
      await db.$transaction(async transaction => {
        for (const run of stale) {
          if (isRunActive(run.id, run.processId)) continue;
          await transaction.run.update({ where: { id: run.id }, data: { status: "FAILED", output: "Unterbrochener Lauf manuell zurückgesetzt. Letzter Checkpoint bleibt erhalten.", finishedAt: new Date() } });
          await transaction.task.update({ where: { id: run.taskId }, data: { status: "FAILED" } });
        }
        await transaction.activity.create({ data: { message: "Wiederherstellung geprüft. Aktive Prozesse werden nicht zurückgesetzt." } });
      });
    }
    return NextResponse.json(await snapshot());
  } catch (error) {
    const message = error instanceof z.ZodError ? "Ungültige Eingabe. Bitte Pflichtfelder und Werte prüfen." : error instanceof Error ? error.message : "Aktion fehlgeschlagen.";
    return NextResponse.json({ error: message.includes("prisma.") ? "Datenbankaktion fehlgeschlagen. Bitte Auswahl aktualisieren und erneut versuchen." : message }, { status: 400 });
  }
}
