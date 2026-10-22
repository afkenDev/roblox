import { db } from "./db";
import { providers } from "./providers";
import { codexStatus, projectDirectory } from "./codex-process.mjs";

export async function getSettings() { return db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }); }
export async function snapshot() {
  const [games, tasks, runs, activities, settings] = await Promise.all([
    db.game.findMany({ orderBy: { createdAt: "desc" } }),
    db.task.findMany({ include: { game: true }, orderBy: { createdAt: "desc" } }),
    db.run.findMany({ include: { task: true }, orderBy: { startedAt: "desc" }, take: 100 }),
    db.activity.findMany({ orderBy: { createdAt: "desc" }, take: 100 }), getSettings()
  ]);
  return { games, tasks, runs, activities, settings, codex: await codexStatus() };
}
export async function runTask(taskId: string, simulateFailure: boolean, providerId = "mock", confirmedDirectory = "", confirmedPrompt = "") {
  await getSettings();
  const provider = providers.find(item => item.id === providerId);
  if (!provider?.available) throw new Error("Provider nicht verfügbar.");
  let directory = "";
  if (providerId === "codex") {
    if (simulateFailure) throw new Error("Fehlersimulation ist nur beim Mock-Agenten möglich.");
    directory = await projectDirectory(confirmedDirectory);
    const status = await codexStatus();
    if (!status.available) throw new Error(status.message);
  }
  const run = await db.$transaction(async transaction => {
    const settings = await transaction.settings.findUniqueOrThrow({ where: { id: 1 } });
    if (!settings.queueRunning) throw new Error("Die Warteschlange ist pausiert. Bitte zuerst starten.");
    if (await transaction.run.count({ where: { status: "RUNNING" } })) throw new Error("Es läuft bereits eine Aufgabe. Bei einem unterbrochenen Lauf bitte zuerst wiederherstellen.");
    const task = await transaction.task.findUniqueOrThrow({ where: { id: taskId }, include: { game: true } });
    if (providerId === "codex" && (task.game?.directory !== confirmedDirectory || task.prompt !== confirmedPrompt)) throw new Error("Aufgabe oder Projektpfad wurde geändert. Bitte den Lauf erneut prüfen und bestätigen.");
    if (!["BACKLOG", "PLANNED", "FAILED"].includes(task.status)) throw new Error("Nur offene oder fehlgeschlagene Aufgaben können gestartet werden.");
    await transaction.task.update({ where: { id: taskId }, data: { status: "RUNNING" } });
    await transaction.activity.create({ data: { message: `${provider.name}-Lauf manuell gestartet: ${task.title}` } });
    return transaction.run.create({ data: { taskId, provider: providerId, directory }, include: { task: true } });
  });
  try {
    const output = await provider.execute({ taskId, runId: run.id, directory, prompt: run.task.prompt, simulateFailure, onProcess: async processId => { await db.run.update({ where: { id: run.id }, data: { processId } }); } }, async checkpoint => {
      await db.$transaction([
        db.run.update({ where: { id: run.id }, data: { checkpoint } }),
        db.activity.create({ data: { message: `${run.task.title}: ${checkpoint}` } })
      ]);
    });
    await db.$transaction([
      db.run.update({ where: { id: run.id }, data: { status: "COMPLETED", checkpoint: providerId === "mock" ? "Simulation abgeschlossen" : "Codex abgeschlossen – manuelles Review erforderlich", output, finishedAt: new Date() } }),
      db.task.update({ where: { id: taskId }, data: { status: "REVIEW" } }),
      db.activity.create({ data: { message: `Bereit für Review: ${run.task.title}` } })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Agentenfehler";
    await db.$transaction([
      db.run.update({ where: { id: run.id }, data: { status: "FAILED", output: message, finishedAt: new Date() } }),
      db.task.update({ where: { id: taskId }, data: { status: "FAILED" } }),
      db.activity.create({ data: { message, level: "ERROR" } })
    ]);
  }
}
