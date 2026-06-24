#!/usr/bin/env node

/**
 * dev-sync-prepare — Import an EPUB file into the desktop dev-sync library.
 *
 * Usage:
 *   node scripts/dev-sync-prepare.mjs --file <path.epub>
 *
 * Requires BIBLIOTECA_DEV_SYNC_HARNESS=1 or NODE_ENV=development.
 */

import { existsSync } from 'node:fs';
import { requireDevHarness, createSyncDevEnvironment } from './sync-dev-env.mjs';
import { extractEpubMetadata, importEpubToLibrary } from './prepare-engine.mjs';

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  requireDevHarness(process.env, 'dev sync prepare');

  const filePath = readFlag('--file', undefined);
  if (!filePath) {
    console.error('--file <path.epub> is required');
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.log(JSON.stringify({ ok: false, error: `File not found: ${filePath}` }));
    process.exit(1);
  }

  const env = createSyncDevEnvironment(process.env);
  const dataRoot = env.desktop.dataRoot;
  const meta = extractEpubMetadata(filePath);

  const result = importEpubToLibrary({
    filePath,
    dataRoot,
    title: meta.title,
    author: meta.author,
    language: meta.language,
  });

  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
