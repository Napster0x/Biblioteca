import { NextResponse } from 'next/server';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const NAMESPACE = 'biblioteca-dev-sync';
const COUNTER_FILE_NAME = `${NAMESPACE}-counter.txt`;

type SyncExecuteResult = {
  ok?: boolean;
  error?: string;
};

function isDevHarnessEnabled(): boolean {
  return (
    process.env['BIBLIOTECA_DEV_SYNC_HARNESS'] === '1' || process.env.NODE_ENV === 'development'
  );
}

function getCounterFile(): string {
  return join(
    process.env['BIBLIOTECA_SYNC_TRIGGER_COUNTER_DIR'] || join('/tmp', NAMESPACE),
    COUNTER_FILE_NAME,
  );
}

function disabledResponse() {
  return NextResponse.json({ ok: false, error: 'dev-sync-harness-disabled' }, { status: 403 });
}

function readCounter(): number {
  try {
    const counterFile = getCounterFile();
    if (existsSync(counterFile)) {
      return parseInt(readFileSync(counterFile, 'utf-8').trim(), 10) || 0;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function writeCounter(n: number): void {
  const counterFile = getCounterFile();
  mkdirSync(dirname(counterFile), { recursive: true });
  writeFileSync(counterFile, String(n), 'utf-8');
}

export async function GET() {
  if (!isDevHarnessEnabled()) return disabledResponse();
  return NextResponse.json({ count: readCounter(), namespace: NAMESPACE, ok: true });
}

export async function POST(request: Request) {
  if (!isDevHarnessEnabled()) return disabledResponse();
  const next = readCounter() + 1;
  writeCounter(next);

  // Extract optional dataRoot from POST body (cycle harness sends it)
  let dataRoot: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    dataRoot = body?.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT;
  } catch {
    // Body is optional — no-op for legacy callers
  }

  const runId = `dev-sync-${next}-${Date.now()}`;

  // ── UI-initiated sync (no dataRoot): fire-and-forget ──────────────
  if (!dataRoot) {
    const child = spawn('node', [join(process.cwd(), 'scripts', 'sync-execute.mjs')], {
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_SYNC_RUN_ID: runId,
      },
      stdio: 'ignore',
      detached: true,
    });
    child.unref();

    return NextResponse.json({
      count: next,
      namespace: NAMESPACE,
      ok: true,
      runId,
      fired: true,
    });
  }

  // ── Harness-initiated sync (has dataRoot): blocking execution ─────
  let syncResult: SyncExecuteResult = {};
  try {
    const { stdout } = await execFileAsync(
      'node',
      [join(process.cwd(), 'scripts', 'sync-execute.mjs')],
      {
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          ...(dataRoot ? { BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dataRoot } : {}),
        },
        timeout: 30000,
      },
    );
    syncResult = JSON.parse(stdout.trim().split('\n').pop() || '{}') as SyncExecuteResult;
  } catch (error: unknown) {
    syncResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (syncResult.ok === false || syncResult.error) {
    return NextResponse.json(
      {
        count: next,
        namespace: NAMESPACE,
        ok: false,
        status: 'fail',
        runId,
        syncResult,
        evidence: { path: 'syncResult', nested: syncResult },
        error: syncResult.error ?? 'sync-execute failed',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    count: next,
    namespace: NAMESPACE,
    ok: true,
    runId,
    syncResult,
    evidence: { path: 'syncResult' },
  });
}
