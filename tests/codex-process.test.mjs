import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCodex, codexArguments, cancelRun, projectDirectory, isRunActive } from '../src/lib/codex-process.mjs';

function fixture(script, overrides = {}) {
  return executeCodex({ runId: 'fixture', directory: process.cwd(), prompt: 'A task; $(do-not-execute)', onCheckpoint: async () => {}, onProcess: async () => {}, command: process.execPath, args: ['-e', script], ...overrides });
}

test('Codex arguments enforce sandbox, no network and no external tools', () => {
  const args = codexArguments('C:\\Game with spaces');
  assert.ok(args.includes('workspace-write'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(args.includes('mcp_servers={}'));
  assert.ok(args.includes('features.apps=false'));
  assert.ok(args.includes('features.plugins=false'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(!args.some(value => value.includes('dangerously')));
  assert.equal(args.at(-1), '-');
});

test('JSONL handles fragmented events and preserves result', async () => {
  const checkpoints = [];
  const result = await fixture(`process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('{"type":"thread.'); setTimeout(() => { console.log('started"}'); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Result'}})); console.log('{"type":"turn.completed"}'); }, 15); });`, { onCheckpoint: async message => { checkpoints.push(message); } });
  assert.equal(result, 'Result');
  assert.equal(checkpoints.length, 2);
  assert.equal(isRunActive('fixture', null), false);
});

test('failed or incomplete turns cannot appear successful', async () => {
  await assert.rejects(fixture(`console.log('{"type":"turn.failed","error":{"message":"Blocked"}}')`), /Blocked/);
  await assert.rejects(fixture('process.exit(0)'), /ohne erfolgreichen Abschluss/);
  await assert.rejects(fixture('process.exit(2)'), /Exit 2/);
});

test('cancellation terminates only the registered run', async () => {
  const running = fixture('process.stdin.resume(); setInterval(() => {}, 1000)', { onProcess: async () => { await cancelRun('fixture'); } });
  await assert.rejects(running, /manuell abgebrochen/);
  assert.equal(isRunActive('fixture', null), false);
  await assert.rejects(cancelRun('not-owned'), /aktuellen Serverprozess/);
});

test('credentials are not passed into the child environment', async () => {
  const prior = process.env.ROBLOX_TEST_SECRET;
  process.env.ROBLOX_TEST_SECRET = 'must-not-inherit';
  try {
    const result = await fixture(`console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:process.env.ROBLOX_TEST_SECRET ? 'leaked' : 'clean'}})); console.log('{"type":"turn.completed"}');`);
    assert.equal(result, 'clean');
  } finally { if (prior === undefined) delete process.env.ROBLOX_TEST_SECRET; else process.env.ROBLOX_TEST_SECRET = prior; }
});

test('missing executable and checkpoint failure are reported', async () => {
  await assert.rejects(fixture('', { command: 'missing-codex-test-executable' }), /ENOENT/);
  await assert.rejects(fixture(`console.log('{"type":"thread.started"}'); setInterval(() => {}, 1000);`, { onCheckpoint: async () => { throw new Error('database offline'); } }), /Checkpoint/);
});

test('project directory must be a concrete absolute folder', async () => {
  await assert.rejects(projectDirectory('relative'), /absolutes/);
  assert.ok(await projectDirectory(process.cwd()));
});
