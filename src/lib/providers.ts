import { codexStatus, executeCodex } from "./codex-process.mjs";
export interface AgentInput { taskId: string; runId: string; directory: string; prompt: string; simulateFailure: boolean; onProcess: (pid: number) => Promise<void> }
export interface AgentProvider {
  id: string;
  name: string;
  available: boolean;
  execute(input: AgentInput, checkpoint: (message: string) => Promise<void>): Promise<string>;
}
export const mockProvider: AgentProvider = {
  id: "mock", name: "Mock-Agent", available: true,
  async execute(input, checkpoint) {
    await checkpoint("Aufgabe analysiert – Simulation, keine Projektdateien gelesen.");
    await new Promise(resolve => setTimeout(resolve, 700));
    await checkpoint("Arbeitsplan erstellt – keine Dateien verändert.");
    if (input.simulateFailure) throw new Error("Demonstrationsfehler: Der Mock-Lauf wurde absichtlich abgebrochen. Du kannst ihn erneut starten.");
    await new Promise(resolve => setTimeout(resolve, 700));
    return `Mock-Ergebnis für: ${input.prompt}\n\n1. Anforderungen erfasst.\n2. Umsetzung und Tests simuliert.\n3. Bereit zur manuellen Prüfung.\n\nEs wurde kein Roblox-Code generiert, keine Datei verändert und nichts veröffentlicht.`;
  }
};
function disconnected(id: string, name: string): AgentProvider {
  return { id, name, available: false, async execute() { throw new Error(`${name} ist noch nicht verbunden.`); } };
}
export const codexProvider: AgentProvider = {
  id: "codex", name: "Codex", available: true,
  async execute(input, checkpoint) {
    const status = await codexStatus();
    if (!status.available) throw new Error(status.message);
    return executeCodex({ runId: input.runId, directory: input.directory, prompt: input.prompt, onCheckpoint: checkpoint, onProcess: input.onProcess });
  }
};
export const providers = [mockProvider, codexProvider, disconnected("claude", "Claude Code")];
