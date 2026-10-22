import { existsSync, copyFileSync, readFileSync, mkdirSync, closeSync, openSync } from 'node:fs';
import path from 'node:path';
if (!existsSync('.env')) copyFileSync('.env.example', '.env');
const configured = process.env.DATABASE_URL || readFileSync('.env', 'utf8').match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m)?.[1];
if (!configured?.startsWith('file:')) throw new Error('DATABASE_URL muss eine lokale SQLite file:-URL sein.');
const filename = path.resolve('prisma', configured.slice(5));
mkdirSync(path.dirname(filename), { recursive: true });
if (!existsSync(filename)) closeSync(openSync(filename, 'wx'));
