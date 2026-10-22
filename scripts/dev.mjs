import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const project = process.cwd();
if (process.platform === 'win32') {
  const identity = createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0, 16);
  const cacheRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'RobloxAIStudio', identity);
  const cache = path.join(cacheRoot, '.next');
  const local = path.join(project, '.next');
  mkdirSync(cache, { recursive: true });
  const modules = path.join(cacheRoot, 'node_modules');
  if (!existsSync(modules)) symlinkSync(path.join(project, 'node_modules'), modules, 'junction');
  if (existsSync(local) && realpathSync(local).toLowerCase() !== realpathSync(cache).toLowerCase()) {
    if (lstatSync(local).isSymbolicLink()) throw new Error('Vorhandene .next-Verknüpfung zeigt auf einen anderen Cache. Bitte manuell prüfen.');
    const backup = path.join(project, `.next-backup-${Date.now()}`);
    renameSync(local, backup);
    console.log(`Bisheriger Buildcache gesichert: ${backup}`);
  }
  if (!existsSync(local)) symlinkSync(cache, local, 'junction');
  console.log(`Next.js-Cache ausserhalb von OneDrive: ${cache}`);
}
const child = spawn(process.execPath, [path.join(project, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
