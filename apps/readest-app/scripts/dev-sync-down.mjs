import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSyncDevEnvironment } from './sync-dev-env.mjs';

const env = createSyncDevEnvironment();
const dir = join(env.desktop.dataRoot, 'Readest');
const path = join(dir, 'settings.json');
mkdirSync(dir, { recursive: true });
let s = {};
if (existsSync(path)) { try { s = JSON.parse(readFileSync(path, 'utf8')); } catch {} }
s.localSync = { ...(s.localSync || {}), enabled: false };
writeFileSync(path, JSON.stringify(s, null, 2));
console.log('✅ Sync toggle OFF');
