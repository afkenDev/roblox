import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
async function post(body, expected = 200, origin = base) {
  const response = await fetch(`${base}/api/studio`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
test('SQLite, queue, confirmation, review, failures and safety controls', async () => {
  const marker = `Integration-${Date.now()}`;
  const before = await (await fetch(`${base}/api/studio`)).json();
  let gameId;
  try {
    for (const route of ['', '/games', '/tasks', '/agents', '/activity', '/settings']) assert.equal((await fetch(`${base}${route}`)).status, 200);
    await post({ action: 'queue', running: false });
    await post({ action: 'settings', routing: 'mock', automation: true, publishingLocked: false }, 400);
    await post({ action: 'queue', running: true }, 403, 'https://foreign.invalid');
    await post({ action: 'task', prompt: 'x', gameId: null }, 400);
    await post({ action: 'run', id: 'invalid', provider: 'claude', confirmed: true, simulateFailure: false }, 400);
    await post({ action: 'run', id: 'invalid', provider: 'codex', confirmed: false, simulateFailure: false }, 400);
    await post({ action: 'run', id: 'invalid', provider: 'codex', confirmed: true, simulateFailure: false }, 400);
    await post({ action: 'settings', routing: 'codex', automation: false, publishingLocked: true });
    await post({ action: 'settings', routing: 'mock', automation: false, publishingLocked: true });
    await post({ action: 'game', data: { name: marker, description: '', directory: 'relative-path' } }, 400);
    const games = await post({ action: 'game', data: { name: marker, description: 'Test', directory: process.cwd() } });
    gameId = games.games.find(game => game.name === marker).id;
    await post({ action: 'game', id: gameId, data: { name: marker, description: 'Edited', directory: process.cwd() } });
    const created = await post({ action: 'task', prompt: `${marker} Reward system`, gameId });
    const task = created.tasks.find(item => item.gameId === gameId);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'BACKLOG');
    await post({ action: 'run', id: task.id, confirmed: true, simulateFailure: false }, 400);
    await post({ action: 'queue', running: true });
    await post({ action: 'run', id: task.id, confirmed: false, simulateFailure: false }, 400);
    await post({ action: 'status', id: task.id, status: 'DONE' }, 400);
    await post({ action: 'status', id: task.id, status: 'PLANNED' });
    const completed = await post({ action: 'run', id: task.id, confirmed: true, simulateFailure: false });
    assert.equal(completed.tasks.find(item => item.id === task.id).status, 'REVIEW');
    assert.match(completed.runs.find(run => run.taskId === task.id).output, /kein Roblox-Code/);
    await post({ action: 'status', id: task.id, status: 'DONE' });
    const next = await post({ action: 'task', prompt: `${marker} Failure test`, gameId });
    const failedTask = next.tasks.find(item => item.prompt === `${marker} Failure test`);
    const failed = await post({ action: 'run', id: failedTask.id, confirmed: true, simulateFailure: true });
    assert.equal(failed.tasks.find(item => item.id === failedTask.id).status, 'FAILED');
    assert.match(failed.runs.find(run => run.taskId === failedTask.id).checkpoint, /Arbeitsplan/);
    const retried = await post({ action: 'run', id: failedTask.id, confirmed: true, simulateFailure: false });
    assert.equal(retried.tasks.find(item => item.id === failedTask.id).status, 'REVIEW');
    await db.task.update({ where: { id: failedTask.id }, data: { status: 'RUNNING' } });
    await db.run.create({ data: { taskId: failedTask.id, startedAt: new Date(Date.now() - 120000), checkpoint: 'Recovery test' } });
    await post({ action: 'recover' });
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: failedTask.id } })).status, 'FAILED');
    await db.task.update({ where: { id: failedTask.id }, data: { status: 'RUNNING' } });
    const protectedRun = await db.run.create({ data: { taskId: failedTask.id, provider: 'codex', processId: process.pid, startedAt: new Date(Date.now() - 120000) } });
    await post({ action: 'recover' });
    assert.equal((await db.run.findUniqueOrThrow({ where: { id: protectedRun.id } })).status, 'RUNNING');
    assert.equal((await db.settings.findUniqueOrThrow({ where: { id: 1 } })).publishingLocked, true);
  } finally {
    if (gameId) { await db.task.deleteMany({ where: { gameId } }); await db.game.delete({ where: { id: gameId } }); }
    await db.activity.deleteMany({ where: { message: { contains: marker } } });
    await db.settings.update({ where: { id: 1 }, data: { queueRunning: before.settings.queueRunning, routing: before.settings.routing } });
    await db.$disconnect();
  }
});
