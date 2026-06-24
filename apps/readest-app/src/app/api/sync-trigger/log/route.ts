import { NextResponse } from 'next/server';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join('/tmp', 'biblioteca-dev-sync');
const LOG_FILE = join(LOG_DIR, 'sync-results.jsonl');

export async function POST(request: Request) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const body = await request.json();
    appendFileSync(LOG_FILE, JSON.stringify(body) + '\n', 'utf-8');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
