import { NextResponse } from 'next/server';

function isDevHarnessEnabled(): boolean {
  return (
    process.env['BIBLIOTECA_DEV_SYNC_HARNESS'] === '1' || process.env.NODE_ENV === 'development'
  );
}

function disabledResponse() {
  return NextResponse.json({ ok: false, error: 'dev-sync-harness-disabled' }, { status: 403 });
}

export async function GET() {
  if (!isDevHarnessEnabled()) return disabledResponse();

  return NextResponse.json({
    ok: true,
    status: 'pass',
    controlPlane: 'dev-sync',
    mutation: 'none',
    version: 'dev-sync-control-plane-1',
  });
}
