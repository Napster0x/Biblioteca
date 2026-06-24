#!/usr/bin/env node

/**
 * dev-sync-plan: Dry-run environment planner.
 *
 * Produces a JSON plan with one step per operation.
 * Dangerous operations (build, install, restart, kill) are BLOCKED
 * unless --authorize BIBLIOTECA_DEV_SYNC_PLAN is passed.
 *
 * Usage:
 *   node scripts/dev-sync-plan.mjs --json
 *   node scripts/dev-sync-plan.mjs --json --plan build
 *   node scripts/dev-sync-plan.mjs --json --authorize BIBLIOTECA_DEV_SYNC_PLAN
 */

const AUTH_TOKEN = 'BIBLIOTECA_DEV_SYNC_PLAN';

const OPERATIONS = [
  {
    name: 'build',
    auth: 'token',
    description: 'Build Next.js and Tauri app',
    manual: 'pnpm build && cd src-tauri && cargo build',
    danger: 'Compilation may take 5+ minutes',
  },
  {
    name: 'install',
    auth: 'token',
    description: 'Install APK on Android device',
    manual: 'adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk',
    danger: 'Replaces running app on device',
  },
  {
    name: 'restart',
    auth: 'token',
    description: 'Restart dev:server or dev:tauri or daemon processes',
    manual: 'pkill -f "next dev" && pnpm dev:server',
    danger: 'Terminates and restarts server processes',
  },
  {
    name: 'kill',
    auth: 'token',
    description: 'Kill all dev sync related processes',
    manual: 'pkill -f "dev:sync:"; pkill -f "next dev"; pkill -f cargo',
    danger: 'Terminates all running dev processes globally',
  },
];

function hasFlag(name) {
  return process.argv.includes(name);
}

function getFlagValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx < process.argv.length - 1) return process.argv[idx + 1];
  return null;
}

function main() {
  const json = hasFlag('--json') || !process.stdout.isTTY;
  const authToken = getFlagValue('--authorize');
  const authorized = authToken === AUTH_TOKEN;
  const requestedPlan = getFlagValue('--plan');
  const operations = requestedPlan
    ? OPERATIONS.filter((op) => op.name === requestedPlan)
    : OPERATIONS;

  const steps = operations.map((op) => {
    const needsAuth = op.auth === 'token';
    const isBlocked = needsAuth && !authorized;
    return {
      operation: op.name,
      status: isBlocked ? 'blocked' : 'pass',
      auth: op.auth,
      description: op.description,
      message: isBlocked
        ? `BLOCKED: requires --authorize ${AUTH_TOKEN} — ${op.danger}`
        : authorized
          ? `AUTHORIZED: ${op.manual}`
          : `DRY-RUN: ${op.manual}`,
      manualStep: op.manual,
    };
  });

  const allPass = steps.every((s) => s.status === 'pass');

  if (json) {
    console.log(
      JSON.stringify({ ok: allPass, status: allPass ? 'pass' : 'warn', plan: 'dev-sync-plan', authorized, steps }, null, 2),
    );
    return;
  }

  console.log('=== dev:sync:plan ===\n');
  console.log(`Authorized: ${authorized ? 'YES' : 'NO'}\n`);
  for (const step of steps) {
    const icon = step.status === 'pass' ? '  OK' : 'LOCK';
    console.log(`${icon} ${step.operation}: ${step.message}`);
  }
  if (!authorized) {
    console.log(`\nDangerous operations require: --authorize ${AUTH_TOKEN}`);
  }
}

main();
