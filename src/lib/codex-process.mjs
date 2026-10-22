import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const executeFile = promisify(execFile);
const registry = globalThis.__studioProcesses ??= new Map();
const executable = () => process.env.CODEX_EXECUTABLE || (process.platform === 'win32' ? 'codex.exe' : 'codex');
function childEnvironment() {
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'COMSPEC', 'USERNAME', 'USERDOMAIN', 'CODEX_HOME']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}
let cachedStatus;
let statusPromise;

export async function codexStatus() {
  if (cachedStatus && Date.now() - cachedStatus.checkedAt < 30000) return cachedStatus;
  if (statusPromise) return statusPromise;
  statusPromise = (async () => {
    try {
      const options = { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 };
      const help = await executeFile(executable(), ['exec', '--help'], options);
      if (!help.stdout.includes('--ignore-user-config')) throw new Error('Bitte die Codex-CLI aktualisieren: --ignore-user-config wird benötigt.');
      const login = await executeFile(executable(), ['login', 'status'], options);
      if (!/Logged in using ChatGPT/i.test(login.stdout + login.stderr)) throw new Error('Bitte Codex mit ChatGPT anmelden: codex login. API-Key-Anmeldungen werden hier nicht verwendet.');
      const version = await executeFile(executable(), ['--version'], options);
      return { available: true, message: 'Mit ChatGPT angemeldet', version: version.stdout.trim(), checkedAt: Date.now() };
    } catch (error) {
      return { available: false, message: error.code === 'ENOENT' ? 'Codex-CLI nicht gefunden. CODEX_EXECUTABLE serverseitig setzen.' : 'Codex nicht bereit. CLI aktualisieren und codex login status im Terminal prüfen.', version: '', checkedAt: Date.now() };
    }
  })();
  try { cachedStatus = await statusPromise; return cachedStatus; } finally { statusPromise = undefined; }
}

export async function projectDirectory(directory) {
  if (!directory || !path.isAbsolute(directory)) throw new Error('Codex benötigt ein zugeordnetes absolutes Projektverzeichnis.');
  const resolved = await realpath(directory);
  if (!(await stat(resolved)).isDirectory()) throw new Error('Das Projektverzeichnis ist kein Ordner.');
  if (resolved === path.parse(resolved).root || resolved.toLowerCase() === os.homedir().toLowerCase()) throw new Error('Bitte einen konkreten Projektordner wählen, nicht das Laufwerk oder Benutzerverzeichnis.');
  return resolved;
}

export function codexArguments(directory) {
  const overrides = [
    'approval_policy="never"', 'sandbox_workspace_write.network_access=false',
    'sandbox_workspace_write.writable_roots=[]', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
    'sandbox_workspace_write.exclude_slash_tmp=true', 'mcp_servers={}', 'web_search="disabled"',
    'features.apps=false', 'features.plugins=false', 'features.hooks=false',
    'features.browser_use=false', 'features.computer_use=false', 'features.in_app_browser=false',
    'features.multi_agent=false', 'features.skill_mcp_dependency_install=false',
    'features.remote_plugin=false', 'features.image_generation=false',
    'shell_environment_policy.inherit="core"', 'shell_environment_policy.ignore_default_excludes=false',
  ];
  if (process.platform === 'win32') overrides.push('windows.sandbox="mxc"');
  return ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json', '--color', 'never', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', directory, ...overrides.flatMap(value => ['-c', value]), '-'];
}

export function isRunActive(runId, processId) {
  if (registry.has(runId)) return true;
  if (!processId) return false;
  try { process.kill(processId, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    await executeFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
  } else child.kill('SIGTERM');
}

export async function cancelRun(runId) {
  const entry = registry.get(runId);
  if (!entry) throw new Error('Dieser Lauf gehört nicht zum aktuellen Serverprozess. Unterbrochene Prozesse bitte im Terminal beenden und danach wiederherstellen.');
  entry.cancelled = true;
  await terminate(entry.child);
}

export async function executeCodex({ runId, directory, prompt, onCheckpoint, onProcess, command = executable(), args = codexArguments(directory), timeout = 20 * 60 * 1000 }) {
  const child = spawn(command, args, { cwd: directory, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnvironment() });
  const entry = { child, cancelled: false };
  registry.set(runId, entry);
  let buffer = '', stderr = '', output = '', failure = '', completed = false;
  let pending = Promise.resolve();
  const report = message => { pending = pending.then(() => onCheckpoint(message)).catch(() => { failure = 'Checkpoint konnte nicht gespeichert werden.'; void terminate(child).catch(() => {}); }); };
  const consume = line => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'thread.started') report('Codex-Sitzung gestartet.');
    if (event.type === 'item.started') report(`Codex arbeitet: ${event.item?.type ?? 'Schritt'}`);
    if (event.type === 'item.completed') {
      if (event.item?.type === 'agent_message') { output = String(event.item.text ?? '').slice(-100000); report(output.slice(0, 500)); }
      else report(`Codex-Schritt abgeschlossen: ${event.item?.type ?? 'Schritt'}`);
    }
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'turn.failed' || event.type === 'error') failure = String(event.error?.message ?? event.message ?? 'Codex-Ausführung fehlgeschlagen.').slice(0, 2000);
  };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
    if (buffer.length > 1024 * 1024) { failure = 'Codex-Ereignis überschreitet das Größenlimit.'; void terminate(child).catch(() => {}); }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  child.stdin.on('error', () => {});
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
  void closed.catch(() => {});
  const timer = setTimeout(() => { failure = 'Zeitlimit von 20 Minuten erreicht. Änderungen im Projekt bitte prüfen.'; void terminate(child).catch(() => {}); }, timeout);
  try {
    if (child.pid) await onProcess(child.pid);
    child.stdin.end(`Du bearbeitest genau eine bestätigte Roblox-Aufgabe im aktuellen Projekt.\nLive-Publishing ist gesperrt. Keine Veröffentlichung, kein Deployment, kein git push, keine Cloud- oder Roblox-API-Aufrufe. Keine Zugangsdaten lesen oder anfordern. Keine Hintergrundprozesse oder zusätzlichen Agenten starten. Ändere nur lokale Projektdateien und führe lokale Tests aus. Wenn Sandbox oder fehlende Berechtigungen etwas verhindern, melde die Blockade; umgehe sie nicht. Beschreibe am Ende geänderte Dateien und Tests.\n\nAufgabe:\n${prompt}`);
    const code = await closed;
    consume(buffer); await pending;
    if (entry.cancelled) throw new Error('Codex-Lauf manuell abgebrochen. Bereits geschriebene Änderungen bleiben zur Prüfung erhalten.');
    if (failure || code !== 0 || !completed) throw new Error(failure || `Codex wurde ohne erfolgreichen Abschluss beendet (Exit ${code}). ${stderr.slice(-2000)}`);
    return output || 'Codex abgeschlossen. Bitte lokale Änderungen prüfen.';
  } catch (error) {
    await terminate(child).catch(() => {});
    await closed.catch(() => {});
    throw error;
  } finally { clearTimeout(timer); registry.delete(runId); }
}
