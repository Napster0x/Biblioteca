#!/usr/bin/env node

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const smokeDocPath = join(__dirname, '..', 'docs', 'sync-dev-smoke.md');
const defaultEvidenceDir = '/tmp/biblioteca-dev-sync/smoke';

function createSafeTasks(evidenceDir) {
  return [
    {
      name: 'doctor',
      command: ['pnpm', 'dev:sync:doctor', '--json'],
      mutates: false,
      allowedWithoutAuthorization: true,
      evidencePath: join(evidenceDir, 'doctor.json'),
    },
    {
      name: 'state',
      command: ['pnpm', 'dev:sync:state', '--json'],
      mutates: false,
      allowedWithoutAuthorization: true,
      evidencePath: join(evidenceDir, 'state.json'),
    },
    {
      name: 'clean-dry-run',
      command: ['pnpm', 'dev:sync:clean', '--target', 'all', '--dry-run'],
      mutates: false,
      allowedWithoutAuthorization: true,
      evidencePath: join(evidenceDir, 'clean-dry-run.json'),
    },
  ];
}

const blockedOperations = [
  'build',
  'install',
  'redeploy',
  'restart',
  'destructive-clean',
  'real-sync-trigger',
];

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    writeEvidence: argv.includes('--write-evidence'),
  };
}

function readSmokeCases() {
  if (!existsSync(smokeDocPath)) return [];
  const content = readFileSync(smokeDocPath, 'utf8');
  const casePattern = /^##\s+Caso\s+\d+[：:]\s*(.+)$/gim;
  const cases = [];
  let match;
  while ((match = casePattern.exec(content)) !== null) {
    cases.push(match[1].trim());
  }
  return cases;
}

function createSmokePlan(env = process.env) {
  const evidenceDir = env.BIBLIOTECA_DEV_SYNC_SMOKE_DIR || defaultEvidenceDir;
  const tasks = createSafeTasks(evidenceDir);
  const cases = readSmokeCases();
  return {
    ok: true,
    status: 'pass',
    command: 'dev:sync:smoke',
    mode: 'plan',
    docPath: smokeDocPath,
    cases,
    tasks,
    blockedOperations,
    evidencePaths: tasks.map((task) => task.evidencePath),
    warnings: [
      'Document any WARN or AMBIGUOUS verdict from doctor/state/clean dry-run before continuing.',
      'This smoke plan does not build, install, redeploy, restart, destructively clean, or trigger real sync.',
    ],
  };
}

function writePlanEvidence(plan) {
  const evidenceDir = process.env.BIBLIOTECA_DEV_SYNC_SMOKE_DIR || defaultEvidenceDir;
  mkdirSync(evidenceDir, { recursive: true });
  const planPath = join(evidenceDir, 'plan.json');
  const planWithPath = { ...plan, planPath };
  writeFileSync(planPath, `${JSON.stringify(planWithPath, null, 2)}\n`, 'utf8');
  return planPath;
}

const options = parseArgs(process.argv.slice(2));
const plan = createSmokePlan();

if (options.writeEvidence) {
  plan.planPath = writePlanEvidence(plan);
}

if (options.json) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

console.log(`Smoke cases (${plan.cases.length}):`);
for (const [i, name] of plan.cases.entries()) {
  console.log(`  ${i + 1}. ${name}`);
}
console.log('\nSafe smoke commands (manual execution):');
for (const task of plan.tasks) {
  console.log(`  - ${task.command.join(' ')} > ${task.evidencePath}`);
}
console.log('\nBlocked without explicit operator authorization:');
for (const operation of plan.blockedOperations) {
  console.log(`  - ${operation}`);
}
console.log('\nUse --json for machine-readable checklist output.');
