/**
 * Pairing broker for mutual USB discovery.
 *
 * Shared blackboard: each device POSTs its searching state, GET reads
 * the other device's state. Both must be actively searching for pairing
 * to succeed.
 *
 * POST { deviceId, searching } — record this device's state
 * GET  ?deviceId=X           — return the OTHER device's state
 * DELETE { deviceId }        — clear this device's state
 */
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function isEnabled(): boolean {
  return (
    process.env['BIBLIOTECA_DEV_SYNC_HARNESS'] === '1' || process.env.NODE_ENV === 'development'
  );
}

function disabled() {
  return NextResponse.json({ ok: false, error: 'disabled' }, { status: 403 });
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

interface DeviceState {
  deviceId: string;
  searching: boolean;
  syncing: boolean;
  progress: number;
  runId: string | null;
  syncDone: boolean;
  since: number;
}

const devices = new Map<string, DeviceState>();
const WINDOW_MS = 5000; // keep searching state for 5s after last POST

function isVisibleState(state: DeviceState): boolean {
  return state.searching || state.syncing || state.syncDone;
}

// ---------------------------------------------------------------------------
// GET — read the OTHER device's state
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  if (!isEnabled()) return disabled();

  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ ok: false, error: 'missing deviceId' });

  // Find any OTHER device that is currently searching or syncing
  const now = Date.now();
  for (const [id, state] of devices.entries()) {
    if (id === deviceId) continue;
    if (isVisibleState(state) && now - state.since <= WINDOW_MS) {
      return NextResponse.json({
        ok: true,
        paired: true,
        otherDevice: id,
        syncing: state.syncing,
        progress: state.progress,
        runId: state.runId,
        syncDone: state.syncDone === true,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    paired: false,
    syncing: false,
    progress: 0,
    syncDone: false,
  });
}

// ---------------------------------------------------------------------------
// POST — record this device's searching state
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  if (!isEnabled()) return disabled();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' });
  }

  const { deviceId, searching, syncing, progress, runId, syncDone } = body;
  if (typeof deviceId !== 'string') {
    return NextResponse.json({ ok: false, error: 'missing deviceId' });
  }

  const now = Date.now();

  const existing = devices.get(deviceId);
  devices.set(deviceId, {
    deviceId,
    searching: searching === true || syncing === true,
    syncing: syncing === true,
    progress: typeof progress === 'number' ? progress : (existing?.progress ?? 0),
    runId: typeof runId === 'string' ? runId : (existing?.runId ?? null),
    syncDone: syncDone === true,
    since: now,
  });

  // Check if other device is active — return its state
  for (const [id, state] of devices.entries()) {
    if (id === deviceId) continue;
    if (isVisibleState(state) && now - state.since <= WINDOW_MS) {
      return NextResponse.json({
        ok: true,
        paired: true,
        otherDevice: id,
        syncing: state.syncing,
        progress: state.progress,
        runId: state.runId,
        syncDone: state.syncDone === true,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    paired: false,
    syncing: false,
    progress: 0,
    syncDone: false,
  });
}

// ---------------------------------------------------------------------------
// DELETE — clear this device's state
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  if (!isEnabled()) return disabled();

  try {
    const body = await request.json();
    if (typeof body?.deviceId === 'string') {
      devices.delete(body.deviceId);
    }
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Cleanup: remove stale entries periodically
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  for (const [id, state] of devices.entries()) {
    if (now - state.since > WINDOW_MS * 2) {
      devices.delete(id);
    }
  }
}, 10_000);
