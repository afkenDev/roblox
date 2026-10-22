# Roblox AI Studio

Lokales Dashboard für Roblox-Projekte, Aufgaben und einzeln bestätigte Mock- oder Codex-Läufe. Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui Button, Lucide, Prisma und SQLite. Kein Cloud-Hosting und keine zusätzlichen API-Keys. Die echte Codex-CLI nutzt deine bestehende ChatGPT-Anmeldung; Modellanfragen und dafür benötigter Projektcode gehen an OpenAI. Die Nutzung unterliegt deinem ChatGPT-Kontingent.

## Windows: Starten

Node.js 20.9 oder neuer installieren (empfohlen: aktuelle LTS-Version). PowerShell im Projektordner öffnen:

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run db:setup
npm.cmd run dev
```

Bei bereits eingerichtetem Projekt reicht `npm.cmd run dev`. URL: http://127.0.0.1:3000. Der Server bindet ausschliesslich an die lokale Loopback-Adresse. Beenden mit Strg+C.

`npm.cmd run dev` startet unter Windows über `scripts/dev.mjs` den regulären Turbopack-Dev-Server. Der Next.js-Cache liegt dauerhaft unter `%LOCALAPPDATA%/RobloxAIStudio/<Projekt-ID>/.next`, ausserhalb von OneDrive. Eine lokale Verzeichnisverknüpfung (Junction) hält den erwarteten Projektpfad `.next` verfügbar. Quellen und SQLite bleiben im Projekt. Ein zuvor vorhandener Cache wird einmalig als `.next-backup-<Zeitstempel>` gesichert und von Git ausgeschlossen. Die Verknüpfung wird bei weiteren Starts wiederverwendet; es werden keine Administratorrechte für eine Junction benötigt. Dadurch werden OneDrive-Reparse-Points in den Build-Unterordnern und der beobachtete Webpack-Manifestfehler vermieden. Hot Reload ist weiterhin aktiv. Für Produktionsbetrieb stehen `npm.cmd run build` und `npm.cmd start` zur Verfügung.

## Bedienung

1. Unter **Games** ein Game anlegen und für Codex ein bestehendes absolutes Projektverzeichnis angeben.
2. Im zentralen Eingabefeld eine Aufgabe beschreiben und optional ein Game zuordnen. Die Aufgabe landet im Backlog. Die natürliche Sprache wird in dieser Version als Aufgabentext gespeichert, nicht durch ein Sprachmodell interpretiert.
3. Die Warteschlange über **Start** freigeben. Es startet noch kein Agent.
4. Eine Aufgabenkarte öffnen, **Agentenlauf starten** wählen, Provider und Projektpfad prüfen und diesen einzelnen Lauf bestätigen. Beim Mock-Agenten kann optional ein Fehler simuliert werden.
5. Nach der Simulation das Ergebnis im Detaildialog prüfen. Erfolgreiche Läufe landen im **Review**. Erst manuell auf **Fertig** setzen.
6. **Pause** sperrt weitere Starts. **Lauf abbrechen** beendet einen laufenden Codex-Prozess inklusive seiner Kindprozesse unter Windows. Bereits geschriebene Dateien bleiben erhalten. Aktivitäten zeigen die letzten 100 Logs und Läufe mit persistierten Checkpoints und dem bestätigten Projektpfad.

Bei einem Serverabbruch bleibt ein laufender Task sichtbar. Unter Aktivitäten können Läufe nach 60 Sekunden manuell als fehlgeschlagen wiederhergestellt werden, sofern kein zugehöriger Prozess mehr lebt. Verwaiste Prozesse nach einem Serverneustart bitte zuerst im Terminal/Task-Manager beenden. Es gibt keine automatische Fortsetzung. Codex-Läufe haben ein Zeitlimit von 20 Minuten.

## Codex verbinden

Eine aktuelle lokale Codex-CLI mit `exec --ignore-user-config` installieren und im Terminal `codex login` ausführen. `codex login status` muss eine ChatGPT-Anmeldung melden. API-Key-Anmeldungen werden von diesem Provider nicht verwendet. Unter Windows muss die native Codex-Sandbox eingerichtet sein; das Studio erzwingt `windows.sandbox="mxc"` und wechselt bei Fehlern niemals auf uneingeschränkten Zugriff.

Wenn `codex.exe` nicht im PATH liegt, in der lokalen `.env` `CODEX_EXECUTABLE` auf den absoluten Pfad der ausführbaren Datei setzen und den Server neu starten. Keine `.cmd`-Wrapper verwenden: Der Prozess startet ohne Shell. Unter **Agenten** erscheint der echte CLI-Anmeldestatus (30 Sekunden Cache). Unter **Einstellungen** lässt sich Codex als Standard-Provider speichern; der Bestätigungsdialog erlaubt weiterhin eine Auswahl pro Lauf.

Das Studio führt ausschliesslich nach Bestätigung `codex exec` im angezeigten Projektordner aus. Der Prompt wird über stdin übergeben. `workspace-write`, gesperrtes Shell-Netzwerk und `approval_policy="never"` verhindern automatische Rechteerweiterungen; nicht erlaubte Aktionen müssen fehlschlagen. Benutzerkonfiguration, Ausführungsregeln, Apps, Plugins, Hooks, Browserwerkzeuge und MCP-Verbindungen werden für diese Läufe deaktiviert. Die Codex-CLI selbst verwaltet ihre vorhandene Anmeldung. Das Studio liest keine Token-Dateien aus und gibt keine Schlüssel an den Browser weiter.

Live-Publishing bleibt gesperrt. Es gibt keinen Publishing-Endpunkt; der Agent erhält zusätzlich ein ausdrückliches Veröffentlichungsverbot. Die Sandbox ist die technische Grenze, keine Textfilterung des Prompts. Verwende ausschliesslich vertrauenswürdige Projektordner und prüfe lokale Änderungen im Review. Die App erstellt keinen automatischen Git-Commit oder Push für Agentenaufgaben.

Offizielle Grundlagen: [Codex Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Windows Sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox).

## Architektur

- `src/app/[[...slug]]/page.tsx`: sechs App-Router-Seiten mit URL-Navigation.
- `src/components/studio.tsx`: Dashboard, Formulare, Kanban und native zugängliche Dialoge.
- `src/components/ui/button.tsx`: anpassbare shadcn/ui-Komponente mit Radix Slot/CVA.
- `src/app/api/studio/route.ts`: validierte JSON-API mit Ursprungskontrolle; keine Secrets im Browser.
- `src/lib/studio.ts`: transaktionale Statuswechsel, Queue-Sperre, Ausführungen und Checkpoints.
- `src/lib/providers.ts`: getrennte Provider für Mock, Codex und deaktiviertes Claude Code.
- `src/lib/codex-process.mjs`: CLI-Prüfung, sichere Prozessargumente, JSONL-Ereignisse, Prozessabbruch und Zeitlimit.
- `prisma/schema.prisma` und `prisma/migrations`: persistentes Datenmodell und versionierte Migration.

Der Mock-Agent analysiert keine Dateien und erzeugt keinen echten Roblox-Code. Codex kann nach Bestätigung tatsächlich Projektdateien bearbeiten. Claude ist weiterhin deaktiviert. Automatik und Veröffentlichung bleiben serverseitig gesperrt. Modellkontingente werden nicht erfunden.

## Prüfung und Produktion

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

`npm.cmd test` führt bei laufendem Entwicklungsserver API-/SQLite-Integrationstests sowie Prozessadapter-Tests mit lokalen Node-Testprozessen aus. Es wird dabei kein echtes Codex-Modell aufgerufen. Die Tests erzeugen kurzzeitig markierte Datensätze und entfernen diese anschliessend. Nicht parallel zu manuellen Aktionen ausführen. Allgemeine Testprotokolle können im Aktivitätsprotokoll verbleiben. Ein echter Codex-Smoke-Test benötigt eine separate ausdrückliche Bestätigung.

Die lokale Datenbank liegt in `prisma/studio.db`. Für eine Sicherung den Server stoppen und die Datenbank kopieren. `.env`, Datenbanken, Build-Ausgaben und Dependencies werden nicht versioniert. Beim Aktualisieren `npm.cmd install` und `npm.cmd run db:setup` ausführen. `package-lock.json` fixiert die installierten Versionen.
