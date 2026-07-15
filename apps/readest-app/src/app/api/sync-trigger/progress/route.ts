import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const PROGRESS_DIR = join('/tmp', 'biblioteca-dev-sync');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get('runId');
  if (!runId) {
    return NextResponse.json({ ok: false, error: 'missing runId' });
  }

  const progressFile = join(PROGRESS_DIR, `progress-${runId}.json`);
  if (!existsSync(progressFile)) {
    return NextResponse.json({ ok: true, progress: 0, phase: 'waiting' });
  }

  try {
    const content = readFileSync(progressFile, 'utf-8');
    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false, error: 'failed to read progress' });
  }
}
