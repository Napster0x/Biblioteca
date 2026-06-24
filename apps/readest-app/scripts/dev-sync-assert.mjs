#!/usr/bin/env node

/**
 * dev-sync-assert — Compare pre/post state snapshots.
 *
 * Usage:
 *   node scripts/dev-sync-assert.mjs --pre <pre-state.json> --post <post-state.json>
 *
 * Emits PASS (exit 0) or FAIL (exit 1) with diff details.
 * Requires BIBLIOTECA_DEV_SYNC_HARNESS=1 or NODE_ENV=development.
 */

import { existsSync, readFileSync } from 'node:fs';
import { requireDevHarness } from './sync-dev-env.mjs';
import { compareSemanticState, compareSnapshots } from './assert-engine.mjs';

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  requireDevHarness(process.env, 'dev sync assert');

  const prePath = readFlag('--pre', undefined);
  const postPath = readFlag('--post', undefined);
  const desktopPath = readFlag('--desktop', undefined);
  const androidPath = readFlag('--android', undefined);
  const expectDeltaRaw = readFlag('--expect-delta', undefined);

  if (desktopPath || androidPath) {
    if (!desktopPath || !androidPath) {
      console.log(JSON.stringify({ ok: false, error: '--desktop and --android are required together' }));
      process.exit(1);
    }
    if (!existsSync(desktopPath)) {
      console.log(JSON.stringify({ ok: false, error: `Desktop snapshot not found: ${desktopPath}` }));
      process.exit(1);
    }
    if (!existsSync(androidPath)) {
      console.log(JSON.stringify({ ok: false, error: `Android snapshot not found: ${androidPath}` }));
      process.exit(1);
    }
    let desktop;
    let android;
    try {
      desktop = JSON.parse(readFileSync(desktopPath, 'utf8'));
      android = JSON.parse(readFileSync(androidPath, 'utf8'));
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: `Invalid semantic JSON: ${err.message}` }));
      process.exit(1);
    }
    const result = compareSemanticState({ desktop, android });
    console.log(JSON.stringify({ ok: result.verdict === 'PASS', ...result }));
    if (result.verdict !== 'PASS') process.exit(1);
    return;
  }

  if (!prePath || !postPath) {
    console.log(JSON.stringify({ ok: false, error: '--pre and --post are required' }));
    process.exit(1);
  }

  if (!existsSync(prePath)) {
    console.log(JSON.stringify({ ok: false, error: `Pre snapshot not found: ${prePath}` }));
    process.exit(1);
  }
  if (!existsSync(postPath)) {
    console.log(JSON.stringify({ ok: false, error: `Post snapshot not found: ${postPath}` }));
    process.exit(1);
  }

  let pre, post, expectDelta;
  try {
    pre = JSON.parse(readFileSync(prePath, 'utf8'));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: `Invalid pre JSON: ${err.message}` }));
    process.exit(1);
  }
  try {
    post = JSON.parse(readFileSync(postPath, 'utf8'));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: `Invalid post JSON: ${err.message}` }));
    process.exit(1);
  }
  if (expectDeltaRaw) {
    try {
      expectDelta = JSON.parse(expectDeltaRaw);
    } catch {
      console.log(JSON.stringify({ ok: false, error: 'Invalid --expect-delta JSON' }));
      process.exit(1);
    }
  }

  const result = compareSnapshots(pre, post, expectDelta);

  console.log(JSON.stringify({ ok: result.verdict === 'PASS', ...result }));
  if (result.verdict !== 'PASS') process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
