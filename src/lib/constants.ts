export const statuses = ["BACKLOG", "PLANNED", "RUNNING", "REVIEW", "DONE", "FAILED"] as const;
export const labels: Record<string, string> = { BACKLOG: "Backlog", PLANNED: "Geplant", RUNNING: "In Arbeit", REVIEW: "Review", DONE: "Fertig", FAILED: "Fehlgeschlagen" };
