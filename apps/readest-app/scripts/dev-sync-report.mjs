#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { requireDevHarness } from './sync-dev-env.mjs';
import { buildSyncReport } from './report-engine.mjs';

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function readJson(path, label) {
  if (!path) return undefined;
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

try {
  requireDevHarness(process.env, 'dev sync report');
  const assertions = readJson(readFlag('--assertions', undefined), 'assertions') ?? {};
  const evidence = readJson(readFlag('--evidence', undefined), 'evidence') ?? {};
  const cleanup = readJson(readFlag('--cleanup', undefined), 'cleanup') ?? null;
  const report = buildSyncReport({ assertions, evidence, cleanup });
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict === 'FAIL' || report.verdict === 'AMBIGUOUS') process.exit(1);
} catch (error) {
  console.log(JSON.stringify({ ok: false, verdict: 'FAIL', diagnosis: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
