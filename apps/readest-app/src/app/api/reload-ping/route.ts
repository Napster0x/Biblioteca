import { NextResponse } from 'next/server';
import { writeFileSync } from 'fs';

export async function POST() {
  writeFileSync('/tmp/reload-ping.txt', new Date().toISOString());
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const { readFileSync, existsSync } = await import('fs');
  const ts = existsSync('/tmp/reload-ping.txt')
    ? readFileSync('/tmp/reload-ping.txt', 'utf-8').trim()
    : 'never';
  return NextResponse.json({ lastReload: ts });
}
