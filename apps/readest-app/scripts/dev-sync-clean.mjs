#!/usr/bin/env node

/**
 * dev-sync-clean — Full clean of dev sync state with post-verification.
 *
 * Delegates to dev-sync-reset.mjs, then verifies the result is truly clean.
 *
 * Usage:
 *   node scripts/dev-sync-clean.mjs --target desktop-db --confirm DELETE_DEV_SYNC_STATE --no-dry-run
 *
 * Requires BIBLIOTECA_DEV_SYNC_HARNESS=1 or NODE_ENV=development.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { requireDevHarness, createSyncDevEnvironment } from './sync-dev-env.mjs';
import { verifyCleanState } from './clean-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  requireDevHarness(process.env, 'dev sync clean');

  // Forward relevant flags to reset
  const target = readFlag('--target', 'desktop-db');
  const resetArgs = ['--target', target];
  
  // Pass --confirm, --no-dry-run, etc. through
  const passThrough = ['--confirm', '--no-dry-run'];
  for (const flag of passThrough) {
    const idx = process.argv.indexOf(flag);
    if (idx !== -1) {
      resetArgs.push(flag);
      if (process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
        resetArgs.push(process.argv[idx + 1]);
      }
    }
  }

  // Spawn reset
  const resetScript = join(__dirname, 'dev-sync-reset.mjs');
  const resetResult = spawnSync(process.execPath, [resetScript, ...resetArgs], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
  });

  let resetOutput = null;
  let resetOk = resetResult.status === 0;
  if (resetResult.stdout) {
    try {
      resetOutput = JSON.parse(resetResult.stdout);
    } catch {
      resetOutput = { raw: resetResult.stdout };
    }
  }

  // Determine data root for verification
  let dataRoot = process.env.BIBLIOTECA_DEV_DESKTOP_DB_DIR ||
    process.env.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT;
  if (!dataRoot) {
    dataRoot = createSyncDevEnvironment(process.env).desktop.dataRoot;
  }

  // Verify
  const verification = verifyCleanState(dataRoot);

  const result = {
    ok: resetOk && verification.clean,
    reset: resetOk ? (resetOutput || { ok: true }) : { ok: false, error: resetResult.stderr || 'reset failed' },
    verification,
  };

  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
