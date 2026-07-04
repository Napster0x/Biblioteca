import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';

const appRootPath = process.cwd();
const triggerScript = join(appRootPath, 'scripts/dev-sync-trigger.mjs');
const syncExecuteScript = join(appRootPath, 'scripts/sync-execute.mjs');
const syncFilterStandalone = join(appRootPath, 'scripts/sync-filter-standalone.mjs');
const resetScript = join(appRootPath, 'scripts/dev-sync-reset.mjs');
const doctorScript = join(appRootPath, 'scripts/dev-sync-doctor.mjs');
const envModule = join(appRootPath, 'scripts/sync-dev-env.mjs');
const stateScript = join(appRootPath, 'scripts/dev-sync-state.mjs');
const stateModule = join(appRootPath, 'scripts/sync-dev-state.mjs');
const cycleScript = join(appRootPath, 'scripts/dev-sync-cycle.mjs');
const assertScript = join(appRootPath, 'scripts/dev-sync-assert.mjs');
const reportScript = join(appRootPath, 'scripts/dev-sync-report.mjs');
const smokeScript = join(appRootPath, 'scripts/dev-sync-smoke.mjs');
const packageJson = join(appRootPath, 'package.json');
const syncHarnessDoc = join(appRootPath, 'docs/sync-dev-harness.md');
const syncSmokeDoc = join(appRootPath, 'docs/sync-dev-smoke.md');

type DevSyncJson = {
  ok: boolean;
  status: 'pass' | 'warn' | 'fail' | 'blocked';
  command: string;
  errors?: Array<{ message: string }>;
};

type EnvOverrides = Record<string, string | undefined>;

type ReplicaPutCapture = {
  path: string;
  body: unknown;
};

type ReplicaPayloadRow = {
  user_id: string;
  kind: string;
  replica_id: string;
  fields_jsonb: Record<string, { v: unknown; t: string; s: string }>;
  manifest_jsonb: null;
  deleted_at_ts: string | null;
  reincarnation: string | null;
  updated_at_ts: string;
  schema_version: number;
};

const originalEnv = { ...process.env };
const tempRoots: string[] = [];

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `biblioteca-${name}-`));
  tempRoots.push(root);
  return root;
}

function runNode(script: string, args: string[], env: EnvOverrides = {}): string {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: appRootPath,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function spawnNode(
  script: string,
  args: string[],
  env: EnvOverrides = {},
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: appRootPath,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ stdout, stderr, status: code }));
    child.on('error', (err) => reject(err));
  });
}

function parseLastJsonObject(stdout: string): unknown {
  const jsonLine = stdout
    .trim()
    .split('\n')
    .findLast((line) => line.trim().startsWith('{'));
  if (!jsonLine) throw new Error(`missing JSON object in stdout: ${stdout}`);
  return JSON.parse(jsonLine);
}

function createDictionaryReplicaDb(dataRoot: string): void {
  const readestDir = join(dataRoot, 'Readest');
  mkdirRecursive(join(readestDir, 'Books'));
  writeFileSync(
    join(readestDir, 'Books', 'library.json'),
    JSON.stringify([{ hash: 'book-hash', title: 'Book Title' }]),
    'utf8',
  );
  execFileSync(
    'sqlite3',
    [
      join(readestDir, 'dictionary.db'),
      `
      CREATE TABLE dictionary_entries (
        id TEXT PRIMARY KEY,
        term TEXT,
        display_term TEXT,
        language TEXT,
        definition TEXT,
        image_path TEXT,
        curiosity TEXT,
        enrichment_status TEXT,
        replica_timestamps TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      );
      CREATE TABLE dictionary_occurrences (
        id TEXT PRIMARY KEY,
        entry_id TEXT,
        book_hash TEXT,
        book_title TEXT,
        book_author TEXT,
        cfi TEXT,
        section_href TEXT,
        page INTEGER,
        selected_text TEXT,
        context_before TEXT,
        context_after TEXT,
        highlight_note_id TEXT,
        replica_timestamps TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      );
      INSERT INTO dictionary_entries VALUES (
        'entry-1', 'serendipia', 'Serendipia', 'es', 'Hallazgo valioso', '/img.png', 'Curious', 'ready',
        '{"term":"0019ef2200001-00000001-desktop"}', 1782178000000, 1782178001000, NULL
      );
      INSERT INTO dictionary_occurrences VALUES (
        'occ-1', 'entry-1', 'book-hash', 'Book Title', 'Author', '/6/4', 'chapter.xhtml', 12, 'serendipia',
        'before', 'after', 'note-1', '{"selectedText":"0019ef2200002-00000001-desktop"}', 1782178002000, 1782178003000, NULL
      );
    `,
    ],
    { encoding: 'utf8' },
  );
}

describe('dev sync trigger harness', () => {
  it('rejects trigger counter writes unless the dev harness guard is enabled', async () => {
    const counterRoot = makeTempRoot('trigger-counter');
    process.env['BIBLIOTECA_SYNC_TRIGGER_COUNTER_DIR'] = counterRoot;
    delete process.env['BIBLIOTECA_DEV_SYNC_HARNESS'];

    const route = await import('@/app/api/sync-trigger/route');
    const response = await route.POST();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ ok: false, error: 'dev-sync-harness-disabled' });
  });

  it('uses a namespaced dev counter and returns distinct run ids for sequential triggers', async () => {
    const counterRoot = makeTempRoot('trigger-counter');
    const desktopRoot = makeTempRoot('trigger-desktop');
    process.env['BIBLIOTECA_DEV_SYNC_HARNESS'] = '1';
    process.env['BIBLIOTECA_SYNC_TRIGGER_COUNTER_DIR'] = counterRoot;
    process.env['BIBLIOTECA_DEV_DESKTOP_DATA_ROOT'] = desktopRoot;
    const server = createServer((req, res) => {
      if (req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');
    process.env['BIBLIOTECA_DEV_ANDROID_SERVER_URL'] = `http://127.0.0.1:${address.port}`;

    try {
      const route = await import('@/app/api/sync-trigger/route');
      const first = await route.POST();
      const second = await route.POST();
      const firstPayload = await first.json();
      const secondPayload = await second.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(firstPayload).toMatchObject({ ok: true, count: 1, namespace: 'biblioteca-dev-sync' });
      expect(secondPayload).toMatchObject({ ok: true, count: 2, namespace: 'biblioteca-dev-sync' });
      expect(firstPayload.runId).toMatch(/^dev-sync-1-/);
      expect(secondPayload.runId).toMatch(/^dev-sync-2-/);
      expect(secondPayload.runId).not.toBe(firstPayload.runId);
    } finally {
      server.close();
    }
  });

  it('prints dry-run evidence without contacting a server', () => {
    const output = runNode(
      triggerScript,
      ['--dry-run', '--port', '3131', '--peer', 'usb:localhost:7878'],
      { BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
    );
    const payload = JSON.parse(output) as {
      ok: boolean;
      dryRun: boolean;
      runId: string;
      peer: string;
      port: number;
      kinds: string[];
      cursors: Record<string, string>;
      hlc: Record<string, string>;
      outcome: string;
    };

    expect(payload).toMatchObject({
      ok: true,
      dryRun: true,
      peer: 'usb:localhost:7878',
      port: 3131,
      outcome: 'dry-run',
    });
    expect(payload.runId).toMatch(/^dev-sync-trigger-/);
    expect(payload.kinds).toEqual([
      'annotation',
      'quote',
      'dictionary-entry',
      'dictionary-occurrence',
    ]);
    expect(payload.cursors).toEqual({
      before: 'not-read-in-dry-run',
      after: 'not-written-in-dry-run',
    });
    expect(payload.hlc).toEqual({ summary: 'not-touched-in-dry-run' });
  });

  it('treats nested sync failures in a 200 response as command failure JSON', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'sync-execute failed',
          syncResult: { ok: false, error: 'replica push failed' },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(
        triggerScript,
        ['--host', '127.0.0.1', '--port', String(address.port)],
        {
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        },
      );
      const payload = JSON.parse(result.stdout) as DevSyncJson & {
        evidence?: { nested?: unknown };
      };

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(payload).toMatchObject({ ok: false, status: 'fail', command: 'dev:sync:trigger' });
      expect(payload.errors?.[0]?.message).toMatch(/sync-execute failed|replica push failed/);
      expect(payload.evidence?.nested).toMatchObject({ ok: false });
    } finally {
      server.close();
    }
  });

  it('classifies nested trigger failures with evidence paths before command output claims success', async () => {
    const { evaluateTriggerPayload } = await import(pathToFileURL(triggerScript).href);

    const result = evaluateTriggerPayload({
      httpOk: true,
      httpStatus: 200,
      payload: {
        ok: true,
        syncResult: {
          ok: false,
          error: 'dictionary replica push failed',
          evidence: { path: 'syncResult.replica.dictionary' },
        },
      },
      endpoint: 'http://127.0.0.1:3000/api/sync-trigger',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('fail');
    expect(result.errors[0].message).toContain('dictionary replica push failed');
    expect(result.evidence.path).toBe('syncResult');
    expect(result.evidence.nested).toMatchObject({
      ok: false,
      error: 'dictionary replica push failed',
    });
  });

  it('marks trigger responses with partial evidence as ambiguous instead of pass', async () => {
    const { evaluateTriggerPayload } = await import(pathToFileURL(triggerScript).href);

    const result = evaluateTriggerPayload({
      httpOk: true,
      httpStatus: 200,
      payload: { ok: true, runId: 'dev-sync-1', syncResult: { ok: true } },
      endpoint: 'http://127.0.0.1:3000/api/sync-trigger',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('fail');
    expect(result.errors[0].message).toContain('missing trigger evidence');
    expect(result.evidence.unavailable).toContain('syncResult.evidence.path');
  });
});

describe('sync-execute dictionary replica transport', () => {
  it('PUTs desktop dictionary entries and occurrences to separate Android replica endpoints with distinct evidence', async () => {
    const desktopRoot = makeTempRoot('sync-execute-dictionary');
    createDictionaryReplicaDb(desktopRoot);
    const replicaPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          replicaPuts.push({ path: req.url ?? '', body });
          const rows = body as Partial<ReplicaPayloadRow>[];
          const expectedKind = req.url?.split('/replicas/')[1];
          const invalidReason = Array.isArray(rows)
            ? rows.find(
                (row) =>
                  row.user_id !== 'visible' ||
                  row.kind !== expectedKind ||
                  typeof row.replica_id !== 'string' ||
                  !row.replica_id.startsWith(`${expectedKind}:`) ||
                  !row.fields_jsonb ||
                  row.reincarnation !== null ||
                  row.manifest_jsonb !== null,
              )
              ? 'ReplicaRow contract mismatch'
              : null
            : 'Replica PUT body must be a ReplicaRow array';
          if (invalidReason) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: invalidReason }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: Array.isArray(body) ? body.length : 0 }));
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        sent: number;
        received: number;
        replicas: Record<string, { attempted: number; applied: number; endpoint: string }>;
        evidence: { path: string };
      };
      const entryPut = replicaPuts.find((put) => put.path === '/replicas/dictionary-entry');
      const occurrencePut = replicaPuts.find(
        (put) => put.path === '/replicas/dictionary-occurrence',
      );
      const entryRows = entryPut?.body as ReplicaPayloadRow[] | undefined;
      const occurrenceRows = occurrencePut?.body as ReplicaPayloadRow[] | undefined;

      expect(result.status).toBe(0);
      expect(entryRows).toHaveLength(1);
      expect(occurrenceRows).toHaveLength(1);
      expect(entryRows?.[0]).toMatchObject({
        user_id: 'visible',
        kind: 'dictionary-entry',
        replica_id: 'dictionary-entry:entry-1',
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        schema_version: 1,
      });
      expect(entryRows?.[0]?.fields_jsonb.term.v).toBe('serendipia');
      expect(entryRows?.[0]?.fields_jsonb.term.s).toBe('visible');
      expect(entryRows?.[0]?.fields_jsonb.displayTerm.v).toBe('Serendipia');
      expect(entryRows?.[0]?.fields_jsonb.enrichmentStatus.v).toBe('ready');
      expect(entryRows?.[0]?.updated_at_ts).toMatch(/^0019ef[0-9a-f]{7}-00000001-visible$/);
      expect(occurrenceRows?.[0]).toMatchObject({
        user_id: 'visible',
        kind: 'dictionary-occurrence',
        replica_id: 'dictionary-occurrence:occ-1',
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        schema_version: 1,
      });
      expect(occurrenceRows?.[0]?.fields_jsonb.entryId.v).toBe('entry-1');
      expect(occurrenceRows?.[0]?.fields_jsonb.bookHash.v).toBe('book-hash');
      expect(occurrenceRows?.[0]?.fields_jsonb.selectedText.v).toBe('serendipia');
      expect(occurrenceRows?.[0]?.fields_jsonb.selectedText.s).toBe('visible');
      expect(payload).toMatchObject({
        ok: true,
        sent: 1,
        received: 0,
        replicas: {
          'dictionary-entry': { attempted: 1, applied: 1, endpoint: '/replicas/dictionary-entry' },
          'dictionary-occurrence': {
            attempted: 1,
            applied: 1,
            endpoint: '/replicas/dictionary-occurrence',
          },
        },
        evidence: { path: 'syncResult.replicas' },
      });
    } finally {
      server.close();
    }
  });

  it('preserves book sync and reports zero dictionary replica counts when the dictionary DB is absent', async () => {
    const desktopRoot = makeTempRoot('sync-execute-no-dictionary');
    const booksDir = join(desktopRoot, 'Readest', 'Books');
    mkdirRecursive(booksDir);
    writeFileSync(
      join(booksDir, 'library.json'),
      JSON.stringify([{ hash: 'book-only', title: 'Book Only' }]),
      'utf8',
    );
    const replicaPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        replicaPuts.push({ path: req.url, body: [] });
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        sent: number;
        received: number;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(result.status).toBe(0);
      expect(replicaPuts).toEqual([]);
      expect(payload.sent).toBe(1);
      expect(payload.received).toBe(0);
      expect(payload.replicas['dictionary-entry']).toMatchObject({ attempted: 0, applied: 0 });
      expect(payload.replicas['dictionary-occurrence']).toMatchObject({ attempted: 0, applied: 0 });
    } finally {
      server.close();
    }
  });

  it('fails non-zero with replica evidence when a dictionary replica PUT is rejected', async () => {
    const desktopRoot = makeTempRoot('sync-execute-dictionary-fail');
    createDictionaryReplicaDb(desktopRoot);
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/replicas/dictionary-entry') {
        req.resume();
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing field user_id' }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/replicas/dictionary-occurrence') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        error: string;
        replicas: Record<string, { attempted: number; applied: number; failures: string[] }>;
        evidence: { path: string };
      };

      expect(result.status).toBe(1);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain('dictionary-entry');
      expect(payload.replicas['dictionary-entry']).toMatchObject({ attempted: 1, applied: 0 });
      expect(payload.replicas['dictionary-entry'].failures[0]).toContain('400');
      expect(payload.replicas['dictionary-entry'].failures[0]).toContain('missing field user_id');
      expect(payload.evidence.path).toBe('syncResult.replicas');
    } finally {
      server.close();
    }
  });
});

function createQuoteReplicaDb(dataRoot: string): void {
  const readestDir = join(dataRoot, 'Readest');
  mkdirRecursive(join(readestDir, 'Books'));
  writeFileSync(
    join(readestDir, 'Books', 'library.json'),
    JSON.stringify([{ hash: 'book-hash', title: 'Book Title' }]),
    'utf8',
  );
  execFileSync(
    'sqlite3',
    [
      join(readestDir, 'citas.db'),
      `
      CREATE TABLE quotes (
        id TEXT PRIMARY KEY,
        book_hash TEXT,
        book_title TEXT,
        book_author TEXT,
        cfi TEXT,
        section_href TEXT,
        page INTEGER,
        text TEXT,
        context_before TEXT,
        context_after TEXT,
        content_hash TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER
      );
      INSERT INTO quotes VALUES (
        'quote-1', 'book-hash', 'Book Title', 'Author Name',
        '/6/4', 'chapter.xhtml', 42, 'To be or not to be',
        'before context', 'after context', 'content-hash-abc',
        1782178000000, 1782178001000, NULL
      );
    `,
    ],
    { encoding: 'utf8' },
  );
}

describe('sync-execute quote replica transport', () => {
  it('PUTs desktop quote rows to /replicas/quote with expected field envelop and replica_id prefix', async () => {
    const desktopRoot = makeTempRoot('sync-execute-quote');
    createQuoteReplicaDb(desktopRoot);
    const replicaPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          replicaPuts.push({ path: req.url ?? '', body });
          const rows = body as Partial<ReplicaPayloadRow>[];
          const expectedKind = req.url?.split('/replicas/')[1];
          const invalidReason = Array.isArray(rows)
            ? rows.find(
                (row) =>
                  row.user_id !== 'visible' ||
                  row.kind !== expectedKind ||
                  typeof row.replica_id !== 'string' ||
                  !row.replica_id.startsWith(`${expectedKind}:`) ||
                  !row.fields_jsonb ||
                  row.reincarnation !== null ||
                  row.manifest_jsonb !== null,
              )
              ? 'ReplicaRow contract mismatch'
              : null
            : 'Replica PUT body must be a ReplicaRow array';
          if (invalidReason) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: invalidReason }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: Array.isArray(body) ? body.length : 0 }));
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        sent: number;
        received: number;
        replicas: Record<string, { attempted: number; applied: number; endpoint: string }>;
        evidence: { path: string };
      };
      const quotePut = replicaPuts.find((put) => put.path === '/replicas/quote');
      const quoteRows = quotePut?.body as ReplicaPayloadRow[] | undefined;

      expect(result.status).toBe(0);
      expect(quoteRows).toHaveLength(1);
      expect(quoteRows?.[0]).toMatchObject({
        user_id: 'visible',
        kind: 'quote',
        replica_id: 'quote:quote-1',
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        schema_version: 1,
      });
      expect(quoteRows?.[0]?.fields_jsonb.bookHash.v).toBe('book-hash');
      expect(quoteRows?.[0]?.fields_jsonb.bookHash.s).toBe('visible');
      expect(quoteRows?.[0]?.fields_jsonb.bookTitle.v).toBe('Book Title');
      expect(quoteRows?.[0]?.fields_jsonb.bookAuthor.v).toBe('Author Name');
      expect(quoteRows?.[0]?.fields_jsonb.cfi.v).toBe('/6/4');
      expect(quoteRows?.[0]?.fields_jsonb.sectionHref.v).toBe('chapter.xhtml');
      expect(quoteRows?.[0]?.fields_jsonb.page.v).toBe(42);
      expect(quoteRows?.[0]?.fields_jsonb.text.v).toBe('To be or not to be');
      expect(quoteRows?.[0]?.fields_jsonb.contextBefore.v).toBe('before context');
      expect(quoteRows?.[0]?.fields_jsonb.contextAfter.v).toBe('after context');
      expect(quoteRows?.[0]?.fields_jsonb.contentHash.v).toBe('content-hash-abc');
      expect(quoteRows?.[0]?.updated_at_ts).toMatch(/^0019ef[0-9a-f]{7}-00000001-visible$/);
      expect(payload).toMatchObject({
        ok: true,
        sent: 1,
        received: 0,
        replicas: {
          'dictionary-entry': { attempted: 0, applied: 0 },
          'dictionary-occurrence': { attempted: 0, applied: 0 },
          quote: { attempted: 1, applied: 1, endpoint: '/replicas/quote' },
        },
        evidence: { path: 'syncResult.replicas' },
      });
    } finally {
      server.close();
    }
  });

  it('preserves book and dictionary sync and reports zero quote counts when citas.db is absent', async () => {
    const desktopRoot = makeTempRoot('sync-execute-no-quotes');
    const booksDir = join(desktopRoot, 'Readest', 'Books');
    mkdirRecursive(booksDir);
    writeFileSync(
      join(booksDir, 'library.json'),
      JSON.stringify([{ hash: 'book-only', title: 'Book Only' }]),
      'utf8',
    );
    const replicaPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        replicaPuts.push({ path: req.url, body: [] });
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        sent: number;
        received: number;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(result.status).toBe(0);
      const quotePut = replicaPuts.find((put) => put.path === '/replicas/quote');
      expect(quotePut).toBeUndefined();
      expect(payload.sent).toBe(1);
      expect(payload.received).toBe(0);
      expect(payload.replicas.quote).toMatchObject({ attempted: 0, applied: 0 });
    } finally {
      server.close();
    }
  });

  it('fails non-zero with replica evidence when quote replica PUT is rejected', async () => {
    const desktopRoot = makeTempRoot('sync-execute-quote-fail');
    createQuoteReplicaDb(desktopRoot);
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/replicas/quote') {
        req.resume();
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing field bookHash' }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        error: string;
        replicas: Record<string, { attempted: number; applied: number; failures: string[] }>;
        evidence: { path: string };
      };

      expect(result.status).toBe(1);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain('quote');
      expect(payload.replicas.quote).toMatchObject({ attempted: 1, applied: 0 });
      expect(payload.replicas.quote.failures[0]).toContain('400');
      expect(payload.replicas.quote.failures[0]).toContain('missing field bookHash');
      expect(payload.evidence.path).toBe('syncResult.replicas');
    } finally {
      server.close();
    }
  });
});

function createAnnotationReplicaDb(dataRoot: string): void {
  const readestDir = join(dataRoot, 'Readest');
  mkdirRecursive(join(readestDir, 'Books'));
  writeFileSync(
    join(readestDir, 'Books', 'library.json'),
    JSON.stringify([{ hash: 'book-hash', title: 'Book Title' }]),
    'utf8',
  );
  execFileSync(
    'sqlite3',
    [
      join(readestDir, 'annotations.db'),
      `
      CREATE TABLE annotations (
        id TEXT PRIMARY KEY,
        book_hash TEXT,
        book_title TEXT,
        book_author TEXT,
        cfi TEXT,
        section_href TEXT,
        page INTEGER,
        text TEXT,
        note TEXT DEFAULT '',
        style TEXT DEFAULT 'highlight',
        color TEXT DEFAULT 'yellow',
        created_at INTEGER,
        updated_at INTEGER,
        deleted_at INTEGER,
        replica_timestamps TEXT
      );
      INSERT INTO annotations VALUES (
        'ann-1', 'book-hash', 'Book Title', 'Author Name',
        '/6/4', 'chapter.xhtml', 42, 'Important note text',
        'My annotation note', 'underline', 'blue',
        1782178000000, 1782178001000, NULL,
        '{"text":"0019ef2200001-00000001-desktop"}'
      );
    `,
    ],
    { encoding: 'utf8' },
  );
}

describe('sync-execute annotation replica transport', () => {
  it('PUTs desktop annotation rows to /replicas/annotation with expected field envelope and replica_id prefix', async () => {
    const desktopRoot = makeTempRoot('sync-execute-annotation');
    createAnnotationReplicaDb(desktopRoot);
    const replicaPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          replicaPuts.push({ path: req.url ?? '', body });
          const rows = body as Partial<ReplicaPayloadRow>[];
          const expectedKind = req.url?.split('/replicas/')[1];
          const invalidReason = Array.isArray(rows)
            ? rows.find(
                (row) =>
                  row.user_id !== 'visible' ||
                  row.kind !== expectedKind ||
                  typeof row.replica_id !== 'string' ||
                  !row.replica_id.startsWith(`${expectedKind}:`) ||
                  !row.fields_jsonb ||
                  row.reincarnation !== null ||
                  row.manifest_jsonb !== null,
              )
              ? 'ReplicaRow contract mismatch'
              : null
            : 'Replica PUT body must be a ReplicaRow array';
          if (invalidReason) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: invalidReason }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: Array.isArray(body) ? body.length : 0 }));
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        sent: number;
        received: number;
        replicas: Record<string, { attempted: number; applied: number; endpoint: string }>;
        evidence: { path: string };
      };
      const annotationPut = replicaPuts.find((put) => put.path === '/replicas/annotation');
      const annotationRows = annotationPut?.body as ReplicaPayloadRow[] | undefined;

      expect(result.status).toBe(0);
      expect(annotationRows).toHaveLength(1);
      expect(annotationRows?.[0]).toMatchObject({
        user_id: 'visible',
        kind: 'annotation',
        replica_id: 'annotation:ann-1',
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        schema_version: 1,
      });
      expect(annotationRows?.[0]?.fields_jsonb.bookHash.v).toBe('book-hash');
      expect(annotationRows?.[0]?.fields_jsonb.bookHash.s).toBe('visible');
      expect(annotationRows?.[0]?.fields_jsonb.bookTitle.v).toBe('Book Title');
      expect(annotationRows?.[0]?.fields_jsonb.bookAuthor.v).toBe('Author Name');
      expect(annotationRows?.[0]?.fields_jsonb.cfi.v).toBe('/6/4');
      expect(annotationRows?.[0]?.fields_jsonb.sectionHref.v).toBe('chapter.xhtml');
      expect(annotationRows?.[0]?.fields_jsonb.page.v).toBe(42);
      expect(annotationRows?.[0]?.fields_jsonb.text.v).toBe('Important note text');
      expect(annotationRows?.[0]?.fields_jsonb.note.v).toBe('My annotation note');
      expect(annotationRows?.[0]?.fields_jsonb.style.v).toBe('underline');
      expect(annotationRows?.[0]?.fields_jsonb.color.v).toBe('blue');
      expect(annotationRows?.[0]?.updated_at_ts).toMatch(/^0019ef[0-9a-f]{7}-00000001-visible$/);
      expect(payload).toMatchObject({
        ok: true,
        sent: 1,
        received: 0,
        replicas: {
          'dictionary-entry': { attempted: 0, applied: 0 },
          'dictionary-occurrence': { attempted: 0, applied: 0 },
          quote: { attempted: 0, applied: 0 },
          annotation: { attempted: 1, applied: 1, endpoint: '/replicas/annotation' },
        },
        evidence: { path: 'syncResult.replicas' },
      });
    } finally {
      server.close();
    }
  });

  it('preserves book, dictionary, and quote sync and reports zero annotation counts when annotations.db is absent', async () => {
    const desktopRoot = makeTempRoot('sync-execute-no-annotations');
    const booksDir = join(desktopRoot, 'Readest', 'Books');
    mkdirRecursive(booksDir);
    writeFileSync(
      join(booksDir, 'library.json'),
      JSON.stringify([{ hash: 'book-only', title: 'Book Only' }]),
      'utf8',
    );
    const replicaPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        replicaPuts.push({ path: req.url, body: [] });
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        sent: number;
        received: number;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(result.status).toBe(0);
      const annotationPut = replicaPuts.find((put) => put.path === '/replicas/annotation');
      expect(annotationPut).toBeUndefined();
      expect(payload.sent).toBe(1);
      expect(payload.received).toBe(0);
      expect(payload.replicas.annotation).toMatchObject({ attempted: 0, applied: 0 });
    } finally {
      server.close();
    }
  });

  it('fails non-zero with replica evidence when annotation replica PUT is rejected', async () => {
    const desktopRoot = makeTempRoot('sync-execute-annotation-fail');
    createAnnotationReplicaDb(desktopRoot);
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/replicas/annotation') {
        req.resume();
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing field bookHash' }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        error: string;
        replicas: Record<string, { attempted: number; applied: number; failures: string[] }>;
        evidence: { path: string };
      };

      expect(result.status).toBe(1);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain('annotation');
      expect(payload.replicas.annotation).toMatchObject({ attempted: 1, applied: 0 });
      expect(payload.replicas.annotation.failures[0]).toContain('400');
      expect(payload.replicas.annotation.failures[0]).toContain('missing field bookHash');
      expect(payload.evidence.path).toBe('syncResult.replicas');
    } finally {
      server.close();
    }
  });
});

type ReplicaEvidence = {
  attempted: number;
  applied: number;
  endpoint: string;
  pulled: number;
  appliedToDesktop: number;
};

type SyncExecutePayload = {
  ok: boolean;
  replicas: Record<string, ReplicaEvidence>;
};

type SqliteRow = Record<string, unknown>;

function fieldValue(
  value: unknown,
  timestamp = '0019ef3300001-00000001-android',
): { v: unknown; t: string; s: string } {
  return { v: value, t: timestamp, s: 'android' };
}

function replicaRow(
  kind: string,
  id: string,
  fields: Record<string, unknown>,
  updatedAtTs: string,
): ReplicaPayloadRow {
  const fields_jsonb = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fieldValue(value, updatedAtTs)]),
  );
  return {
    user_id: 'android-user',
    kind,
    replica_id: `${kind}:${id}`,
    fields_jsonb,
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: updatedAtTs,
    schema_version: 1,
  };
}

function createEmptyDesktopSyncRoot(dataRoot: string): void {
  const booksDir = join(dataRoot, 'Readest', 'Books');
  mkdirRecursive(booksDir);
  writeFileSync(join(booksDir, 'library.json'), '[]', 'utf8');
}

function readSqliteRows(dbPath: string, sql: string): SqliteRow[] {
  const output = execFileSync('sqlite3', [dbPath, '-json', sql], { encoding: 'utf8' });
  return JSON.parse(output || '[]') as SqliteRow[];
}

function createCaso7AndroidRows(
  updatedAtTs = '0019ef3300001-00000001-android',
): Record<string, ReplicaPayloadRow[]> {
  return {
    'dictionary-entry': [
      replicaRow(
        'dictionary-entry',
        'android-entry-1',
        {
          term: 'alborada',
          displayTerm: 'Alborada',
          language: 'es',
          definition: 'Luz del amanecer',
          imagePath: null,
          curiosity: 'También es una composición musical.',
          enrichmentStatus: 'ready',
        },
        updatedAtTs,
      ),
    ],
    'dictionary-occurrence': [
      replicaRow(
        'dictionary-occurrence',
        'android-occ-1',
        {
          entryId: 'android-entry-1',
          bookHash: 'android-book',
          bookTitle: 'Android Book',
          bookAuthor: 'Android Author',
          cfi: '/6/8',
          sectionHref: 'android.xhtml',
          page: 7,
          selectedText: 'alborada',
          contextBefore: 'before android',
          contextAfter: 'after android',
          highlightNoteId: 'android-note-1',
        },
        updatedAtTs,
      ),
    ],
    quote: [
      replicaRow(
        'quote',
        'android-quote-1',
        {
          bookHash: 'android-book',
          bookTitle: 'Android Book',
          bookAuthor: 'Android Author',
          cfi: '/8/2',
          sectionHref: 'quote.xhtml',
          page: 13,
          text: 'Android quote text',
          contextBefore: 'quote before',
          contextAfter: 'quote after',
          contentHash: 'android-content-hash',
        },
        updatedAtTs,
      ),
    ],
    annotation: [
      replicaRow(
        'annotation',
        'android-ann-1',
        {
          bookHash: 'android-book',
          bookTitle: 'Android Book',
          bookAuthor: 'Android Author',
          cfi: '/10/4',
          sectionHref: 'annotation.xhtml',
          page: 21,
          text: 'Android annotation text',
          note: 'Android note',
          style: 'highlight',
          color: 'yellow',
        },
        updatedAtTs,
      ),
    ],
  };
}

describe('sync-execute Android-to-desktop replica pull', () => {
  it('pulls every Android replica kind and applies visible rows plus replica metadata with additive evidence', async () => {
    const desktopRoot = makeTempRoot('sync-execute-android-pull');
    createEmptyDesktopSyncRoot(desktopRoot);
    const androidRows = createCaso7AndroidRows();
    const replicaGets: string[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        replicaGets.push(req.url);
        const kind = req.url.split('/replicas/')[1] ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            kind === 'dictionary-entry'
              ? { rows: androidRows[kind] ?? [] }
              : (androidRows[kind] ?? []),
          ),
        );
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied: 0 }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as SyncExecutePayload;
      const readestDir = join(desktopRoot, 'Readest');

      expect(result.status).toBe(0);
      expect(replicaGets).toEqual([
        '/replicas/dictionary-entry',
        '/replicas/dictionary-occurrence',
        '/replicas/quote',
        '/replicas/annotation',
      ]);
      expect(
        readSqliteRows(
          join(readestDir, 'dictionary.db'),
          "SELECT id, term, definition FROM dictionary_entries WHERE id = 'android-entry-1'",
        ),
      ).toEqual([{ id: 'android-entry-1', term: 'alborada', definition: 'Luz del amanecer' }]);
      expect(
        readSqliteRows(
          join(readestDir, 'dictionary.db'),
          "SELECT id, entry_id, selected_text FROM dictionary_occurrences WHERE id = 'android-occ-1'",
        ),
      ).toEqual([{ id: 'android-occ-1', entry_id: 'android-entry-1', selected_text: 'alborada' }]);
      expect(
        readSqliteRows(
          join(readestDir, 'citas.db'),
          "SELECT id, text, content_hash FROM quotes WHERE id = 'android-quote-1'",
        ),
      ).toEqual([
        { id: 'android-quote-1', text: 'Android quote text', content_hash: 'android-content-hash' },
      ]);
      expect(
        readSqliteRows(
          join(readestDir, 'annotations.db'),
          "SELECT id, text, note FROM annotations WHERE id = 'android-ann-1'",
        ),
      ).toEqual([{ id: 'android-ann-1', text: 'Android annotation text', note: 'Android note' }]);
      expect(
        readSqliteRows(
          join(readestDir, 'dictionary.db'),
          'SELECT replica_id, kind FROM _replicas ORDER BY replica_id',
        ),
      ).toEqual(
        expect.arrayContaining([
          { replica_id: 'dictionary-entry:android-entry-1', kind: 'dictionary-entry' },
          { replica_id: 'dictionary-occurrence:android-occ-1', kind: 'dictionary-occurrence' },
        ]),
      );
      expect(payload.replicas['dictionary-entry']).toMatchObject({
        attempted: 0,
        applied: 0,
        pulled: 1,
        appliedToDesktop: 1,
      });
      expect(payload.replicas['dictionary-occurrence']).toMatchObject({
        attempted: 0,
        applied: 0,
        pulled: 1,
        appliedToDesktop: 1,
      });
      expect(payload.replicas.quote).toMatchObject({
        attempted: 0,
        applied: 0,
        pulled: 1,
        appliedToDesktop: 1,
      });
      expect(payload.replicas.annotation).toMatchObject({
        attempted: 0,
        applied: 0,
        pulled: 1,
        appliedToDesktop: 1,
      });
    } finally {
      server.close();
    }
  });

  it('requests dictionary entries before occurrences and does not converge an occurrence without its entry', async () => {
    const desktopRoot = makeTempRoot('sync-execute-dictionary-order');
    createEmptyDesktopSyncRoot(desktopRoot);
    const androidRows = createCaso7AndroidRows();
    const replicaGets: string[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        replicaGets.push(req.url);
        const kind = req.url.split('/replicas/')[1] ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(androidRows[kind] ?? []));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as SyncExecutePayload;

      expect(result.status).toBe(0);
      expect(replicaGets.indexOf('/replicas/dictionary-entry')).toBeGreaterThanOrEqual(0);
      expect(replicaGets.indexOf('/replicas/dictionary-occurrence')).toBeGreaterThan(
        replicaGets.indexOf('/replicas/dictionary-entry'),
      );
      expect(
        readSqliteRows(
          join(desktopRoot, 'Readest', 'dictionary.db'),
          "SELECT id FROM dictionary_entries WHERE id = 'android-entry-1'",
        ),
      ).toEqual([{ id: 'android-entry-1' }]);
      expect(
        readSqliteRows(
          join(desktopRoot, 'Readest', 'dictionary.db'),
          "SELECT id, entry_id FROM dictionary_occurrences WHERE id = 'android-occ-1'",
        ),
      ).toEqual([{ id: 'android-occ-1', entry_id: 'android-entry-1' }]);
      expect(payload.replicas['dictionary-occurrence'].appliedToDesktop).toBe(1);
    } finally {
      server.close();
    }
  });

  it('keeps Android-to-desktop apply idempotent and refuses older HLC overwrites', async () => {
    const desktopRoot = makeTempRoot('sync-execute-hlc-idempotent');
    createEmptyDesktopSyncRoot(desktopRoot);
    const newerDesktopTs = '0019ef4400001-00000001-desktop';
    const olderAndroidRows = createCaso7AndroidRows('0019ef3300001-00000001-android');
    execFileSync(
      'sqlite3',
      [
        join(desktopRoot, 'Readest', 'dictionary.db'),
        `
        CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, definition TEXT, image_path TEXT, curiosity TEXT, enrichment_status TEXT, replica_timestamps TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
        CREATE TABLE _replicas (replica_id TEXT PRIMARY KEY, kind TEXT, user_id TEXT, fields_jsonb TEXT, manifest_jsonb TEXT, deleted_at_ts TEXT, reincarnation TEXT, updated_at_ts TEXT, schema_version INTEGER);
        INSERT INTO dictionary_entries VALUES ('android-entry-1', 'desktop-newer', 'Desktop Newer', 'es', 'Newer desktop definition', NULL, NULL, 'ready', '{}', 1782178000000, 1782178001000, NULL);
        INSERT INTO _replicas VALUES ('dictionary-entry:android-entry-1', 'dictionary-entry', 'visible', '{}', NULL, NULL, NULL, '${newerDesktopTs}', 1);
      `,
      ],
      { encoding: 'utf8' },
    );
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        const kind = req.url.split('/replicas/')[1] ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(olderAndroidRows[kind] ?? []));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied: 0 }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const env = {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      };
      const first = await spawnNode(syncExecuteScript, [], env);
      const second = await spawnNode(syncExecuteScript, [], env);
      const secondPayload = parseLastJsonObject(second.stdout) as SyncExecutePayload;
      const dictionaryDb = join(desktopRoot, 'Readest', 'dictionary.db');

      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(
        readSqliteRows(
          dictionaryDb,
          "SELECT COUNT(*) AS count FROM dictionary_entries WHERE id = 'android-entry-1'",
        ),
      ).toEqual([{ count: 1 }]);
      expect(
        readSqliteRows(
          dictionaryDb,
          "SELECT term, definition FROM dictionary_entries WHERE id = 'android-entry-1'",
        ),
      ).toEqual([{ term: 'desktop-newer', definition: 'Newer desktop definition' }]);
      expect(
        readSqliteRows(
          dictionaryDb,
          "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'dictionary-entry:android-entry-1'",
        ),
      ).toEqual([{ updated_at_ts: newerDesktopTs }]);
      // Pull filter removes replicas already in _replicas with equal-or-higher HLC → pulled=0
      expect(secondPayload.replicas['dictionary-entry']).toMatchObject({
        pulled: 0,
        appliedToDesktop: 0,
      });
    } finally {
      server.close();
    }
  });
});

function createFullSyncFixture(dataRoot: string): void {
  const readestDir = join(dataRoot, 'Readest');
  const booksDir = join(readestDir, 'Books');
  mkdirRecursive(booksDir);
  writeFileSync(
    join(booksDir, 'library.json'),
    JSON.stringify([{ hash: 'book-hash', title: 'Book Title' }]),
    'utf8',
  );

  const REPLICAS_DDL = `CREATE TABLE IF NOT EXISTS _replicas (
    replica_id TEXT PRIMARY KEY, kind TEXT, user_id TEXT, fields_jsonb TEXT,
    manifest_jsonb TEXT, deleted_at_ts TEXT, reincarnation TEXT, updated_at_ts TEXT,
    schema_version INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_replicas_kind_updated_at ON _replicas(kind, updated_at_ts);`;

  execFileSync(
    'sqlite3',
    [
      join(readestDir, 'dictionary.db'),
      `
      CREATE TABLE dictionary_entries (
        id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, definition TEXT,
        image_path TEXT, curiosity TEXT, enrichment_status TEXT, replica_timestamps TEXT,
        created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
      );
      CREATE TABLE dictionary_occurrences (
        id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, book_title TEXT, book_author TEXT,
        cfi TEXT, section_href TEXT, page INTEGER, selected_text TEXT,
        context_before TEXT, context_after TEXT, highlight_note_id TEXT,
        replica_timestamps TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
      );
      ${REPLICAS_DDL}
      INSERT INTO dictionary_entries VALUES (
        'entry-1', 'serendipia', 'Serendipia', 'es', 'Hallazgo valioso',
        '/img.png', 'Curious', 'ready',
        '{"term":"0019ef2200001-00000001-desktop"}', 1782178000000, 1782178001000, NULL
      );
      INSERT INTO dictionary_occurrences VALUES (
        'occ-1', 'entry-1', 'book-hash', 'Book Title', 'Author', '/6/4', 'chapter.xhtml',
        12, 'serendipia', 'before', 'after', 'note-1',
        '{"selectedText":"0019ef2200002-00000001-desktop"}', 1782178002000, 1782178003000, NULL
      );
    `,
    ],
    { encoding: 'utf8' },
  );

  execFileSync(
    'sqlite3',
    [
      join(readestDir, 'citas.db'),
      `
      CREATE TABLE quotes (
        id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT,
        cfi TEXT, section_href TEXT, page INTEGER, text TEXT, context_before TEXT,
        context_after TEXT, content_hash TEXT, created_at INTEGER, updated_at INTEGER,
        deleted_at INTEGER
      );
      ${REPLICAS_DDL}
      INSERT INTO quotes VALUES (
        'quote-1', 'book-hash', 'Book Title', 'Author Name',
        '/6/4', 'chapter.xhtml', 42, 'To be or not to be',
        'before context', 'after context', 'content-hash-abc',
        1782178000000, 1782178001000, NULL
      );
    `,
    ],
    { encoding: 'utf8' },
  );

  execFileSync(
    'sqlite3',
    [
      join(readestDir, 'annotations.db'),
      `
      CREATE TABLE annotations (
        id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT,
        cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '',
        style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow',
        created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,
        replica_timestamps TEXT
      );
      ${REPLICAS_DDL}
      INSERT INTO annotations VALUES (
        'ann-1', 'book-hash', 'Book Title', 'Author Name',
        '/6/4', 'chapter.xhtml', 42, 'Important note text',
        'My annotation note', 'underline', 'blue',
        1782178000000, 1782178001000, NULL,
        '{"text":"0019ef2200001-00000001-desktop"}'
      );
    `,
    ],
    { encoding: 'utf8' },
  );
}

describe('sync-execute idempotence', () => {
  it('bootstraps push of all four kinds when _replicas is empty', async () => {
    const desktopRoot = makeTempRoot('sync-execute-idempotence-bootstrap');
    createFullSyncFixture(desktopRoot);
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          const count = Array.isArray(body) ? (body as unknown[]).length : 0;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: count }));
        });
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(result.status).toBe(0);
      expect(payload.ok).toBe(true);
      expect(payload.replicas['dictionary-entry'].attempted).toBeGreaterThan(0);
      expect(payload.replicas['dictionary-entry'].applied).toBeGreaterThan(0);
      expect(payload.replicas['dictionary-occurrence'].attempted).toBeGreaterThan(0);
      expect(payload.replicas['dictionary-occurrence'].applied).toBeGreaterThan(0);
      expect(payload.replicas.quote.attempted).toBeGreaterThan(0);
      expect(payload.replicas.quote.applied).toBeGreaterThan(0);
      expect(payload.replicas.annotation.attempted).toBeGreaterThan(0);
      expect(payload.replicas.annotation.applied).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it('produces zero attempted on second sync with no data changes', async () => {
    const desktopRoot = makeTempRoot('sync-execute-idempotence-unchanged');
    createFullSyncFixture(desktopRoot);
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          const count = Array.isArray(body) ? (body as unknown[]).length : 0;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: count }));
        });
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    const env: EnvOverrides = {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
      BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
    };

    try {
      const first = await spawnNode(syncExecuteScript, [], env);
      expect(first.status).toBe(0);

      const second = await spawnNode(syncExecuteScript, [], env);
      const secondPayload = parseLastJsonObject(second.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(second.status).toBe(0);
      expect(secondPayload.replicas['dictionary-entry']).toMatchObject({
        attempted: 0,
        applied: 0,
      });
      expect(secondPayload.replicas['dictionary-occurrence']).toMatchObject({
        attempted: 0,
        applied: 0,
      });
      expect(secondPayload.replicas.quote).toMatchObject({ attempted: 0, applied: 0 });
      expect(secondPayload.replicas.annotation).toMatchObject({ attempted: 0, applied: 0 });
    } finally {
      server.close();
    }
  });

  it('re-pushes rows with newer HLC after desktop modification', async () => {
    const desktopRoot = makeTempRoot('sync-execute-idempotence-modified');
    createFullSyncFixture(desktopRoot);
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          const count = Array.isArray(body) ? (body as unknown[]).length : 0;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: count }));
        });
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    const env: EnvOverrides = {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
      BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
    };

    try {
      const first = await spawnNode(syncExecuteScript, [], env);
      expect(first.status).toBe(0);

      const dictionaryDb = join(desktopRoot, 'Readest', 'dictionary.db');
      execFileSync(
        'sqlite3',
        [
          dictionaryDb,
          "UPDATE dictionary_entries SET updated_at = 9999999999999 WHERE id = 'entry-1'",
        ],
        { encoding: 'utf8' },
      );

      const second = await spawnNode(syncExecuteScript, [], env);
      const payload = parseLastJsonObject(second.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(second.status).toBe(0);
      expect(payload.replicas['dictionary-entry'].attempted).toBe(1);
      expect(payload.replicas['dictionary-entry'].applied).toBe(1);
      expect(payload.replicas['dictionary-occurrence'].attempted).toBe(0);
      expect(payload.replicas.quote.attempted).toBe(0);
      expect(payload.replicas.annotation.attempted).toBe(0);
    } finally {
      server.close();
    }
  });

  it('keeps Caso 7 pulled replicas from being re-pushed', async () => {
    const desktopRoot = makeTempRoot('sync-execute-idempotence-caso7');
    createFullSyncFixture(desktopRoot);
    // Pre-populate _replicas with an Android-sourced entry (Caso 7 leftover)
    const androidHlc = '0019ef3300001-00000001-android';
    const dictionaryDb = join(desktopRoot, 'Readest', 'dictionary.db');
    execFileSync(
      'sqlite3',
      [
        dictionaryDb,
        `INSERT INTO _replicas VALUES (
        'dictionary-entry:android-entry-1', 'dictionary-entry', 'android-user',
        '{}', NULL, NULL, NULL, '${androidHlc}', 1
      )`,
      ],
      { encoding: 'utf8' },
    );
    // Also need the visible row to exist so it shows in push
    execFileSync(
      'sqlite3',
      [
        dictionaryDb,
        `INSERT OR REPLACE INTO dictionary_entries VALUES (
        'android-entry-1', 'alborada', 'Alborada', 'es', 'Luz del amanecer',
        NULL, 'Curious', 'ready', '{}', 1782178000000, 1782178000000, NULL
      )`,
      ],
      { encoding: 'utf8' },
    );

    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          const count = Array.isArray(body) ? (body as unknown[]).length : 0;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: count }));
        });
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(result.status).toBe(0);
      // Android-sourced entry should be skipped (already in _replicas with equal/higher HLC)
      expect(payload.replicas['dictionary-entry'].attempted).toBe(1); // only entry-1 passes
      expect(payload.replicas['dictionary-entry'].applied).toBe(1);
      // Other kinds still push normally
      expect(payload.replicas['dictionary-occurrence'].attempted).toBeGreaterThan(0);
      expect(payload.replicas.quote.attempted).toBeGreaterThan(0);
      expect(payload.replicas.annotation.attempted).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });
});

describe('dev sync reset harness', () => {
  it('defaults to dry-run and preserves declared dev targets', () => {
    const devRoot = makeTempRoot('dev-sync-reset');
    const counterFile = join(devRoot, 'biblioteca-dev-sync-counter.txt');
    writeFileSync(counterFile, '7', 'utf8');

    const output = runNode(resetScript, ['--target', 'tmp'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_SYNC_TMP_DIR: devRoot,
    });
    const payload = JSON.parse(output) as {
      dryRun: boolean;
      deleted: string[];
      preserved: string[];
    };

    expect(payload.dryRun).toBe(true);
    expect(payload.deleted).toEqual([]);
    expect(payload.preserved).toContain(counterFile);
    expect(readFileSync(counterFile, 'utf8')).toBe('7');
  });

  it('refuses destructive cleanup without the confirmation token', () => {
    const devRoot = makeTempRoot('dev-sync-reset');

    expect(() =>
      runNode(resetScript, ['--target', 'tmp', '--no-dry-run'], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_SYNC_TMP_DIR: devRoot,
      }),
    ).toThrow(/DELETE_DEV_SYNC_STATE/);
  });

  it('refuses cleanup when the target path is not an unambiguous dev sync path', () => {
    expect(() =>
      runNode(
        resetScript,
        ['--target', 'tmp', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
        {
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_SYNC_TMP_DIR: tmpdir(),
        },
      ),
    ).toThrow(/target path is not dev-sync scoped/);
  });

  it('deletes only declared dev sync state when confirmed', () => {
    const devRoot = makeTempRoot('dev-sync-reset');
    const counterFile = join(devRoot, 'biblioteca-dev-sync-counter.txt');
    const unrelatedFile = join(devRoot, 'reader-cache.sqlite');
    writeFileSync(counterFile, '11', 'utf8');
    writeFileSync(unrelatedFile, 'preserve me', 'utf8');

    const output = runNode(
      resetScript,
      ['--target', 'tmp', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
      {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_SYNC_TMP_DIR: devRoot,
      },
    );
    const payload = JSON.parse(output) as {
      dryRun: boolean;
      deleted: string[];
      preserved: string[];
    };

    expect(payload.dryRun).toBe(false);
    expect(payload.deleted).toEqual([counterFile]);
    expect(payload.preserved).toContain(unrelatedFile);
    expect(existsSync(counterFile)).toBe(false);
    expect(readFileSync(unrelatedFile, 'utf8')).toBe('preserve me');
  });

  it('declares package scripts for doctor, trigger, and reset work units', () => {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['dev:sync:doctor']).toBe('node scripts/dev-sync-doctor.mjs');
    expect(pkg.scripts['dev:sync:trigger']).toBe('node scripts/dev-sync-trigger.mjs');
    expect(pkg.scripts['dev:sync:reset']).toBe('node scripts/dev-sync-reset.mjs');
    expect(pkg.scripts['dev:sync:state']).toBe('node scripts/dev-sync-state.mjs');
    expect(pkg.scripts['dev:sync:inject']).toBe('node scripts/sync-dev-inject.mjs');
  });

  it('declares only dev:sync package scripts whose node entrypoints exist', () => {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const devSyncScripts = Object.entries(pkg.scripts).filter(([name]) =>
      name.startsWith('dev:sync:'),
    );

    expect(devSyncScripts.length).toBeGreaterThan(0);
    for (const [name, command] of devSyncScripts) {
      const match = command.match(/^node\s+(scripts\/[^\s]+\.mjs)$/);
      expect(match, `${name} must be a node .mjs command`).not.toBeNull();
      const scriptRelativePath = match?.[1];
      if (!scriptRelativePath) throw new Error(`${name} must be a node .mjs command`);
      const scriptPath = join(appRootPath, scriptRelativePath);
      expect(existsSync(scriptPath), `${name} points to missing ${scriptRelativePath}`).toBe(true);
      expect(statSync(scriptPath).isFile(), `${name} entrypoint must be a file`).toBe(true);
    }
  });

  it('dev:sync:inject emits stable JSON failure when required inputs are missing', () => {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const injectCommand = pkg.scripts['dev:sync:inject'];
    if (!injectCommand) throw new Error('dev:sync:inject script missing');
    const match = injectCommand.match(/^node\s+(scripts\/[^\s]+\.mjs)$/);
    if (!match) throw new Error('dev:sync:inject script must be node .mjs command');

    const scriptRelativePath = match[1];
    if (!scriptRelativePath) throw new Error('dev:sync:inject script path missing');
    const result = spawnSync(process.execPath, [join(appRootPath, scriptRelativePath)], {
      cwd: appRootPath,
      env: { ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as DevSyncJson;

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(payload).toMatchObject({ ok: false, status: 'fail', command: 'dev:sync:inject' });
    expect(payload.errors?.[0]?.message).toMatch(/--table.*--data.*--db-path/);
  });
});

interface SyncStateModule {
  captureDesktopState: (options: { dataRoot: string }) => Promise<{
    status: 'pass' | 'warn' | 'fail';
    db: { files: Array<{ name: string; exists: boolean }>; presentCount: number };
    library: {
      exists: boolean;
      backupExists: boolean;
      status: 'pass' | 'warn' | 'fail';
      summary: Record<string, unknown>;
    };
    settings: { exists: boolean };
    books: { dirCount: number };
    errors: Array<{ path: string; message: string }>;
  }>;
  captureAndroidState: (options: {
    packageName: string;
    serverUrl: string;
    runAdb: (args: string[]) => { ok: boolean; stdout: string; message?: string };
    fetchJson: (
      url: string,
    ) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;
  }) => Promise<{
    status: 'pass' | 'warn' | 'fail';
    root: string;
    library: {
      exists: boolean;
      backupExists: boolean;
      status: 'pass' | 'warn' | 'fail';
      summary: Record<string, unknown>;
    };
    settings: { exists: boolean };
    books: { dirCount: number };
    manifest: {
      status: 'pass' | 'warn' | 'fail';
      httpStatus?: number;
      error?: string;
      summary: Record<string, unknown>;
    };
    errors: Array<{ path?: string; message: string }>;
  }>;
}

describe('dev sync state capture harness', () => {
  it('captures desktop DB, library, settings, and book directory state without mutating files', async () => {
    const { captureDesktopState } = (await import(
      pathToFileURL(stateModule).href
    )) as SyncStateModule;
    const devRoot = makeTempRoot('desktop-state');
    const readestDir = join(devRoot, 'Readest');
    const booksDir = join(readestDir, 'Books');
    mkdirRecursive(join(booksDir, 'book-a'));
    mkdirRecursive(join(booksDir, 'book-b'));
    // Create valid SQLite DB files for the extended state capture
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'annotations.db'),
        'CREATE TABLE annotations (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT)',
      ],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'citas.db'),
        'CREATE TABLE quotes (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT)',
      ],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'dictionary.db'),
        'CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT)',
      ],
      { encoding: 'utf8' },
    );
    writeFileSync(
      join(booksDir, 'library.json'),
      JSON.stringify([{ id: 'a' }, { id: 'b' }]),
      'utf8',
    );
    writeFileSync(join(booksDir, 'library.json.bak'), '[]', 'utf8');
    writeFileSync(join(readestDir, 'settings.json'), '{"theme":"dark"}', 'utf8');

    const snapshot = await captureDesktopState({ dataRoot: devRoot });

    expect(snapshot.status).toBe('pass');
    expect(snapshot.db.presentCount).toBe(3);
    expect(snapshot.db.files.filter((file) => file.exists).map((file) => file.name)).toEqual([
      'annotations.db',
      'citas.db',
      'dictionary.db',
    ]);
    expect(snapshot.library).toMatchObject({ exists: true, backupExists: true, status: 'pass' });
    expect(snapshot.library.summary).toEqual({ kind: 'array', count: 2 });
    expect(snapshot.settings.exists).toBe(true);
    expect(snapshot.books.dirCount).toBe(2);
    expect(snapshot.errors).toEqual([]);
  });

  it('reports missing desktop state as structured warnings instead of throwing', async () => {
    const { captureDesktopState } = (await import(
      pathToFileURL(stateModule).href
    )) as SyncStateModule;
    const devRoot = makeTempRoot('desktop-state-missing');

    const snapshot = await captureDesktopState({ dataRoot: devRoot });

    expect(snapshot.status).toBe('warn');
    expect(snapshot.db.presentCount).toBe(0);
    expect(snapshot.library).toMatchObject({ exists: false, backupExists: false, status: 'warn' });
    expect(snapshot.library.summary).toEqual({ kind: 'missing' });
    expect(snapshot.settings.exists).toBe(false);
    expect(snapshot.books.dirCount).toBe(0);
  });

  it('captures Android state through absolute adb run-as paths and manifest status', async () => {
    const { captureAndroidState } = (await import(
      pathToFileURL(stateModule).href
    )) as SyncStateModule;
    const adbCalls: string[][] = [];

    const snapshot = await captureAndroidState({
      packageName: 'io.github.Napster0x.biblioteca',
      serverUrl: 'http://127.0.0.1:7878',
      runAdb: (args) => {
        adbCalls.push(args);
        const command = args.join(' ');
        if (command.includes('library.json.bak')) return { ok: true, stdout: '' };
        if (command.includes('library.json'))
          return { ok: true, stdout: '[{"id":"android-book"}]' };
        if (command.includes('settings.json')) return { ok: true, stdout: '{"locale":"en"}' };
        if (command.includes('find') && command.includes('/Books'))
          return { ok: true, stdout: 'book-a\nbook-b\n' };
        if (command.includes('test -e')) return { ok: true, stdout: '' };
        if (command.includes('sqlite3') && command.includes('sqlite_master'))
          return { ok: true, stdout: '[]' };
        if (command.includes('sqlite3')) return { ok: true, stdout: '[]' };
        return { ok: false, stdout: '', message: `unexpected adb call: ${command}` };
      },
      fetchJson: async () => ({ ok: true, status: 200, data: { books: [{ id: 'android-book' }] } }),
    });

    expect(snapshot.status).toBe('pass');
    expect(snapshot.root).toBe('/data/data/io.github.Napster0x.biblioteca/Readest');
    expect(snapshot.library.summary).toEqual({ kind: 'array', count: 1 });
    expect(snapshot.settings.exists).toBe(true);
    expect(snapshot.books.dirCount).toBe(2);
    expect(snapshot.manifest).toMatchObject({
      status: 'pass',
      httpStatus: 200,
      summary: { kind: 'object', keys: ['books'] },
    });
    expect(
      adbCalls.some((args) =>
        args.includes('/data/data/io.github.Napster0x.biblioteca/Readest/Books/library.json'),
      ),
    ).toBe(true);
  });

  it('prints JSON with warning statuses when Android manifest is unreachable', () => {
    const result = spawnSync(process.execPath, [stateScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: makeTempRoot('state-cli-missing'),
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      status: 'pass' | 'warn' | 'fail';
      desktop: { status: 'pass' | 'warn' | 'fail' };
      android: { manifest: { status: 'pass' | 'warn' | 'fail'; error?: string } };
    };

    expect(result.status).toBe(0);
    expect(payload.ok).toBe(false);
    expect(payload.status).toBe('warn');
    expect(payload.desktop.status).toBe('warn');
    expect(payload.android.manifest.status).toBe('warn');
    expect(payload.android.manifest.error).toMatch(/unreachable|fetch failed/i);
  });
});

describe('dev sync control plane routes', () => {
  it('rejects dev sync health checks without the dev harness guard', async () => {
    delete process.env['BIBLIOTECA_DEV_SYNC_HARNESS'];
    Reflect.deleteProperty(process.env, 'NODE_ENV');

    const route = await import('@/app/api/dev-sync/health/route');
    const response = await route.GET();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ ok: false, error: 'dev-sync-harness-disabled' });
  });

  it('reports non-mutating dev sync readiness metadata when enabled', async () => {
    process.env['BIBLIOTECA_DEV_SYNC_HARNESS'] = '1';

    const route = await import('@/app/api/dev-sync/health/route');
    const response = await route.GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: 'pass',
      controlPlane: 'dev-sync',
      mutation: 'none',
    });
    expect(payload.version).toMatch(/^dev-sync-control-plane-/);
  });
});

describe('dev sync environment model', () => {
  it('uses safe desktop and Android defaults for the real-device sync harness', async () => {
    const { createSyncDevEnvironment } = await import(pathToFileURL(envModule).href);

    const env = createSyncDevEnvironment({});

    expect(env.desktop.dataRoot).toBe(
      '/home/napster/.local/share/io.github.Napster0x.biblioteca.dev',
    );
    expect(env.desktop.readestDir).toBe(
      '/home/napster/.local/share/io.github.Napster0x.biblioteca.dev/Readest',
    );
    expect(env.desktop.syncTriggerUrl).toBe('http://localhost:3000/api/sync-trigger');
    expect(env.android.packageName).toBe('io.github.Napster0x.biblioteca');
    expect(env.android.readestDir).toBe('/data/data/io.github.Napster0x.biblioteca/Readest');
    expect(env.android.serverUrl).toBe('http://localhost:7878');
  });

  it('derives Readest paths from overrides without changing unrelated defaults', async () => {
    const { createSyncDevEnvironment } = await import(pathToFileURL(envModule).href);

    const env = createSyncDevEnvironment({
      BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: '/tmp/biblioteca-dev-sync-root',
      BIBLIOTECA_DEV_ANDROID_PACKAGE: 'io.github.Napster0x.biblioteca.debug',
      BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:8787',
    });

    expect(env.desktop.dataRoot).toBe('/tmp/biblioteca-dev-sync-root');
    expect(env.desktop.readestDir).toBe('/tmp/biblioteca-dev-sync-root/Readest');
    expect(env.desktop.syncTriggerUrl).toBe('http://localhost:3000/api/sync-trigger');
    expect(env.android.packageName).toBe('io.github.Napster0x.biblioteca.debug');
    expect(env.android.readestDir).toBe('/data/data/io.github.Napster0x.biblioteca.debug/Readest');
    expect(env.android.serverUrl).toBe('http://127.0.0.1:8787');
  });

  it('documents the USB tunnel contract as adb forward from host localhost to Android 7878', async () => {
    const { createSyncDevEnvironment } = await import(pathToFileURL(envModule).href);

    const env = createSyncDevEnvironment({ BIBLIOTECA_DEV_ANDROID_SERIAL: 'device-123' });

    expect(env.android.serverUrl).toBe('http://localhost:7878');
    expect(env.android.usbTunnel).toEqual({
      command: 'adb',
      args: ['-s', 'device-123', 'forward', 'tcp:7878', 'tcp:7878'],
      direction: 'host-to-android',
    });
  });
});

describe('dev sync doctor harness', () => {
  it('prints structured JSON checks without mutating state when prerequisites are missing', () => {
    const desktopRoot = makeTempRoot('doctor-desktop');

    const result = spawnSync(process.execPath, [doctorScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_DESKTOP_DEV_SYNC_HEALTH_URL: 'http://127.0.0.1:9/api/dev-sync/health',
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      status: 'pass' | 'warn' | 'fail';
      checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
    };

    expect(result.status).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.status).toBe('fail');
    expect(payload.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'adb.available',
        'android.device',
        'android.runAs',
        'android.readestDir',
        'android.health',
        'android.manifest',
        'desktop.dataRoot',
        'desktop.readestDir',
        'desktop.devSyncHealth',
        'desktop.syncTrigger',
      ]),
    );
    expect(payload.checks.find((check) => check.name === 'desktop.devSyncHealth')?.status).toBe(
      'warn',
    );
    expect(payload.checks.find((check) => check.name === 'desktop.syncTrigger')?.status).toBe(
      'warn',
    );
  });

  it('exits non-zero while preserving JSON output when doctor status is fail', () => {
    const desktopRoot = makeTempRoot('doctor-exit-code');

    const result = spawnSync(process.execPath, [doctorScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as { status: 'pass' | 'warn' | 'fail' };

    expect(payload.status).toBe('fail');
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
  });

  it('includes sqlite3 CLI and replica API checks in doctor output', () => {
    const desktopRoot = makeTempRoot('doctor-extended');

    const result = spawnSync(process.execPath, [doctorScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
    };

    expect(payload.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['desktop.sqlite3Cli', 'android.sqlite3Cli', 'android.replicasApi']),
    );
  });

  it('desktop.sqlite3Cli reports pass when sqlite3 is available in PATH', () => {
    const desktopRoot = makeTempRoot('doctor-sqlite3');

    const result = spawnSync(process.execPath, [doctorScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
    };

    const sqliteCheck = payload.checks.find((c) => c.name === 'desktop.sqlite3Cli');
    expect(sqliteCheck).toBeDefined();
    expect(sqliteCheck!.status).toBe('pass');
  });

  it('doctor includes adb.forward check in output when adb is available', () => {
    const desktopRoot = makeTempRoot('doctor-forward');

    const result = spawnSync(process.execPath, [doctorScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      checks: Array<{ name: string; status: string; message: string }>;
    };

    expect(payload.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['adb.forward']));
  });

  it('android.replicasApi reports warn when replica endpoints are unreachable', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');
    const port = address.port;

    try {
      const desktopRoot = makeTempRoot('doctor-replicas');
      const { stdout } = await spawnNode(doctorScript, ['--json'], {
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${port}`,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      });

      const payload = JSON.parse(stdout) as {
        checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
      };

      const replicasCheck = payload.checks.find((c) => c.name === 'android.replicasApi');
      expect(replicasCheck).toBeDefined();
      // Server returns 200 for all /replicas/:kind → all reachable → pass
      expect(replicasCheck!.status).toBe('pass');
    } finally {
      server.close();
    }
  });
});

describe('dev sync reset extended targets', () => {
  // ── desktop-db ──────────────────────────────────────────

  it('recognises --target desktop-db and does dry-run by default', () => {
    const devRoot = makeTempRoot('desktop-db');
    // Place the dev marker so the path is accepted
    writeFileSync(join(devRoot, '.biblioteca-dev-sync'), '1', 'utf8');
    // Create the expected directory structure
    const readestDir = join(devRoot, 'Readest');
    const booksDir = join(readestDir, 'Books');
    const localSyncDir = join(devRoot, 'local-sync');
    const replicasDir = join(localSyncDir, 'replicas');
    mkdirRecursive(readestDir);
    mkdirRecursive(booksDir);
    mkdirRecursive(replicasDir);
    writeFileSync(join(readestDir, 'annotations.db'), 'data', 'utf8');
    writeFileSync(join(readestDir, 'citas.db'), 'data', 'utf8');
    writeFileSync(join(readestDir, 'dictionary.db'), 'data', 'utf8');
    writeFileSync(join(booksDir, 'library.json'), '[]', 'utf8');
    writeFileSync(join(replicasDir, 'replica-abc.json'), '{}', 'utf8');

    const output = runNode(resetScript, ['--target', 'desktop-db'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_DESKTOP_DB_DIR: devRoot,
    });
    const payload = JSON.parse(output) as {
      ok: boolean;
      target: string;
      dryRun: boolean;
      root: string;
      deleted: string[];
      preserved: string[];
    };

    expect(payload.ok).toBe(true);
    expect(payload.target).toBe('desktop-db');
    expect(payload.dryRun).toBe(true);
    expect(payload.deleted).toEqual([]);
    // All existing files should be listed as preserved in dry-run
    expect(payload.preserved.length).toBeGreaterThanOrEqual(3);
    expect(payload.preserved.some((p) => p.endsWith('annotations.db'))).toBe(true);
    expect(payload.preserved.some((p) => p.endsWith('citas.db'))).toBe(true);
    expect(payload.preserved.some((p) => p.endsWith('dictionary.db'))).toBe(true);
  });

  it('requires the dev marker for the configured desktop data root', () => {
    const devRoot = makeTempRoot('desktop-db-configured-root');

    expect(() =>
      runNode(resetScript, ['--target', 'desktop-db'], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: devRoot,
      }),
    ).toThrow(/dev marker.*desktop-db-configured-root/i);
  });

  it('refuses --target desktop-db when path lacks the dev marker file', () => {
    const devRoot = makeTempRoot('desktop-db');
    // NO .biblioteca-dev-sync marker

    expect(() =>
      runNode(resetScript, ['--target', 'desktop-db'], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DB_DIR: devRoot,
      }),
    ).toThrow(/dev marker/i);
  });

  it('refuses --target desktop-db when path is a home directory', () => {
    expect(() =>
      runNode(resetScript, ['--target', 'desktop-db'], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DB_DIR: process.env['HOME'] ?? '/home',
      }),
    ).toThrow(/unsafe|refusing/i);
  });

  it('deletes declared desktop DB files when confirmed', () => {
    const devRoot = makeTempRoot('desktop-db');
    writeFileSync(join(devRoot, '.biblioteca-dev-sync'), '1', 'utf8');
    const readestDir = join(devRoot, 'Readest');
    mkdirRecursive(join(readestDir, 'Books'));
    mkdirRecursive(join(devRoot, 'local-sync', 'replicas'));
    writeFileSync(join(readestDir, 'annotations.db'), 'old', 'utf8');
    writeFileSync(join(readestDir, 'citas.db'), 'old', 'utf8');
    // Create an unrelated file that should be preserved
    const unrelatedFile = join(devRoot, 'Readest', 'reader-config.json');
    writeFileSync(unrelatedFile, 'keep-me', 'utf8');

    const output = runNode(
      resetScript,
      ['--target', 'desktop-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
      {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DB_DIR: devRoot,
      },
    );
    const payload = JSON.parse(output) as {
      ok: boolean;
      dryRun: boolean;
      deleted: string[];
      preserved: string[];
    };

    expect(payload.ok).toBe(true);
    expect(payload.dryRun).toBe(false);
    expect(payload.deleted.some((p) => p.endsWith('annotations.db'))).toBe(true);
    expect(payload.deleted.some((p) => p.endsWith('citas.db'))).toBe(true);
    // Unknown files must be preserved
    expect(payload.preserved).toContain(unrelatedFile);
    expect(existsSync(join(readestDir, 'annotations.db'))).toBe(false);
    expect(existsSync(join(readestDir, 'citas.db'))).toBe(false);
    expect(existsSync(unrelatedFile)).toBe(true);
  });

  it('covers DB sidecars, library/settings backups, and book dirs from root and Readest', () => {
    const devRoot = makeTempRoot('desktop-db');
    writeFileSync(join(devRoot, '.biblioteca-dev-sync'), '1', 'utf8');
    const readestDir = join(devRoot, 'Readest');
    const booksDir = join(readestDir, 'Books');
    mkdirRecursive(booksDir);
    mkdirRecursive(join(devRoot, 'Books', 'root-book'));
    mkdirRecursive(join(booksDir, 'readest-book'));

    const expectedTargets = [
      join(readestDir, 'annotations.db'),
      join(readestDir, 'annotations.db-wal'),
      join(readestDir, 'annotations.db-shm'),
      join(booksDir, 'library.json'),
      join(booksDir, 'library.json.bak'),
      join(readestDir, 'settings.json'),
      join(readestDir, 'settings.json.bak'),
      join(devRoot, 'settings.json'),
      join(devRoot, 'settings.json.bak'),
      join(devRoot, 'Books', 'root-book'),
      join(booksDir, 'readest-book'),
    ];
    for (const target of expectedTargets) {
      if (target.endsWith('root-book') || target.endsWith('readest-book')) continue;
      writeFileSync(target, 'dev-state', 'utf8');
    }

    const output = runNode(
      resetScript,
      ['--target', 'desktop-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
      {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: devRoot,
      },
    );
    const payload = JSON.parse(output) as { deleted: string[]; counts: { remaining: number } };

    for (const target of expectedTargets) {
      expect(payload.deleted).toContain(target);
      expect(existsSync(target)).toBe(false);
    }
    expect(payload.counts.remaining).toBe(0);
  });

  // ── android-db ──────────────────────────────────────────

  it('recognises --target android-db and does dry-run by default', () => {
    const output = runNode(resetScript, ['--target', 'android-db', '--dry-run'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
    });
    const payload = JSON.parse(output) as {
      ok: boolean;
      target: string;
      dryRun: boolean;
      androidPackage: string;
    };

    expect(payload.ok).toBe(true);
    expect(payload.target).toBe('android-db');
    expect(payload.dryRun).toBe(true);
    expect(payload.androidPackage).toBe('io.github.Napster0x.biblioteca');
  });

  it('refuses --target android-db without dev harness', () => {
    // No BIBLIOTECA_DEV_SYNC_HARNESS, no NODE_ENV=development
    const env: EnvOverrides = { ...process.env };
    delete env['BIBLIOTECA_DEV_SYNC_HARNESS'];
    delete env['NODE_ENV'];

    expect(() => runNode(resetScript, ['--target', 'android-db'], env)).toThrow(
      /BIBLIOTECA_DEV_SYNC_HARNESS|NODE_ENV/,
    );
  });

  it('clears Android local sync runtime state after confirmed adb cleanup', async () => {
    const binDir = makeTempRoot('android-reset-bin');
    const adbLog = join(binDir, 'adb.log');
    const adbPath = join(binDir, 'adb');
    writeFileSync(
      adbPath,
      `#!/usr/bin/env sh
printf '%s\n' "$*" >> "${adbLog}"
if [ "$1" = "version" ]; then
  printf 'Android Debug Bridge version 1.0.41\n'
fi
exit 0
`,
      'utf8',
    );
    chmodSync(adbPath, 0o755);
    const runtimeRequests: Array<{
      method: string | undefined;
      url: string | undefined;
      guard: string | undefined;
      body: string;
    }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        runtimeRequests.push({
          method: req.method,
          url: req.url,
          guard: req.headers['x-biblioteca-dev-sync-harness'] as string | undefined,
          body,
        });
        if (req.method === 'POST' && req.url === '/__dev/reset') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, cleared: { replicas: 2 } }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(
        resetScript,
        ['--target', 'android-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
        {
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
        },
      );
      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        runtimeReset: {
          attempted: boolean;
          ok: boolean;
          endpoint: string;
          status: number;
          restartRequired?: boolean;
        };
        errors: Array<{ message: string }>;
      };

      expect(result.status).toBe(0);
      expect(payload.ok).toBe(true);
      expect(payload.runtimeReset).toMatchObject({
        attempted: true,
        ok: true,
        endpoint: '/__dev/reset',
        status: 200,
      });
      expect(payload.errors).toEqual([]);
      expect(runtimeRequests).toHaveLength(1);
      expect(runtimeRequests[0]).toMatchObject({
        method: 'POST',
        url: '/__dev/reset',
        guard: 'DELETE_DEV_SYNC_STATE',
      });
      expect(JSON.parse(runtimeRequests[0]?.body ?? '{}')).toEqual({ target: 'android-db' });
      expect(readFileSync(adbLog, 'utf8')).toContain(
        'shell run-as io.github.Napster0x.biblioteca rm -rf',
      );
    } finally {
      server.close();
    }
  });

  it('reports a manual restart requirement when Android runtime clear endpoint is unavailable', async () => {
    const binDir = makeTempRoot('android-reset-bin');
    const adbPath = join(binDir, 'adb');
    writeFileSync(adbPath, '#!/usr/bin/env sh\nexit 0\n', 'utf8');
    chmodSync(adbPath, 0o755);
    const server = createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(
        resetScript,
        ['--target', 'android-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
        {
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
        },
      );
      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        runtimeReset: {
          attempted: boolean;
          ok: boolean;
          status: number;
          restartRequired?: boolean;
        };
        errors: Array<{ message: string }>;
      };

      expect(result.status).toBe(1);
      expect(payload.ok).toBe(false);
      expect(payload.runtimeReset).toMatchObject({
        attempted: true,
        ok: false,
        status: 404,
        restartRequired: true,
      });
      expect(payload.errors[0]?.message).toMatch(
        /Android runtime reset endpoint unavailable|restart/i,
      );
    } finally {
      server.close();
    }
  });

  // ── all ─────────────────────────────────────────────────

  it('recognises --target all and processes all sub-targets', () => {
    const tmpRoot = makeTempRoot('dev-sync-all-tmp');
    writeFileSync(join(tmpRoot, 'biblioteca-dev-sync-counter.txt'), '5', 'utf8');

    const desktopRoot = makeTempRoot('dev-sync-all-desktop');
    writeFileSync(join(desktopRoot, '.biblioteca-dev-sync'), '1', 'utf8');
    mkdirRecursive(join(desktopRoot, 'Readest', 'Books'));
    mkdirRecursive(join(desktopRoot, 'local-sync', 'replicas'));
    writeFileSync(join(desktopRoot, 'Readest', 'annotations.db'), 'data', 'utf8');

    const output = runNode(resetScript, ['--target', 'all'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_SYNC_TMP_DIR: tmpRoot,
      BIBLIOTECA_DEV_DESKTOP_DB_DIR: desktopRoot,
    });
    const payload = JSON.parse(output) as {
      ok: boolean;
      target: string;
      dryRun: boolean;
      targets: Array<{ target: string; deleted: string[]; preserved: string[] }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.target).toBe('all');
    expect(payload.dryRun).toBe(true);
    expect(payload.targets).toHaveLength(3);
    expect(payload.targets.map((t) => t.target)).toEqual(['tmp', 'desktop-db', 'android-db']);

    const tmpResult = payload.targets[0];
    if (!tmpResult) throw new Error('tmp reset result missing');
    expect(tmpResult.deleted).toEqual([]);
    expect(tmpResult.preserved.length).toBeGreaterThan(0);

    const desktopResult = payload.targets[1];
    if (!desktopResult) throw new Error('desktop reset result missing');
    expect(desktopResult.deleted).toEqual([]);
    expect(desktopResult.preserved.length).toBeGreaterThan(0);
  });
});

describe('dev sync cycle harness', () => {
  it('produces cycle JSON with runId, pre/post state summaries, trigger endpoint, attempts array, and verdict', () => {
    const reportDir = makeTempRoot('cycle-reports');
    const desktopRoot = makeTempRoot('cycle-desktop');

    const result = spawnSync(process.execPath, [cycleScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      runId: string;
      caseRef?: string;
      caseName?: string;
      pre: { desktop: Record<string, unknown>; android: Record<string, unknown> };
      post: { desktop: Record<string, unknown>; android: Record<string, unknown> };
      trigger: { endpoint: string; response?: unknown };
      attempts: Array<{ attempt: number; ok: boolean; error?: string }>;
      verdict: string;
      reportPath: string;
    };

    expect(payload.runId).toMatch(/^dev-sync-cycle-/);
    expect(payload.pre.desktop).toBeDefined();
    expect(payload.pre.android).toBeDefined();
    expect(payload.post.desktop).toBeDefined();
    expect(payload.post.android).toBeDefined();
    expect(payload.trigger.endpoint).toMatch(/api\/sync-trigger/);
    expect(payload.attempts.length).toBeGreaterThan(0);
    expect(
      payload.attempts.every((a) => typeof a.attempt === 'number' && typeof a.ok === 'boolean'),
    ).toBe(true);
    expect(['pass', 'warn', 'fail']).toContain(payload.verdict);
    expect(payload.reportPath).toBeDefined();
    expect(payload.reportPath).toMatch(/\.json$/);
    expect(payload.reportPath).toContain(payload.runId);
  });

  it('records caseRef and caseName in the report when passed as CLI flags', () => {
    const reportDir = makeTempRoot('cycle-reports');
    const desktopRoot = makeTempRoot('cycle-desktop');

    const result = spawnSync(
      process.execPath,
      [cycleScript, '--json', '--case-ref', 'TC-42', '--case-name', 'one-way-create'],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
          BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
          BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as { caseRef?: string; caseName?: string };

    expect(payload.caseRef).toBe('TC-42');
    expect(payload.caseName).toBe('one-way-create');
  });

  it('records two retry attempts when the trigger endpoint is unreachable', () => {
    const reportDir = makeTempRoot('cycle-reports');
    const desktopRoot = makeTempRoot('cycle-desktop');

    const result = spawnSync(process.execPath, [cycleScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      attempts: Array<{ attempt: number; ok: boolean; error?: string }>;
      verdict: string;
    };

    expect(payload.attempts).toHaveLength(2);
    expect(payload.attempts[0]).toMatchObject({ attempt: 1, ok: false });
    expect(payload.attempts[1]).toMatchObject({ attempt: 2, ok: false });
    expect(payload.verdict).toBe('fail');
  });

  it('rejects nested trigger failures in cycle reports with an evidence path', async () => {
    const reportDir = makeTempRoot('cycle-nested-fail');
    const desktopRoot = makeTempRoot('cycle-desktop');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, syncResult: { ok: false, error: 'quote pull failed' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(cycleScript, ['--json'], {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: `http://127.0.0.1:${address.port}/api/sync-trigger`,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
      });
      const payload = JSON.parse(result.stdout) as {
        verdict: string;
        trigger: { evidence?: { path?: string; nested?: { error?: string } } };
        attempts: Array<{ ok: boolean; evidencePath?: string; error?: string }>;
      };

      expect(payload.verdict).toBe('fail');
      expect(payload.trigger.evidence?.path).toBe('syncResult');
      expect(payload.trigger.evidence?.nested?.error).toBe('quote pull failed');
      expect(payload.attempts[0]).toMatchObject({ ok: false, evidencePath: 'syncResult' });
    } finally {
      server.close();
    }
  });

  it('reports partial cycle trigger evidence as ambiguous instead of pass', async () => {
    const reportDir = makeTempRoot('cycle-partial');
    const desktopRoot = makeTempRoot('cycle-desktop');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, runId: 'dev-sync-partial', syncResult: { ok: true } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(cycleScript, ['--json'], {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: `http://127.0.0.1:${address.port}/api/sync-trigger`,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
      });
      const payload = JSON.parse(result.stdout) as {
        verdict: string;
        trigger: { status?: string; evidence?: { unavailable?: string[] } };
      };

      expect(payload.verdict).toBe('ambiguous');
      expect(payload.trigger.status).toBe('fail');
      expect(payload.trigger.evidence?.unavailable).toContain('syncResult.evidence.path');
    } finally {
      server.close();
    }
  });

  it('writes a JSON report file to the cycle report directory', () => {
    const reportDir = makeTempRoot('cycle-reports');
    const desktopRoot = makeTempRoot('cycle-desktop');

    const result = spawnSync(process.execPath, [cycleScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as { reportPath: string; runId: string };

    expect(existsSync(payload.reportPath)).toBe(true);
    const fileContent = JSON.parse(readFileSync(payload.reportPath, 'utf8')) as { runId: string };
    expect(fileContent.runId).toBe(payload.runId);
  });

  it('declares dev:sync:cycle in package.json scripts', () => {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:sync:cycle']).toBe('node scripts/dev-sync-cycle.mjs');
  });
});

describe('dev sync doctor ADB forward check', () => {
  it('parseAdbForwardList finds expected tunnel in adb forward --list output', async () => {
    const { parseAdbForwardList } = await import(pathToFileURL(envModule).href);
    const output = ['device-123 tcp:7878 tcp:7878', 'device-123 tcp:9000 tcp:9000'].join('\n');

    const result = parseAdbForwardList(output, 'tcp:7878', 'tcp:7878');
    expect(result.found).toBe(true);
    expect(result.tunnels).toHaveLength(2);
    const tunnel = result.tunnels[0];
    if (!tunnel) throw new Error('expected first tunnel');
    expect(tunnel.serial).toBe('device-123');
    expect(tunnel.local).toBe('tcp:7878');
    expect(tunnel.remote).toBe('tcp:7878');
  });

  it('parseAdbForwardList returns found=false when tunnel is missing', async () => {
    const { parseAdbForwardList } = await import(pathToFileURL(envModule).href);
    const output = 'device-123 tcp:9000 tcp:9000\n';

    const result = parseAdbForwardList(output, 'tcp:7878', 'tcp:7878');
    expect(result.found).toBe(false);
    expect(result.tunnels).toHaveLength(1);
    expect(result.tunnels[0]?.local).toBe('tcp:9000');
  });

  it('parseAdbForwardList returns found=false for empty output', async () => {
    const { parseAdbForwardList } = await import(pathToFileURL(envModule).href);

    const result = parseAdbForwardList('', 'tcp:7878', 'tcp:7878');
    expect(result.found).toBe(false);
    expect(result.tunnels).toEqual([]);
  });

  it('parseAdbForwardList finds tunnel only for the specified serial', async () => {
    const { parseAdbForwardList } = await import(pathToFileURL(envModule).href);
    const output = ['device-456 tcp:7878 tcp:7878', 'device-123 tcp:7878 tcp:7878'].join('\n');

    const result = parseAdbForwardList(output, 'tcp:7878', 'tcp:7878', 'device-123');
    expect(result.found).toBe(true);
    expect(result.tunnels).toHaveLength(2);
    expect(result.tunnelForSerial?.serial).toBe('device-123');
  });

  it('parseAdbForwardList returns found=false when serial does not match', async () => {
    const { parseAdbForwardList } = await import(pathToFileURL(envModule).href);
    const output = 'device-456 tcp:7878 tcp:7878\n';

    const result = parseAdbForwardList(output, 'tcp:7878', 'tcp:7878', 'device-123');
    expect(result.found).toBe(false);
  });
});

describe('dev sync toggle contradiction detection', () => {
  it('detectToggleContradiction reports clean when toggle is off and health is down', async () => {
    const { detectToggleContradiction } = await import(pathToFileURL(envModule).href);
    const result = detectToggleContradiction(
      { enabled: false, port: null },
      { desktopOk: false, androidOk: false },
    );
    expect(result.hasContradiction).toBe(false);
    expect(result.verdict).toBe('clean');
  });

  it('detectToggleContradiction reports clean when toggle is on and health is up', async () => {
    const { detectToggleContradiction } = await import(pathToFileURL(envModule).href);
    const result = detectToggleContradiction(
      { enabled: true, port: 7878 },
      { desktopOk: true, androidOk: true },
    );
    expect(result.hasContradiction).toBe(false);
    expect(result.verdict).toBe('clean');
  });

  it('detectToggleContradiction reports ambiguous when toggle is on but health is down', async () => {
    const { detectToggleContradiction } = await import(pathToFileURL(envModule).href);
    const result = detectToggleContradiction(
      { enabled: true, port: 7878 },
      { desktopOk: false, androidOk: true },
    );
    expect(result.hasContradiction).toBe(true);
    expect(result.verdict).toBe('AMBIGUOUS');
    expect(result.detail).toMatch(/desktop/i);
  });

  it('detectToggleContradiction reports ambiguous when toggle is on but android health is down', async () => {
    const { detectToggleContradiction } = await import(pathToFileURL(envModule).href);
    const result = detectToggleContradiction(
      { enabled: true, port: 7878 },
      { desktopOk: true, androidOk: false },
    );
    expect(result.hasContradiction).toBe(true);
    expect(result.verdict).toBe('AMBIGUOUS');
    expect(result.detail).toMatch(/android/i);
  });

  it('detectToggleContradiction with mixed health states reports partial contradiction', async () => {
    const { detectToggleContradiction } = await import(pathToFileURL(envModule).href);
    const result = detectToggleContradiction(
      { enabled: true, port: 7878 },
      { desktopOk: false, androidOk: false },
    );
    expect(result.hasContradiction).toBe(true);
    expect(result.verdict).toBe('AMBIGUOUS');
    expect(result.detail).toMatch(/desktop and android/i);
  });

  it('parseToggleState extracts enabled state from settings.json content', async () => {
    const { parseToggleState } = await import(pathToFileURL(envModule).href);
    const result = parseToggleState(JSON.stringify({ localSync: { enabled: true, port: 7878 } }));
    expect(result.enabled).toBe(true);
    expect(result.port).toBe(7878);
  });

  it('parseToggleState returns enabled=false when localSync is missing', async () => {
    const { parseToggleState } = await import(pathToFileURL(envModule).href);
    const result = parseToggleState(JSON.stringify({ theme: 'dark' }));
    expect(result.enabled).toBe(false);
    expect(result.port).toBeNull();
  });

  it('parseToggleState returns enabled=false for missing or empty content', async () => {
    const { parseToggleState } = await import(pathToFileURL(envModule).href);
    expect(parseToggleState('').enabled).toBe(false);
    expect(parseToggleState(null).enabled).toBe(false);
    expect(parseToggleState(undefined).enabled).toBe(false);
  });
});

describe('dev sync planner engine', () => {
  const planScript = join(appRootPath, 'scripts/dev-sync-plan.mjs');

  it('refuses build without explicit authorization token', () => {
    const result = spawnSync(process.execPath, [planScript, '--json', '--plan', 'build'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      steps: Array<{ operation: string; status: string; message: string }>;
    };
    expect(result.status).toBe(0);
    expect(payload.ok).toBe(false);
    const buildStep = payload.steps.find((s) => s.operation === 'build');
    expect(buildStep).toBeDefined();
    expect(buildStep!.status).toBe('blocked');
    expect(buildStep!.message).toMatch(/authoriz|token|--authorize/i);
  });

  it('refuses install without explicit authorization token', () => {
    const result = spawnSync(process.execPath, [planScript, '--json', '--plan', 'install'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      steps: Array<{ operation: string; status: string }>;
    };
    const installStep = payload.steps.find((s) => s.operation === 'install');
    expect(installStep).toBeDefined();
    expect(installStep!.status).toBe('blocked');
  });

  it('refuses restart without explicit authorization token', () => {
    const result = spawnSync(process.execPath, [planScript, '--json', '--plan', 'restart'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      steps: Array<{ operation: string; status: string }>;
    };
    const restartStep = payload.steps.find((s) => s.operation === 'restart');
    expect(restartStep).toBeDefined();
    expect(restartStep!.status).toBe('blocked');
  });

  it('refuses global kill without explicit authorization token', () => {
    const result = spawnSync(process.execPath, [planScript, '--json', '--plan', 'kill'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      steps: Array<{ operation: string; status: string }>;
    };
    const killStep = payload.steps.find((s) => s.operation === 'kill');
    expect(killStep).toBeDefined();
    expect(killStep!.status).toBe('blocked');
  });

  it('produces dry-run plan steps with manual checklist for all operations', () => {
    const result = spawnSync(process.execPath, [planScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      steps: Array<{ operation: string; status: string; message: string; auth: string }>;
    };

    expect(Array.isArray(payload.steps)).toBe(true);
    expect(payload.steps.length).toBeGreaterThanOrEqual(4);
    const operations = payload.steps.map((s) => s.operation);
    expect(operations).toEqual(expect.arrayContaining(['build', 'install', 'restart', 'kill']));
    for (const step of payload.steps) {
      expect(step.status).toMatch(/^(pass|blocked)$/);
      expect(step.message).toBeTruthy();
      expect(step.auth).toMatch(/^(none|token)$/);
    }
  });

  it('allows all operations when authorization token is provided', () => {
    const result = spawnSync(
      process.execPath,
      [planScript, '--json', '--authorize', 'BIBLIOTECA_DEV_SYNC_PLAN'],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      steps: Array<{ operation: string; status: string }>;
    };

    expect(payload.ok).toBe(true);
    for (const step of payload.steps) {
      expect(step.status).toBe('pass');
    }
  });

  it('declares dev:sync:plan in package.json scripts', () => {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:sync:plan']).toBe('node scripts/dev-sync-plan.mjs');
  });
});

describe('dev sync doctor version check', () => {
  it('parses serverVersion, commit, and startedAt from Android /health response body', async () => {
    const { parseHealthVersion } = await import(pathToFileURL(envModule).href);

    const result = parseHealthVersion({
      serverVersion: '1.0.9',
      commit: 'abc1234',
      startedAt: '2026-06-21T12:00:00Z',
    });

    expect(result.found).toBe(true);
    expect(result.fields).toEqual(['serverVersion', 'commit', 'startedAt']);
    expect(result.serverVersion).toBe('1.0.9');
    expect(result.commit).toBe('abc1234');
    expect(result.startedAt).toBe('2026-06-21T12:00:00Z');
  });

  it('returns found=false when /health body lacks version fields', async () => {
    const { parseHealthVersion } = await import(pathToFileURL(envModule).href);

    const result = parseHealthVersion({ status: 'ok' });

    expect(result.found).toBe(false);
    expect(result.fields).toEqual([]);
    expect(result.serverVersion).toBeNull();
    expect(result.commit).toBeNull();
    expect(result.startedAt).toBeNull();
  });

  it('handles null, undefined, and non-object body gracefully', async () => {
    const { parseHealthVersion } = await import(pathToFileURL(envModule).href);

    expect(parseHealthVersion(null).found).toBe(false);
    expect(parseHealthVersion(undefined).found).toBe(false);
    expect(parseHealthVersion('not an object').found).toBe(false);
  });

  it('doctor reports version info in android.health check when /health returns version fields', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          serverVersion: '2.0.0',
          startedAt: '2026-06-21T12:00:00Z',
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');
    const port = address.port;

    try {
      const desktopRoot = makeTempRoot('doctor-version');
      const { stdout } = await spawnNode(doctorScript, ['--json'], {
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${port}`,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      });

      const payload = JSON.parse(stdout) as {
        checks: Array<{ name: string; status: string; version?: Record<string, unknown> }>;
      };

      const healthCheck = payload.checks.find((c) => c.name === 'android.health');
      expect(healthCheck).toBeDefined();
      expect(healthCheck!.status).toBe('pass');
      expect(healthCheck!.version).toBeDefined();
      expect(healthCheck!.version!['serverVersion']).toBe('2.0.0');
      expect(healthCheck!.version!['startedAt']).toBe('2026-06-21T12:00:00Z');
    } finally {
      server.close();
    }
  });

  it('doctor warns when android.health returns 200 but has no version fields', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');
    const port = address.port;

    try {
      const desktopRoot = makeTempRoot('doctor-noversion');
      const { stdout } = await spawnNode(doctorScript, ['--json'], {
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${port}`,
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
      });

      const payload = JSON.parse(stdout) as {
        checks: Array<{ name: string; status: string }>;
      };

      const healthCheck = payload.checks.find((c) => c.name === 'android.health');
      expect(healthCheck).toBeDefined();
      expect(healthCheck!.status).toBe('warn');
    } finally {
      server.close();
    }
  });
});

describe('dev sync multi-step cycle', () => {
  it('legacy path without --steps produces pre/post/attempts/verdict', () => {
    const reportDir = makeTempRoot('cycle-legacy');
    const desktopRoot = makeTempRoot('cycle-desktop');

    const result = spawnSync(process.execPath, [cycleScript, '--json'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
        BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
      },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      runId: string;
      pre: Record<string, unknown>;
      post: Record<string, unknown>;
      attempts: Array<{ attempt: number; ok: boolean }>;
      verdict: string;
      steps?: unknown[];
    };

    // Legacy format preserved: pre/post, not steps
    expect(payload.pre).toBeDefined();
    expect(payload.post).toBeDefined();
    expect(payload.attempts).toBeDefined();
    expect(payload.verdict).toBeDefined();
    expect(payload.steps).toBeUndefined();
    expect(payload.runId).toMatch(/^dev-sync-cycle-/);
  });

  it('multi-step with --steps snapshot-only produces steps array with verdict', () => {
    const reportDir = makeTempRoot('cycle-steps');
    const desktopRoot = makeTempRoot('cycle-desktop');

    const result = spawnSync(
      process.execPath,
      [
        cycleScript,
        '--json',
        '--steps',
        JSON.stringify([{ label: 'snapshot-1' }, { label: 'snapshot-2' }]),
      ],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
          BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
          BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as {
      runId: string;
      steps: Array<{ label: string; snapshot: Record<string, unknown>; ok: boolean }>;
      verdict: string;
    };

    expect(payload.steps).toBeDefined();
    expect(payload.steps).toHaveLength(2);
    const firstStep = payload.steps[0];
    const secondStep = payload.steps[1];
    if (!firstStep || !secondStep) throw new Error('expected two cycle steps');
    expect(firstStep.label).toBe('snapshot-1');
    expect(firstStep.snapshot).toBeDefined();
    expect(firstStep.ok).toBe(true);
    expect(secondStep.label).toBe('snapshot-2');
    expect(payload.verdict).toBeDefined();
    expect(payload.runId).toMatch(/^dev-sync-cycle-/);
  });

  it('malformed --steps JSON exits with error', () => {
    const reportDir = makeTempRoot('cycle-bad-steps');
    const desktopRoot = makeTempRoot('cycle-desktop');

    const result = spawnSync(
      process.execPath,
      [cycleScript, '--json', '--steps', 'not-valid-json'],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
          BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
          BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/steps|JSON|parse/i);
  });

  it('multi-step with prepare flag spawns injection script', () => {
    const reportDir = makeTempRoot('cycle-prepare');
    const desktopRoot = makeTempRoot('cycle-desktop');

    // Create a real SQLite DB that injection can write to
    const readestDir = join(desktopRoot, 'Readest');
    const booksDir = join(readestDir, 'Books');
    mkdirRecursive(booksDir);
    writeFileSync(join(booksDir, 'library.json'), '[]', 'utf8');
    writeFileSync(join(readestDir, 'settings.json'), '{}', 'utf8');
    execFileSync(
      'sqlite3',
      [join(readestDir, 'annotations.db'), 'CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)'],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [join(readestDir, 'citas.db'), 'CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)'],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [join(readestDir, 'dictionary.db'), 'CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)'],
      { encoding: 'utf8' },
    );

    const injectScript = join(appRootPath, 'scripts/sync-dev-inject.mjs');

    const result = spawnSync(
      process.execPath,
      [
        cycleScript,
        '--json',
        '--steps',
        JSON.stringify([
          {
            label: 'inject-row',
            prepare: {
              script: injectScript,
              args: [
                '--target',
                'desktop',
                '--db-path',
                join(readestDir, 'annotations.db'),
                '--table',
                't',
                '--data',
                JSON.stringify([{ id: 'r1', val: 'hello' }]),
              ],
            },
          },
          { label: 'post-inject' },
        ]),
      ],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
          BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
          BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as {
      steps: Array<{ label: string; ok: boolean }>;
      verdict: string;
    };

    expect(payload.steps).toBeDefined();
    expect(payload.steps).toHaveLength(2);
    const firstStep = payload.steps[0];
    if (!firstStep) throw new Error('expected inject cycle step');
    expect(firstStep.label).toBe('inject-row');
    expect(firstStep.ok).toBe(true);
  });
});

describe('dev sync data injection', () => {
  const injectModule = join(appRootPath, 'scripts/sync-dev-inject.mjs');

  it('rejects injection when BIBLIOTECA_DEV_SYNC_HARNESS is not set', async () => {
    const devRoot = makeTempRoot('inject-gate');
    const dbPath = join(devRoot, 'test.db');
    execFileSync('sqlite3', [dbPath, 'CREATE TABLE t (id TEXT, val TEXT)'], { encoding: 'utf8' });

    const { injectRows } = await import(pathToFileURL(injectModule).href);
    const result = injectRows({
      target: 'desktop',
      dbPath,
      table: 't',
      rows: [{ id: 'x', val: 'y' }],
      execFileSync,
      devHarnessEnabled: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/harness|BIBLIOTECA_DEV_SYNC_HARNESS/i);
  });

  it('inserts rows into desktop SQLite DB and returns inserted count', async () => {
    const devRoot = makeTempRoot('inject-insert');
    const dbPath = join(devRoot, 'test.db');
    execFileSync(
      'sqlite3',
      [
        dbPath,
        'CREATE TABLE annotations (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT)',
      ],
      { encoding: 'utf8' },
    );

    const { injectRows } = await import(pathToFileURL(injectModule).href);
    const result = injectRows({
      target: 'desktop',
      dbPath,
      table: 'annotations',
      rows: [
        { id: 'a1', book_hash: 'hash1', cfi: '/6/4', text: 'hello' },
        { id: 'a2', book_hash: 'hash2', cfi: '/6/8', text: 'world' },
      ],
      execFileSync,
      devHarnessEnabled: true,
    });
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(2);
    expect(result.target).toBe('desktop');
    expect(result.table).toBe('annotations');

    // Verify by re-reading the DB
    const countOutput = execFileSync(
      'sqlite3',
      [dbPath, '-json', 'SELECT count(*) AS c FROM annotations'],
      {
        encoding: 'utf8',
      },
    );
    const rows = JSON.parse(countOutput) as Array<{ c: number }>;
    const firstRow = rows[0];
    if (!firstRow) throw new Error('sqlite count row missing');
    expect(firstRow.c).toBe(2);
  });

  it('returns error for non-existent table injection', async () => {
    const devRoot = makeTempRoot('inject-bad-table');
    const dbPath = join(devRoot, 'test.db');
    execFileSync('sqlite3', [dbPath, 'CREATE TABLE existing (id TEXT)'], { encoding: 'utf8' });

    const { injectRows } = await import(pathToFileURL(injectModule).href);
    const result = injectRows({
      target: 'desktop',
      dbPath,
      table: 'nonexistent',
      rows: [{ id: 'x' }],
      execFileSync,
      devHarnessEnabled: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('updates existing rows when primary key conflicts', async () => {
    const devRoot = makeTempRoot('inject-update');
    const dbPath = join(devRoot, 'test.db');
    execFileSync('sqlite3', [dbPath, 'CREATE TABLE t (id TEXT PRIMARY KEY, val TEXT)'], {
      encoding: 'utf8',
    });
    execFileSync('sqlite3', [dbPath, "INSERT INTO t VALUES ('x', 'old')"], { encoding: 'utf8' });

    const { injectRows } = await import(pathToFileURL(injectModule).href);
    const result = injectRows({
      target: 'desktop',
      dbPath,
      table: 't',
      rows: [{ id: 'x', val: 'new' }],
      execFileSync,
      devHarnessEnabled: true,
      operation: 'replace',
    });
    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(1);

    const countOutput = execFileSync('sqlite3', [dbPath, '-json', 'SELECT count(*) AS c FROM t'], {
      encoding: 'utf8',
    });
    const countRows = JSON.parse(countOutput) as Array<{ c: number }>;
    const firstCountRow = countRows[0];
    if (!firstCountRow) throw new Error('sqlite count row missing');
    expect(firstCountRow.c).toBe(1);

    const valOutput = execFileSync('sqlite3', [dbPath, '-json', "SELECT val FROM t WHERE id='x'"], {
      encoding: 'utf8',
    });
    const valueRows = JSON.parse(valOutput) as Array<{ val: string }>;
    const firstValueRow = valueRows[0];
    if (!firstValueRow) throw new Error('sqlite value row missing');
    expect(firstValueRow.val).toBe('new');
  });
});

describe('dev sync sqlite row snapshot', () => {
  const sqliteModule = join(appRootPath, 'scripts/sync-dev-sqlite.mjs');

  function createSqliteDb(dbPath: string, ddl: string): void {
    execFileSync('sqlite3', [dbPath, ddl], { encoding: 'utf8' });
  }

  it('captures annotations DB with table structure, row counts, and HLC metadata', async () => {
    const devRoot = makeTempRoot('sqlite-db');
    const dbPath = join(devRoot, 'annotations.db');

    // Create a realistic annotations schema with replica_timestamps + deleted_at
    createSqliteDb(
      dbPath,
      [
        'CREATE TABLE annotations (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT, color TEXT, note TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, creator TEXT, type TEXT, style TEXT, replica_timestamps TEXT);',
        'CREATE TABLE _replicas (id TEXT PRIMARY KEY, data TEXT, version INTEGER, deleted INTEGER, timestamp TEXT);',
        "INSERT INTO annotations VALUES ('a1', 'hash1', '/6/4', 'hello', 'yellow', NULL, '2025-01-01', '2025-01-02', NULL, 'desktop', 'highlight', 'solid', '{\"desktop\":\"0000000000000001\"}');",
        "INSERT INTO annotations VALUES ('a2', 'hash1', '/6/8', 'world', 'blue', 'note', '2025-01-03', '2025-01-04', '2025-01-05', 'android', 'note', 'dashed', '{\"android\":\"0000000000000002\"}');",
        "INSERT INTO _replicas VALUES ('r1', '{}', 1, 0, NULL);",
      ].join('\n'),
    );

    const { captureAnnotationsDb, captureReplicasTable } = await import(
      pathToFileURL(sqliteModule).href
    );

    const result = captureAnnotationsDb({ dbPath, execFileSync });
    expect(result.available).toBe(true);
    expect(result.tables).toHaveLength(2);

    const annotationsTable = result.tables.find((t: { name: string }) => t.name === 'annotations');
    expect(annotationsTable).toBeDefined();
    expect(annotationsTable!.rowCount).toBe(2);
    expect(annotationsTable!.columns).toEqual(
      expect.arrayContaining([
        'id',
        'book_hash',
        'cfi',
        'text',
        'replica_timestamps',
        'deleted_at',
      ]),
    );
    expect(annotationsTable!.hlcMin).toBeTruthy();
    expect(annotationsTable!.hlcMax).toBeTruthy();
    expect(annotationsTable!.deletedCount).toBe(1);

    const replicasResult = captureReplicasTable({ dbPath, execFileSync });
    expect(replicasResult.available).toBe(true);
    expect(replicasResult.tables.length).toBeGreaterThanOrEqual(1);
    const replicasTable = replicasResult.tables.find(
      (t: { name: string }) => t.name === '_replicas',
    );
    expect(replicasTable).toBeDefined();
    expect(replicasTable!.rowCount).toBe(1);
  });

  it('reports available: false and warn when sqlite3 CLI is missing', async () => {
    const devRoot = makeTempRoot('sqlite-db');
    const dbPath = join(devRoot, 'annotations.db');
    writeFileSync(dbPath, 'not-a-real-db', 'utf8');

    const failingExec = () => {
      throw new Error('sqlite3 not found');
    };

    const { captureAnnotationsDb } = await import(pathToFileURL(sqliteModule).href);
    const result = captureAnnotationsDb({
      dbPath,
      execFileSync: failingExec as unknown as typeof execFileSync,
    });
    expect(result.available).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('captures dictionary DB with occurrences table', async () => {
    const devRoot = makeTempRoot('sqlite-db');
    const dbPath = join(devRoot, 'dictionary.db');

    createSqliteDb(
      dbPath,
      [
        'CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT, definition TEXT, language TEXT, enrichment_status TEXT, created_at TEXT, updated_at TEXT, replica_timestamps TEXT, deleted_at TEXT);',
        'CREATE TABLE dictionary_occurrences (id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, cfi TEXT, context TEXT, offset_start INTEGER, offset_end INTEGER, created_at TEXT, updated_at TEXT, replica_timestamps TEXT, deleted_at TEXT, position TEXT);',
        "INSERT INTO dictionary_entries VALUES ('de1', 'hola', 'greeting', 'es', 'raw', '2025-01-01', '2025-01-01', '{\"desktop\":\"0000000000000005\"}', NULL);",
        "INSERT INTO dictionary_occurrences VALUES ('do1', 'de1', 'hash1', '/6/4', 'Hola mundo', 0, 11, '2025-01-01', '2025-01-01', NULL, NULL, 'body');",
      ].join('\n'),
    );

    const { captureDictionaryDb } = await import(pathToFileURL(sqliteModule).href);
    const result = captureDictionaryDb({ dbPath, execFileSync });
    expect(result.available).toBe(true);
    expect(result.tables).toHaveLength(2);

    const entries = result.tables.find((t: { name: string }) => t.name === 'dictionary_entries');
    expect(entries!.rowCount).toBe(1);

    const occurrences = result.tables.find(
      (t: { name: string }) => t.name === 'dictionary_occurrences',
    );
    expect(occurrences!.rowCount).toBe(1);
    expect(occurrences!.columns).toEqual(
      expect.arrayContaining(['id', 'entry_id', 'cfi', 'replica_timestamps', 'deleted_at']),
    );
  });

  it('compareSchemas detects column differences between two table sets', async () => {
    const { compareSchemas } = await import(pathToFileURL(sqliteModule).href);

    const desktop = [
      { name: 'annotations', columns: ['id', 'book_hash', 'cfi', 'extra_col'] },
      { name: '_replicas', columns: ['id', 'data', 'version'] },
    ];
    const android = [
      { name: 'annotations', columns: ['id', 'book_hash', 'cfi'] },
      { name: '_replicas', columns: ['id', 'data', 'version', 'timestamp'] },
    ];

    const diffs = compareSchemas(desktop, android);
    expect(diffs).toHaveLength(2);
    const annotationsDiff = diffs.find((d: { table: string }) => d.table === 'annotations');
    expect(annotationsDiff!.desktopColumns).toContain('extra_col');
    expect(annotationsDiff!.androidColumns).not.toContain('extra_col');
    const replicasDiff = diffs.find((d: { table: string }) => d.table === '_replicas');
    expect(replicasDiff!.androidColumns).toContain('timestamp');
    expect(replicasDiff!.desktopColumns).not.toContain('timestamp');
  });

  it('returns empty diffs when schemas are identical', async () => {
    const { compareSchemas } = await import(pathToFileURL(sqliteModule).href);

    const tables = [{ name: 'annotations', columns: ['id', 'book_hash', 'cfi'] }];
    const diffs = compareSchemas(tables, tables);
    expect(diffs).toEqual([]);
  });
});

describe('dev sync replica inspection', () => {
  it('queryReplicaKind returns row counts and HLC metadata from the replica API', async () => {
    const { captureAndroidState } = (await import(pathToFileURL(stateModule).href)) as {
      captureAndroidState: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const replicaResponses: Record<string, unknown> = {
      annotation: {
        rows: [
          { id: 'a1', hlc: '001' },
          { id: 'a2', hlc: '002' },
        ],
      },
      quote: { rows: [{ id: 'q1', hlc: '003' }] },
      'dictionary-entry': { rows: [] },
      'dictionary-occurrence': { rows: [{ id: 'do1', hlc: '010', deleted_at_ts: '2025-06-01' }] },
    };

    const fetchCalls: string[] = [];
    const mockFetch = async (url: string) => {
      fetchCalls.push(url);
      // Extract kind from /replicas/:kind
      const kind = url.split('/replicas/')[1]?.split('?')[0];
      const data = replicaResponses[kind ?? ''] ?? null;
      if (!data) return { ok: false, status: 404, error: 'not found' };
      return { ok: true, status: 200, data };
    };

    const snapshot = await captureAndroidState({
      packageName: 'io.github.Napster0x.biblioteca',
      serverUrl: 'http://127.0.0.1:7878',
      runAdb: (args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('library.json')) return { ok: true, stdout: '[]' };
        if (cmd.includes('test -e')) return { ok: true, stdout: '' };
        if (cmd.includes('find') && cmd.includes('/Books')) return { ok: true, stdout: '' };
        return { ok: false, stdout: '', message: `unexpected: ${cmd}` };
      },
      fetchJson: mockFetch,
    });

    const replicas = snapshot['replicas'] as Record<string, unknown> | undefined;
    expect(replicas).toBeDefined();

    const annotationReplica = replicas!['annotation'] as Record<string, unknown>;
    expect(annotationReplica).toBeDefined();
    expect(annotationReplica['reachable']).toBe(true);
    expect(annotationReplica['rowCount']).toBe(2);

    const dictEntry = replicas!['dictionary-entry'] as Record<string, unknown>;
    expect(dictEntry['reachable']).toBe(true);
    expect(dictEntry['rowCount']).toBe(0);

    // Verify all 4 kinds were queried (plus manifest = 5 total fetch calls)
    const replicaCalls = fetchCalls.filter((u) => u.includes('/replicas/'));
    expect(replicaCalls).toHaveLength(4);
    expect(fetchCalls.some((u) => u.includes('/replicas/annotation'))).toBe(true);
    expect(fetchCalls.some((u) => u.includes('/replicas/dictionary-occurrence'))).toBe(true);
  });

  it('counts replica API array responses as Android-visible rows', async () => {
    const { captureAndroidState } = (await import(pathToFileURL(stateModule).href)) as {
      captureAndroidState: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const replicaResponses: Record<string, unknown> = {
      annotation: { rows: [] },
      quote: { rows: [] },
      'dictionary-entry': [{ id: 'entry-1', hlc: '011' }],
      'dictionary-occurrence': [
        { id: 'occurrence-1', hlc: '012' },
        { id: 'occurrence-2', hlc: '013', deleted_at_ts: '2025-06-02' },
      ],
    };

    const snapshot = await captureAndroidState({
      packageName: 'io.github.Napster0x.biblioteca',
      serverUrl: 'http://127.0.0.1:7878',
      runAdb: (args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('library.json')) return { ok: true, stdout: '[]' };
        if (cmd.includes('test -e')) return { ok: true, stdout: '' };
        if (cmd.includes('find') && cmd.includes('/Books')) return { ok: true, stdout: '' };
        return { ok: false, stdout: '', message: `unexpected: ${cmd}` };
      },
      fetchJson: async (url: string) => {
        const kind = url.split('/replicas/')[1]?.split('?')[0];
        const data = replicaResponses[kind ?? ''];
        if (!data) return { ok: false, status: 404, error: 'not found' };
        return { ok: true, status: 200, data };
      },
    });

    const replicas = snapshot['replicas'] as Record<string, Record<string, unknown>> | undefined;
    expect(replicas).toBeDefined();
    expect(replicas!['dictionary-entry']!['rowCount']).toBe(1);
    expect(replicas!['dictionary-entry']!['hlcMin']).toBe('011');
    expect(replicas!['dictionary-occurrence']!['rowCount']).toBe(2);
    expect(replicas!['dictionary-occurrence']!['hlcMax']).toBe('013');
    expect(replicas!['dictionary-occurrence']!['tombstoneCount']).toBe(1);
  });

  it('replica inspection degrades to warn when API is unreachable', async () => {
    const { captureAndroidState } = (await import(pathToFileURL(stateModule).href)) as {
      captureAndroidState: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const snapshot = await captureAndroidState({
      packageName: 'io.github.Napster0x.biblioteca',
      serverUrl: 'http://127.0.0.1:9',
      runAdb: (args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.includes('library.json')) return { ok: true, stdout: '[]' };
        if (cmd.includes('test -e')) return { ok: true, stdout: '' };
        if (cmd.includes('find') && cmd.includes('/Books')) return { ok: true, stdout: '' };
        return { ok: false, stdout: '', message: `unexpected: ${cmd}` };
      },
      fetchJson: async () => ({ ok: false, status: 0, error: 'fetch failed' }),
    });

    const replicas = snapshot['replicas'] as Record<string, unknown> | undefined;
    expect(replicas).toBeDefined();
    const annotationReplica = replicas!['annotation'] as Record<string, unknown>;
    expect(annotationReplica['reachable']).toBe(false);
    expect(annotationReplica['error']).toBeTruthy();
    // Status should not be fail — replica unreachable is warn
    expect(snapshot['status']).not.toBe('fail');
  });
});

describe('dev sync extended state capture', () => {
  it('state capture includes sqlite key with DB table metadata', async () => {
    const devRoot = makeTempRoot('ext-state');
    const readestDir = join(devRoot, 'Readest');
    const booksDir = join(readestDir, 'Books');
    mkdirRecursive(booksDir);
    writeFileSync(join(booksDir, 'library.json'), '[]', 'utf8');
    writeFileSync(join(readestDir, 'settings.json'), '{}', 'utf8');

    // Create a real annotations DB so sqlite capture produces non-empty tables
    const dbPath = join(readestDir, 'annotations.db');
    execFileSync(
      'sqlite3',
      [
        dbPath,
        'CREATE TABLE annotations (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT, replica_timestamps TEXT, deleted_at TEXT)',
      ],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [
        dbPath,
        "INSERT INTO annotations VALUES ('a1', 'h1', '/6/4', 'hello', '{\"desktop\":\"001\"}', NULL)",
      ],
      {
        encoding: 'utf8',
      },
    );
    writeFileSync(join(readestDir, 'citas.db'), 'db', 'utf8');
    writeFileSync(join(readestDir, 'dictionary.db'), 'db', 'utf8');

    const { captureDesktopState } = (await import(pathToFileURL(stateModule).href)) as {
      captureDesktopState: (opts: { dataRoot: string }) => Promise<Record<string, unknown>>;
    };

    const snapshot = await captureDesktopState({ dataRoot: devRoot });

    const sqlite = snapshot['sqlite'] as Record<string, unknown> | undefined;
    expect(sqlite).toBeDefined();
    const annotationsCapture = sqlite!['annotations'] as Record<string, unknown>;
    expect(annotationsCapture).toBeDefined();
    expect(annotationsCapture['available']).toBe(true);
    const tables = annotationsCapture['tables'] as Array<Record<string, unknown>>;
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(tables.some((t) => t['name'] === 'annotations')).toBe(true);

    // Existing fields must remain
    expect(snapshot['db']).toBeDefined();
    expect(snapshot['library']).toBeDefined();
    expect(snapshot['settings']).toBeDefined();
    expect(snapshot['books']).toBeDefined();
  });

  it('state capture reports sqlite available: false when CLI is missing', async () => {
    const devRoot = makeTempRoot('ext-state-missing-cli');
    const readestDir = join(devRoot, 'Readest');
    mkdirRecursive(join(readestDir, 'Books'));
    writeFileSync(join(readestDir, 'Books', 'library.json'), '[]', 'utf8');
    writeFileSync(join(readestDir, 'settings.json'), '{}', 'utf8');
    // Create stub DB files that sqlite3 can't open properly
    writeFileSync(join(readestDir, 'annotations.db'), 'not a valid sqlite db', 'utf8');
    writeFileSync(join(readestDir, 'citas.db'), 'not valid', 'utf8');
    writeFileSync(join(readestDir, 'dictionary.db'), 'not valid', 'utf8');

    const { captureDesktopState } = (await import(pathToFileURL(stateModule).href)) as {
      captureDesktopState: (opts: { dataRoot: string }) => Promise<Record<string, unknown>>;
    };

    const snapshot = await captureDesktopState({ dataRoot: devRoot });
    const sqlite = snapshot['sqlite'] as Record<string, unknown> | undefined;
    expect(sqlite).toBeDefined();
    const annotationsCapture = sqlite!['annotations'] as Record<string, unknown>;
    // Should report error when DB is not valid SQLite
    expect(annotationsCapture['available']).toBe(false);
    expect(annotationsCapture['error']).toBeTruthy();
  });

  it('state capture includes all evidence fields for desktop', async () => {
    const devRoot = makeTempRoot('full-evidence-desktop');
    const readestDir = join(devRoot, 'Readest');
    const booksDir = join(readestDir, 'Books');
    mkdirRecursive(booksDir);
    writeFileSync(join(booksDir, 'library.json'), JSON.stringify([{ id: 'book-1' }]));
    writeFileSync(join(readestDir, 'settings.json'), '{"theme":"dark"}');
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'annotations.db'),
        'CREATE TABLE annotations (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT, replica_timestamps TEXT, deleted_at TEXT)',
      ],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'citas.db'),
        'CREATE TABLE quotes (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT, replica_timestamps TEXT, deleted_at TEXT)',
      ],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'dictionary.db'),
        'CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT, replica_timestamps TEXT, deleted_at TEXT)',
      ],
      { encoding: 'utf8' },
    );

    const { captureDesktopState } = (await import(pathToFileURL(stateModule).href)) as {
      captureDesktopState: (opts: { dataRoot: string }) => Promise<Record<string, unknown>>;
    };
    const snapshot = await captureDesktopState({ dataRoot: devRoot });
    const snap = snapshot as Record<string, unknown>;

    expect(snap.target).toBe('desktop');
    expect(snap.status).toBe('pass');
    expect(snap.root).toBe(join(devRoot, 'Readest'));
    expect(snap.db).toBeDefined();
    const db = snap.db as { files: Array<{ name: string; exists: boolean }>; presentCount: number };
    expect(db.files).toHaveLength(3);
    expect(db.presentCount).toBe(3);
    expect(snap.library).toBeDefined();
    expect((snap.library as Record<string, unknown>).exists).toBe(true);
    expect(snap.settings).toBeDefined();
    expect((snap.settings as Record<string, unknown>).exists).toBe(true);
    expect(snap.books).toBeDefined();
    expect(snap.sqlite).toBeDefined();
    const sqliteKeys = Object.keys(snap.sqlite as Record<string, unknown>);
    expect(sqliteKeys).toEqual(['dictionary', 'annotations', 'quotes']);
    expect(snap.errors).toEqual([]);
  });

  it('state capture handles duplicate SQLite rows without crashing', async () => {
    const devRoot = makeTempRoot('duplicate-state-capture');
    const readestDir = join(devRoot, 'Readest');
    mkdirRecursive(join(readestDir, 'Books'));
    writeFileSync(join(readestDir, 'Books', 'library.json'), '[]');
    writeFileSync(join(readestDir, 'settings.json'), '{}');
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'annotations.db'),
        'CREATE TABLE annotations (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, text TEXT, replica_timestamps TEXT, deleted_at TEXT)',
      ],
      { encoding: 'utf8' },
    );
    // Insert duplicate-like rows (same book_hash and cfi, different IDs)
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'annotations.db'),
        "INSERT INTO annotations VALUES ('a1', 'h1', '/6/4', 'hello', '{\"desktop\":\"001\"}', NULL)",
      ],
      { encoding: 'utf8' },
    );
    execFileSync(
      'sqlite3',
      [
        join(readestDir, 'annotations.db'),
        "INSERT INTO annotations VALUES ('a1dup', 'h1', '/6/4', 'hello', '{\"desktop\":\"002\"}', NULL)",
      ],
      { encoding: 'utf8' },
    );

    const { captureDesktopState } = (await import(pathToFileURL(stateModule).href)) as {
      captureDesktopState: (opts: { dataRoot: string }) => Promise<Record<string, unknown>>;
    };
    const snapshot = await captureDesktopState({ dataRoot: devRoot });

    const sqlite = snapshot['sqlite'] as Record<string, unknown> | undefined;
    expect(sqlite).toBeDefined();
    const annotations = sqlite!['annotations'] as {
      available: boolean;
      tables: Array<{ name: string; rowCount: number }>;
    };
    expect(annotations.available).toBe(true);
    const annTable = annotations.tables.find((t: { name: string }) => t.name === 'annotations');
    expect(annTable).toBeDefined();
    // Both rows must be counted — capture is honest, not deduplicating
    expect(annTable!.rowCount).toBe(2);
  });
});

// ── dev sync prepare engine ────────────────────────────
describe('dev sync prepare engine', () => {
  it('computePartialMd5Node produces a 32-char hex string', async () => {
    const { computePartialMd5Node } = await import(
      pathToFileURL(join(appRootPath, 'scripts/prepare-engine.mjs')).href
    );
    const tmpFile = join(makeTempRoot('md5'), 'test.bin');
    writeFileSync(tmpFile, Buffer.alloc(8192, 'A'), 'utf8');
    const hash = computePartialMd5Node(tmpFile);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('computePartialMd5Node returns same hash for identical files', async () => {
    const { computePartialMd5Node } = await import(
      pathToFileURL(join(appRootPath, 'scripts/prepare-engine.mjs')).href
    );
    const tmpFile = join(makeTempRoot('md5'), 'test.bin');
    writeFileSync(tmpFile, Buffer.alloc(16384, 'B'), 'utf8');
    const h1 = computePartialMd5Node(tmpFile);
    const h2 = computePartialMd5Node(tmpFile);
    expect(h1).toBe(h2);
  });

  it('computePartialMd5Node returns different hash for different files', async () => {
    const { computePartialMd5Node } = await import(
      pathToFileURL(join(appRootPath, 'scripts/prepare-engine.mjs')).href
    );
    const dir = makeTempRoot('md5');
    const f1 = join(dir, 'a.bin');
    const f2 = join(dir, 'b.bin');
    writeFileSync(f1, 'A'.repeat(5000), 'utf8');
    writeFileSync(f2, 'B'.repeat(5000), 'utf8');
    const h1 = computePartialMd5Node(f1);
    const h2 = computePartialMd5Node(f2);
    expect(h1).not.toBe(h2);
  });

  // Note: extractEpubMetadata is NOT tested directly in jsdom because
  // adm-zip's getData() returns empty Buffers in the jsdom environment.
  // EPUB metadata extraction is covered by the CLI integration tests below
  // (dev sync prepare CLI), which spawn child processes in a real Node.js env.

  it('importEpubToLibrary copies file and creates library entry', async () => {
    const { importEpubToLibrary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/prepare-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('import');
    const srcDir = makeTempRoot('src');
    const srcFile = join(srcDir, 'book.epub');
    writeFileSync(srcFile, 'epub-content', 'utf8');

    const result = importEpubToLibrary({
      filePath: srcFile,
      dataRoot,
      title: 'My Book',
      author: 'Author',
    });
    expect(result.ok).toBe(true);
    expect(result.book.hash).toMatch(/^[0-9a-f]{32}$/);
    expect(result.book.title).toBe('My Book');
    expect(result.book.author).toBe('Author');
    expect(result.book.byteSize).toBe(12);

    // Verify file was copied
    const bookDir = join(dataRoot, 'Readest', 'Books', result.book.hash);
    expect(existsSync(bookDir)).toBe(true);
    expect(existsSync(join(bookDir, 'book.epub'))).toBe(true);

    // Verify library.json entry
    const libraryPath = join(dataRoot, 'Readest', 'Books', 'library.json');
    expect(existsSync(libraryPath)).toBe(true);
    const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
    expect(library).toHaveLength(1);
    expect(library[0].hash).toBe(result.book.hash);
    expect(library[0].title).toBe('My Book');
  });

  it('importEpubToLibrary skips duplicate on re-import', async () => {
    const { importEpubToLibrary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/prepare-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('import');
    const srcFile = join(makeTempRoot('src'), 'book.epub');
    writeFileSync(srcFile, 'content', 'utf8');

    const r1 = importEpubToLibrary({ filePath: srcFile, dataRoot, title: 'Book', author: 'A' });
    expect(r1.ok).toBe(true);

    const r2 = importEpubToLibrary({ filePath: srcFile, dataRoot, title: 'Book', author: 'A' });
    expect(r2.ok).toBe(true);
    expect(r2.action).toBe('skipped');

    // library.json still has 1 entry
    const libraryPath = join(dataRoot, 'Readest', 'Books', 'library.json');
    const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
    expect(library).toHaveLength(1);
  });

  it('importEpubToLibrary appends to existing library.json', async () => {
    const { importEpubToLibrary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/prepare-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('import');
    const libraryPath = join(dataRoot, 'Readest', 'Books', 'library.json');
    mkdirRecursive(join(dataRoot, 'Readest', 'Books'));
    writeFileSync(libraryPath, JSON.stringify([{ hash: 'abc', title: 'Existing' }]), 'utf8');

    const srcFile = join(makeTempRoot('src'), 'book2.epub');
    writeFileSync(srcFile, 'new content here!', 'utf8');

    const result = importEpubToLibrary({ filePath: srcFile, dataRoot, title: 'New', author: 'B' });
    expect(result.ok).toBe(true);

    const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
    expect(library).toHaveLength(2);
    expect(library[1].title).toBe('New');
  });
});

// ── dev sync clean engine ──────────────────────────────
describe('dev sync clean engine', () => {
  it('verifyCleanState reports clean when no state exists', async () => {
    const { verifyCleanState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/clean-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('clean');
    const result = verifyCleanState(dataRoot);
    expect(result.clean).toBe(true);
    expect(result.residuals).toEqual([]);
  });

  it('verifyCleanState reports dirty when library.json exists', async () => {
    const { verifyCleanState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/clean-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('clean');
    mkdirRecursive(join(dataRoot, 'Readest', 'Books'));
    writeFileSync(join(dataRoot, 'Readest', 'Books', 'library.json'), '[]', 'utf8');

    const result = verifyCleanState(dataRoot);
    expect(result.clean).toBe(false);
    expect(result.residuals).toContain(join(dataRoot, 'Readest', 'Books', 'library.json'));
  });

  it('verifyCleanState reports dirty when DB files exist', async () => {
    const { verifyCleanState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/clean-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('clean');
    mkdirRecursive(join(dataRoot, 'Readest'));
    writeFileSync(join(dataRoot, 'Readest', 'annotations.db'), 'data', 'utf8');

    const result = verifyCleanState(dataRoot);
    expect(result.clean).toBe(false);
    expect(result.residuals.some((r: string) => r.endsWith('annotations.db'))).toBe(true);
  });

  it('verifyCleanState reports dirty when book dirs exist', async () => {
    const { verifyCleanState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/clean-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('clean');
    mkdirRecursive(join(dataRoot, 'Readest', 'Books', 'some-book'));

    const result = verifyCleanState(dataRoot);
    expect(result.clean).toBe(false);
    expect(result.residuals.some((r: string) => r.includes('some-book'))).toBe(true);
  });

  it('verifyCleanState reports dirty when .bak files exist', async () => {
    const { verifyCleanState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/clean-engine.mjs')).href
    );
    const dataRoot = makeTempRoot('clean');
    mkdirRecursive(join(dataRoot, 'Readest'));
    writeFileSync(join(dataRoot, 'Readest', 'settings.json.bak'), '{}', 'utf8');

    const result = verifyCleanState(dataRoot);
    expect(result.clean).toBe(false);
    expect(result.residuals.some((r: string) => r.endsWith('.bak'))).toBe(true);
  });
});

// ── dev sync assert engine ─────────────────────────────
describe('dev sync assert engine', () => {
  it('compareSnapshots reports PASS when snapshots are identical', async () => {
    const { compareSnapshots } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const snap = {
      db: { presentCount: 3 },
      library: { summary: { count: 5 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const result = compareSnapshots(snap, snap);
    expect(result.verdict).toBe('PASS');
    expect(result.failures).toEqual([]);
  });

  it('compareSnapshots reports FAIL when library count differs', async () => {
    const { compareSnapshots } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const pre = {
      db: { presentCount: 3 },
      library: { summary: { count: 5 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const post = {
      db: { presentCount: 3 },
      library: { summary: { count: 6 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const result = compareSnapshots(pre, post);
    expect(result.verdict).toBe('FAIL');
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('compareSnapshots reports FAIL when DB count differs', async () => {
    const { compareSnapshots } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const pre = {
      db: { presentCount: 3 },
      library: { summary: { count: 5 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const post = {
      db: { presentCount: 2 },
      library: { summary: { count: 5 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const result = compareSnapshots(pre, post);
    expect(result.verdict).toBe('FAIL');
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('compareSnapshots reports FAIL when dirCount differs', async () => {
    const { compareSnapshots } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const pre = {
      db: { presentCount: 3 },
      library: { summary: { count: 5 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const post = {
      db: { presentCount: 3 },
      library: { summary: { count: 5 } },
      books: { dirCount: 3 },
      settings: { exists: true },
    };
    const result = compareSnapshots(pre, post);
    expect(result.verdict).toBe('FAIL');
  });

  it('compareSnapshots with expectDelta allows specified differences', async () => {
    const { compareSnapshots } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const pre = {
      db: { presentCount: 3 },
      library: { summary: { count: 5 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const post = {
      db: { presentCount: 3 },
      library: { summary: { count: 6 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    const result = compareSnapshots(pre, post, { library: 1 });
    expect(result.verdict).toBe('PASS');
  });

  it('semantic assertions fail when equal counts hide a missing dictionary occurrence', async () => {
    const { compareSemanticState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const desktop = {
      dictionaryOccurrences: [
        {
          id: 'occ-1',
          logicalKey: 'dict:book-a:/6/2:palabra',
          bookHash: 'book-a',
          cfi: '/6/2',
          term: 'palabra',
        },
        {
          id: 'occ-2',
          logicalKey: 'dict:book-b:/6/4:conteo',
          bookHash: 'book-b',
          cfi: '/6/4',
          term: 'conteo',
        },
      ],
    };
    const android = {
      dictionaryOccurrences: [
        {
          id: 'occ-1',
          logicalKey: 'dict:book-a:/6/2:palabra',
          bookHash: 'book-a',
          cfi: '/6/2',
          term: 'palabra',
        },
        {
          id: 'occ-x',
          logicalKey: 'dict:book-c:/6/6:extra',
          bookHash: 'book-c',
          cfi: '/6/6',
          term: 'extra',
        },
      ],
    };

    const result = compareSemanticState({ desktop, android });

    expect(result.verdict).toBe('FAIL');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        invariant: 'convergence',
        entity: 'dictionary-occurrence',
        logicalKey: 'dict:book-b:/6/4:conteo',
        probableDomain: 'serialization/transport/merge',
      }),
    );
  });

  it('semantic assertions detect duplicate logical quote rows and non-idempotent repeats', async () => {
    const { compareSemanticState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const quote = {
      logicalKey: 'quote:book-a:/4/2:Important',
      bookHash: 'book-a',
      cfi: '/4/2',
      text: 'Important',
    };

    const result = compareSemanticState({
      desktop: {
        quotes: [{ id: 'q1', ...quote }],
        syncRuns: [
          { id: 'run-1', logicalCounts: { quotes: 1 } },
          { id: 'run-2', logicalCounts: { quotes: 1 } },
        ],
      },
      android: {
        quotes: [
          { id: 'q1', ...quote },
          { id: 'q2', ...quote },
        ],
        syncRuns: [
          { id: 'run-1', logicalCounts: { quotes: 1 } },
          { id: 'run-2', logicalCounts: { quotes: 2 } },
        ],
      },
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        invariant: 'no-duplicate-logical-rows',
        entity: 'quote',
        logicalKey: quote.logicalKey,
      }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ invariant: 'idempotence', entity: 'quotes' }),
    );
  });

  it('semantic assertions enforce HLC newer-wins and tombstone respect', async () => {
    const { compareSemanticState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const olderVisible = {
      id: 'ann-1',
      logicalKey: 'ann:book-a:/8/2',
      text: 'old',
      hlc: '2026-06-22T10:00:00.000Z-0',
      deletedAt: null,
    };
    const newerTombstone = {
      id: 'ann-1',
      logicalKey: 'ann:book-a:/8/2',
      text: 'new',
      hlc: '2026-06-22T10:01:00.000Z-0',
      deletedAt: 1782132060000,
    };

    const result = compareSemanticState({
      desktop: { annotations: [newerTombstone] },
      android: { annotations: [olderVisible] },
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        invariant: 'hlc-newer-wins',
        entity: 'annotation',
        logicalKey: 'ann:book-a:/8/2',
      }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        invariant: 'tombstone-respect',
        entity: 'annotation',
        logicalKey: 'ann:book-a:/8/2',
      }),
    );
  });

  it('semantic assertions validate semantic highlight groups and book-delete data survival', async () => {
    const { compareSemanticState } = await import(
      pathToFileURL(join(appRootPath, 'scripts/assert-engine.mjs')).href
    );
    const deletedBook = { hash: 'book-deleted', deleted: true };

    const result = compareSemanticState({
      desktop: {
        books: [deletedBook],
        dictionaryOccurrences: [
          {
            id: 'occ-1',
            logicalKey: 'dict:book-deleted:/2/2:word',
            bookHash: 'book-deleted',
            term: 'word',
            semanticGroup: 'dictionary',
          },
        ],
        quotes: [
          {
            id: 'quote-1',
            logicalKey: 'quote:book-deleted:/4/2:line',
            bookHash: 'book-deleted',
            text: 'line',
          },
        ],
      },
      android: {
        books: [deletedBook],
        dictionaryOccurrences: [
          {
            id: 'occ-1',
            logicalKey: 'dict:book-deleted:/2/2:word',
            bookHash: 'book-deleted',
            term: 'word',
            semanticGroup: 'quote',
          },
        ],
        quotes: [],
      },
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        invariant: 'semantic-groups',
        entity: 'dictionary-occurrence',
        logicalKey: 'dict:book-deleted:/2/2:word',
      }),
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        invariant: 'book-delete-data-survival',
        entity: 'quote',
        logicalKey: 'quote:book-deleted:/4/2:line',
      }),
    );
  });

  it('dev-sync-assert CLI compares desktop and android snapshots semantically', () => {
    const root = makeTempRoot('semantic-cli');
    const desktopPath = join(root, 'desktop.json');
    const androidPath = join(root, 'android.json');
    writeFileSync(
      desktopPath,
      JSON.stringify({
        quotes: [{ id: 'q1', logicalKey: 'quote:book:/1:text', bookHash: 'book', text: 'text' }],
      }),
      'utf8',
    );
    writeFileSync(androidPath, JSON.stringify({ quotes: [] }), 'utf8');

    const result = spawnSync(
      process.execPath,
      [assertScript, '--desktop', desktopPath, '--android', androidPath],
      {
        cwd: appRootPath,
        env: { ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      verdict: string;
      failures: Array<{ logicalKey: string }>;
    };

    expect(result.status).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.verdict).toBe('FAIL');
    expect(payload.failures[0]?.logicalKey).toBe('quote:book:/1:text');
  });
});

// ── dev sync report engine (Task 5.3) ───────────────────
describe('dev sync report engine', () => {
  it('buildSyncReport emits PASS with diagnosis, evidence paths, and cleanup outcome', async () => {
    const { buildSyncReport } = await import(
      pathToFileURL(join(appRootPath, 'scripts/report-engine.mjs')).href
    );

    const report = buildSyncReport({
      assertions: { verdict: 'PASS', failures: [] },
      evidence: { snapshots: ['pre.json', 'post.json'], triggers: ['trigger.json'] },
      cleanup: { status: 'pass', deleted: ['tmp-row'] },
    });

    expect(report.verdict).toBe('PASS');
    expect(report.diagnosis).toContain('semantic convergence');
    expect(report.evidencePaths).toEqual(['pre.json', 'post.json', 'trigger.json']);
    expect(report.cleanupOutcome).toMatchObject({ status: 'pass' });
  });

  it('buildSyncReport explains FAIL divergence beyond equal counts', async () => {
    const { buildSyncReport } = await import(
      pathToFileURL(join(appRootPath, 'scripts/report-engine.mjs')).href
    );

    const report = buildSyncReport({
      assertions: {
        verdict: 'FAIL',
        counts: { desktop: 2, android: 2 },
        failures: [
          {
            invariant: 'convergence',
            entity: 'dictionary-occurrence',
            logicalKey: 'dict:book:/2:word',
            probableDomain: 'serialization/transport/merge',
          },
        ],
      },
      evidence: { snapshots: ['desktop.json', 'android.json'] },
    });

    expect(report.verdict).toBe('FAIL');
    expect(report.probableDomain).toBe('serialization/transport/merge');
    expect(report.diagnosis).toContain('dict:book:/2:word');
    expect(report.diagnosis).toContain('equal counts');
  });

  it('buildSyncReport preserves WARN and AMBIGUOUS unavailable evidence semantics', async () => {
    const { buildSyncReport } = await import(
      pathToFileURL(join(appRootPath, 'scripts/report-engine.mjs')).href
    );

    const warn = buildSyncReport({
      assertions: { verdict: 'WARN', failures: [] },
      unavailableEvidence: ['android.sqlite'],
    });
    const ambiguous = buildSyncReport({
      assertions: { verdict: 'AMBIGUOUS', failures: [] },
      unavailableEvidence: ['replicas.dictionary'],
    });

    expect(warn.verdict).toBe('WARN');
    expect(warn.unavailableEvidence).toContain('android.sqlite');
    expect(warn.diagnosis).toContain('unavailable evidence');
    expect(ambiguous.verdict).toBe('AMBIGUOUS');
    expect(ambiguous.unavailableEvidence).toContain('replicas.dictionary');
  });

  it('dev-sync-report CLI reads an assertion file and exits non-zero on FAIL', () => {
    const root = makeTempRoot('report-cli');
    const assertionPath = join(root, 'assertions.json');
    writeFileSync(
      assertionPath,
      JSON.stringify({
        verdict: 'FAIL',
        failures: [
          {
            invariant: 'convergence',
            entity: 'quote',
            logicalKey: 'quote:book:/1:text',
            probableDomain: 'merge',
          },
        ],
      }),
      'utf8',
    );

    const result = spawnSync(process.execPath, [reportScript, '--assertions', assertionPath], {
      cwd: appRootPath,
      env: { ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
      encoding: 'utf8',
    });
    const payload = JSON.parse(result.stdout) as {
      verdict: string;
      diagnosis: string;
      probableDomain?: string;
    };

    expect(result.status).toBe(1);
    expect(payload.verdict).toBe('FAIL');
    expect(payload.probableDomain).toBe('merge');
    expect(payload.diagnosis).toContain('quote:book:/1:text');
  });
});

// ── dev sync prepare CLI ───────────────────────────────
describe('dev sync prepare CLI', () => {
  it('emits JSON with ok:true and book details on successful import', () => {
    const dataRoot = makeTempRoot('prepare-cli');
    const srcDir = makeTempRoot('src');
    const srcFile = join(srcDir, 'cli-book.epub');
    createEpubZip(
      srcFile,
      '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>',
      '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>CLI Book</dc:title>\n    <dc:creator>CLI Author</dc:creator>\n  </metadata>\n</package>',
    );

    const prepareScript = join(appRootPath, 'scripts/dev-sync-prepare.mjs');
    const output = runNode(prepareScript, ['--file', srcFile], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dataRoot,
    });
    const payload = JSON.parse(output);
    expect(payload.ok).toBe(true);
    expect(payload.book.hash).toMatch(/^[0-9a-f]{32}$/);
    expect(payload.book.title).toBe('CLI Book');
    expect(payload.book.author).toBe('CLI Author');

    // Verify the library.json was created
    const libraryPath = join(dataRoot, 'Readest', 'Books', 'library.json');
    expect(existsSync(libraryPath)).toBe(true);
    const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
    expect(library).toHaveLength(1);
  });

  it('rejects when BIBLIOTECA_DEV_SYNC_HARNESS is not set', () => {
    const prepareScript = join(appRootPath, 'scripts/dev-sync-prepare.mjs');
    expect(() => runNode(prepareScript, ['--file', '/nonexistent.epub'], {})).toThrow(
      /harness|BIBLIOTECA_DEV_SYNC_HARNESS/,
    );
  });

  it('reports error when file does not exist', () => {
    const dataRoot = makeTempRoot('prepare-cli');
    const prepareScript = join(appRootPath, 'scripts/dev-sync-prepare.mjs');
    expect(() =>
      runNode(prepareScript, ['--file', '/nonexistent/file.epub'], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dataRoot,
      }),
    ).toThrow(/Command failed|not found/);
  });
});

// ── dev sync fixture engine (Task 4.2) ─────────────────
describe('dev sync fixture engine', () => {
  function createEmptyDictDb(dbDir: string): string {
    const dbPath = join(dbDir, 'Readest', 'dictionary.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE IF NOT EXISTS dictionary_entries (
        id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT,
        definition TEXT, enrichment_status TEXT, replica_timestamps TEXT,
        created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS dictionary_occurrences (
        id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, book_title TEXT,
        cfi TEXT, selected_text TEXT, created_at INTEGER,
        deleted_at INTEGER, replica_timestamps TEXT
      );
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return dbPath;
  }

  function createEmptyQuotesDb(dbDir: string): string {
    const dbPath = join(dbDir, 'Readest', 'citas.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY, text TEXT,
        book_hash TEXT, book_title TEXT, cfi TEXT,
        created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,
        replica_timestamps TEXT
      );
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return dbPath;
  }

  function createEmptyAnnotationsDb(dbDir: string): string {
    const dbPath = join(dbDir, 'Readest', 'annotations.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY, text TEXT, book_hash TEXT, book_title TEXT,
        cfi TEXT,
        created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,
        replica_timestamps TEXT
      );
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return dbPath;
  }

  it('injectDictionary creates entry and occurrence with correct book hash', async () => {
    const { injectDictionary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('fixture-dict');
    const dbPath = createEmptyDictDb(dbDir);
    const bookHash = 'deadbeef0123456789abcdef0123456789abcd';

    const result = injectDictionary({
      target: 'desktop',
      bookHash,
      bookTitle: 'Test Diccionario',
      term: 'zozobrar',
      definition: 'Peligrar, estar a punto de perderse',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    expect(result.entryId).toMatch(/^dict-entry-/);
    expect(result.occIds).toHaveLength(1);
    expect(result.term).toBe('zozobrar');

    // Verify entry was written
    const entryRows = JSON.parse(
      execFileSync(
        'sqlite3',
        [dbPath, '-json', "SELECT * FROM dictionary_entries WHERE id = '" + result.entryId + "'"],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(entryRows).toHaveLength(1);
    expect(entryRows[0].term).toBe('zozobrar');
    expect(entryRows[0].display_term).toBe('zozobrar');
    expect(entryRows[0].deleted_at).toBeNull();

    // Verify occurrence was written with correct book hash
    const occRows = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT * FROM dictionary_occurrences WHERE entry_id = '" + result.entryId + "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(occRows).toHaveLength(1);
    expect(occRows[0].book_hash).toBe(bookHash);
    expect(occRows[0].book_title).toBe('Test Diccionario');
    expect(occRows[0].selected_text).toBe('zozobrar');
    expect(occRows[0].deleted_at).toBeNull();
  });

  it('injectDictionary creates multiple occurrences for multiple definitions', async () => {
    const { injectDictionary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('fixture-dict-multi');
    const dbPath = createEmptyDictDb(dbDir);

    const result = injectDictionary({
      target: 'desktop',
      bookHash: 'abc123',
      term: 'neologismo',
      definitions: [
        { definition: 'Primera acepción', cfi: '/6/4[sec1]', selectedText: 'neologismo1' },
        { definition: 'Segunda acepción', cfi: '/6/4[sec2]', selectedText: 'neologismo2' },
      ],
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    expect(result.occIds).toHaveLength(2);

    const occRows = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT * FROM dictionary_occurrences WHERE entry_id = '" + result.entryId + "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(occRows).toHaveLength(2);
    expect(occRows.map((r: { selected_text: string }) => r.selected_text).sort()).toEqual([
      'neologismo1',
      'neologismo2',
    ]);
  });

  it('injectQuote creates quote with book metadata', async () => {
    const { injectQuote } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('fixture-quote');
    const dbPath = createEmptyQuotesDb(dbDir);
    const bookHash = 'feedface0123456789abcdef0123456789abcd';

    const result = injectQuote({
      target: 'desktop',
      bookHash,
      bookTitle: 'Don Quijote',
      text: 'En un lugar de la Mancha',
      comment: 'Célebre inicio',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    expect(result.quoteId).toMatch(/^quote-/);
    expect(result.text).toBe('En un lugar de la Mancha');

    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [dbPath, '-json', "SELECT * FROM quotes WHERE id = '" + result.quoteId + "'"],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('En un lugar de la Mancha');
    expect(rows[0].book_hash).toBe(bookHash);
    expect(rows[0].book_title).toBe('Don Quijote');
    expect(rows[0].deleted_at).toBeNull();
  });

  it('injectAnnotation creates annotation with book+range references', async () => {
    const { injectAnnotation } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('fixture-ann');
    const dbPath = createEmptyAnnotationsDb(dbDir);
    const bookHash = 'cafebabe0123456789abcdef0123456789abcd';

    const result = injectAnnotation({
      target: 'desktop',
      bookHash,
      bookTitle: 'Cien Años',
      text: 'Análisis importante',
      cfi: '/6/8[chapter3]!/4/2',
      selectedText: 'texto seleccionado',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    expect(result.annId).toMatch(/^annotation-/);

    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [dbPath, '-json', "SELECT * FROM annotations WHERE id = '" + result.annId + "'"],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Análisis importante');
    expect(rows[0].book_hash).toBe(bookHash);
    expect(rows[0].cfi).toBe('/6/8[chapter3]!/4/2');
    expect(rows[0].deleted_at).toBeNull();
  });

  it('injectDictionary auto-creates tables on empty DB (no pre-existing schema)', async () => {
    const { injectDictionary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('fixture-autocreate');
    const dbPath = join(dbDir, 'Readest', 'dictionary.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    // Deliberately do NOT create any tables — empty DB simulates Tauri's first-sync state

    const result = injectDictionary({
      target: 'desktop',
      bookHash: 'deadbeefauto123456789abcdef0123456789abcd',
      bookTitle: 'Auto Create Test',
      term: 'autocrear',
      definition: 'Crear automáticamente',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    expect(result.entryId).toMatch(/^dict-entry-/);

    // Entry table should have been auto-created
    const entryRows = JSON.parse(
      execFileSync(
        'sqlite3',
        [dbPath, '-json', "SELECT * FROM dictionary_entries WHERE id = '" + result.entryId + "'"],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(entryRows).toHaveLength(1);
    expect(entryRows[0].term).toBe('autocrear');

    // Occurrence table should also have been auto-created
    const occRows = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT * FROM dictionary_occurrences WHERE entry_id = '" + result.entryId + "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(occRows).toHaveLength(1);
    expect(occRows[0].book_hash).toBe('deadbeefauto123456789abcdef0123456789abcd');
  });

  it('injectDictionary propagates injectRows errors', async () => {
    const { injectDictionary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const fakeExec = () => {
      throw new Error('sqlite3: simulated failure');
    };

    const result = injectDictionary({
      target: 'desktop',
      bookHash: 'errhash',
      term: 'fallar',
      injectOpts: {
        dbPath: '/nonexistent/test.db',
        execFileSync: fakeExec as unknown as typeof execFileSync,
        devHarnessEnabled: true,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('dev sync fixture CLI', () => {
  const fixtureScript = join(appRootPath, 'scripts/dev-sync-fixture.mjs');

  it('--dict flag produces correct JSON output', () => {
    const dbDir = makeTempRoot('fixture-cli-dict');
    const dbPath = join(dbDir, 'Readest', 'dictionary.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, definition TEXT, enrichment_status TEXT, replica_timestamps TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
      CREATE TABLE dictionary_occurrences (id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, book_title TEXT, cfi TEXT, selected_text TEXT, created_at INTEGER, deleted_at INTEGER, replica_timestamps TEXT);
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );

    const output = runNode(fixtureScript, ['--dict', 'vericueto', '--book', 'bookhash001'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dbDir,
    });

    const payload = JSON.parse(output);
    expect(payload.ok).toBe(true);
    expect(payload.term).toBe('vericueto');
    expect(payload.entryId).toMatch(/^dict-entry-/);
    expect(payload.occIds).toHaveLength(1);

    // Verify persisted
    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT book_hash, selected_text FROM dictionary_occurrences WHERE entry_id = '" +
            payload.entryId +
            "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(rows[0].book_hash).toBe('bookhash001');
  });

  it('--quote flag produces correct JSON output', () => {
    const dbDir = makeTempRoot('fixture-cli-quote');
    const dbPath = join(dbDir, 'Readest', 'citas.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE quotes (id TEXT PRIMARY KEY, text TEXT, book_hash TEXT, book_title TEXT, cfi TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, replica_timestamps TEXT);
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );

    const output = runNode(
      fixtureScript,
      ['--quote', 'El que lee mucho', '--book', 'book002', '--comment', 'Cervantes'],
      {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dbDir,
      },
    );

    const payload = JSON.parse(output);
    expect(payload.ok).toBe(true);
    expect(payload.text).toBe('El que lee mucho');
    expect(payload.quoteId).toMatch(/^quote-/);

    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [dbPath, '-json', "SELECT text FROM quotes WHERE id = '" + payload.quoteId + "'"],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(rows[0].text).toBe('El que lee mucho');
  });

  it('--note flag produces correct JSON output', () => {
    const dbDir = makeTempRoot('fixture-cli-note');
    const dbPath = join(dbDir, 'Readest', 'annotations.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE annotations (id TEXT PRIMARY KEY, text TEXT, book_hash TEXT, book_title TEXT, cfi TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, replica_timestamps TEXT);
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );

    const output = runNode(fixtureScript, ['--note', 'Nota importante', '--book', 'book003'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dbDir,
    });

    const payload = JSON.parse(output);
    expect(payload.ok).toBe(true);
    expect(payload.text).toBe('Nota importante');
    expect(payload.annId).toMatch(/^annotation-/);

    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [dbPath, '-json', "SELECT text FROM annotations WHERE id = '" + payload.annId + "'"],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(rows[0].text).toBe('Nota importante');
  });

  it('rejects without BIBLIOTECA_DEV_SYNC_HARNESS', () => {
    expect(() => runNode(fixtureScript, ['--dict', 'test', '--book', 'h'], {})).toThrow(
      /harness|BIBLIOTECA_DEV_SYNC_HARNESS/,
    );
  });

  it('rejects without --book flag', () => {
    const dbDir = makeTempRoot('fixture-cli-nobook');
    expect(() =>
      runNode(fixtureScript, ['--dict', 'test'], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dbDir,
      }),
    ).toThrow(); // exits 1 with usage message
  });

  it('rejects with only --book but no action flag', () => {
    const dbDir = makeTempRoot('fixture-cli-noaction');
    // Using spawnSync to capture stderr
    const result = spawnSync(process.execPath, [fixtureScript, '--book', 'h'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dbDir,
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown|fixture type/i);
  });
});

// ── dev sync fixture edit/delete/tombstone (Task 4.3) ──
describe('dev sync edits/deletes/tombstones', () => {
  function createMultiTableDb(dbDir: string): string {
    const dbPath = join(dbDir, 'Readest', 'dictionary.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE dictionary_entries (
        id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT,
        definition TEXT, enrichment_status TEXT, replica_timestamps TEXT,
        created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
      );
      CREATE TABLE dictionary_occurrences (
        id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, book_title TEXT,
        cfi TEXT, selected_text TEXT, created_at INTEGER,
        deleted_at INTEGER, replica_timestamps TEXT
      );
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return dbPath;
  }

  it('updateRow modifies entry and bumps HLC timestamps', async () => {
    const { updateRow } = await import(
      pathToFileURL(join(appRootPath, 'scripts/sync-dev-sqlite.mjs')).href
    );
    const { injectDictionary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('edit-hlc');
    const dbPath = createMultiTableDb(dbDir);

    // Create a dictionary entry
    const created = injectDictionary({
      target: 'desktop',
      bookHash: 'b1',
      term: 'original',
      definition: 'Old definition',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    // Read original replica_timestamps
    const before = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT replica_timestamps, updated_at FROM dictionary_entries WHERE id = '" +
            created.entryId +
            "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    const origTimestamps = before[0].replica_timestamps;
    const origUpdatedAt = before[0].updated_at;

    // Small delay to ensure HLC advancement
    await new Promise((r) => setTimeout(r, 5));

    // Update the definition
    const updateResult = updateRow({
      dbPath,
      execFileSync,
      table: 'dictionary_entries',
      rowId: created.entryId,
      updates: { definition: 'Updated definition' },
    });
    expect(updateResult.ok).toBe(true);

    // Verify updated_at advanced
    const after = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT definition, replica_timestamps, updated_at FROM dictionary_entries WHERE id = '" +
            created.entryId +
            "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(after[0].definition).toBe('Updated definition');
    expect(after[0].updated_at).toBeGreaterThan(origUpdatedAt);
    // replica_timestamps should have changed
    expect(after[0].replica_timestamps).not.toBe(origTimestamps);
    // Should contain the updated marker
    expect(after[0].replica_timestamps).toContain('updated');
  });

  it('softDeleteRow marks entry as deleted and preserves data', async () => {
    const { softDeleteRow } = await import(
      pathToFileURL(join(appRootPath, 'scripts/sync-dev-sqlite.mjs')).href
    );
    const { injectQuote } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('delete-tomb');
    const dbPath = join(dbDir, 'Readest', 'citas.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE quotes (id TEXT PRIMARY KEY, text TEXT, book_hash TEXT, book_title TEXT, cfi TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, replica_timestamps TEXT);
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );

    const created = injectQuote({
      target: 'desktop',
      bookHash: 'b2',
      text: 'Delete me',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    // Soft delete
    const deleteResult = softDeleteRow({
      dbPath,
      execFileSync,
      table: 'quotes',
      rowId: created.quoteId,
    });
    expect(deleteResult.ok).toBe(true);
    expect(deleteResult.deleted).toBe(true);

    // Row still exists but has deleted_at set
    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT text, deleted_at FROM quotes WHERE id = '" + created.quoteId + "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Delete me'); // data preserved
    expect(rows[0].deleted_at).toBeGreaterThan(0); // tombstone marker
  });

  it('isStaleUpdate detects stale update against a deleted row', async () => {
    const { softDeleteRow, isStaleUpdate } = await import(
      pathToFileURL(join(appRootPath, 'scripts/sync-dev-sqlite.mjs')).href
    );
    const { injectAnnotation } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('stale');
    const dbPath = join(dbDir, 'Readest', 'annotations.db');
    mkdirRecursive(join(dbDir, 'Readest'));
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE annotations (id TEXT PRIMARY KEY, text TEXT, book_hash TEXT, book_title TEXT, cfi TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, replica_timestamps TEXT);
    `,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );

    const created = injectAnnotation({
      target: 'desktop',
      bookHash: 'b3',
      text: 'Staleness test',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    // Delete the row
    const del = softDeleteRow({ dbPath, execFileSync, table: 'annotations', rowId: created.annId });
    expect(del.ok).toBe(true);

    // Read actual deleted_at value
    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [dbPath, '-json', "SELECT deleted_at FROM annotations WHERE id = '" + created.annId + "'"],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    const deletedAt = rows[0].deleted_at;

    // An update with older timestamp should be stale
    const staleCheck = isStaleUpdate({
      dbPath,
      execFileSync,
      table: 'annotations',
      rowId: created.annId,
      updateTimestamp: deletedAt - 100, // before deletion
    });
    expect(staleCheck.stale).toBe(true);

    // An update with newer timestamp should NOT be stale
    const freshCheck = isStaleUpdate({
      dbPath,
      execFileSync,
      table: 'annotations',
      rowId: created.annId,
      updateTimestamp: deletedAt + 10000, // after deletion
    });
    expect(freshCheck.stale).toBe(false);
  });

  it('findDuplicates detects duplicate rows by book_hash', async () => {
    const { findDuplicates } = await import(
      pathToFileURL(join(appRootPath, 'scripts/sync-dev-sqlite.mjs')).href
    );
    const { injectDictionary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('dupes');
    const dbPath = createMultiTableDb(dbDir);

    // Create two occurrences for the same book but different entries
    const e1 = injectDictionary({
      target: 'desktop',
      bookHash: 'dupbook',
      term: 'word1',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });
    const e2 = injectDictionary({
      target: 'desktop',
      bookHash: 'dupbook',
      term: 'word2',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    // Manually insert a third occurrence with same book_hash as e1's first occurrence
    const now = Date.now();
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `INSERT INTO dictionary_occurrences (id, entry_id, book_hash, book_title, cfi, selected_text, created_at, deleted_at) VALUES ('dup-occ', '${e2.entryId}', 'dupbook', 'Test', '/6/4', 'word2', ${now}, NULL)`,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );

    // Check duplicates in dictionary_occurrences by book_hash
    const dupResult = findDuplicates({
      dbPath,
      execFileSync,
      table: 'dictionary_occurrences',
      groupColumns: ['book_hash'],
    });
    expect(dupResult.ok).toBe(true);
    // We have 3 occurrences for 'dupbook' — duplicates with count > 1 should include it
    const dupBook = dupResult.duplicates.find(
      (d: { book_hash: string }) => d.book_hash === 'dupbook',
    );
    expect(dupBook).toBeDefined();
    expect(Number(dupBook.c)).toBeGreaterThan(1);
  });

  it('soft deleted rows retain data accessible via direct query (tombstone semantics)', async () => {
    const { softDeleteRow } = await import(
      pathToFileURL(join(appRootPath, 'scripts/sync-dev-sqlite.mjs')).href
    );
    const { injectDictionary } = await import(
      pathToFileURL(join(appRootPath, 'scripts/dev-sync-fixture.mjs')).href
    );
    const dbDir = makeTempRoot('tombstone-data');
    const dbPath = createMultiTableDb(dbDir);

    const created = injectDictionary({
      target: 'desktop',
      bookHash: 'b4',
      term: 'tombstone-word',
      definition: 'Will be deleted but data remains',
      injectOpts: { dbPath, execFileSync, devHarnessEnabled: true },
    });

    // Delete
    const del = softDeleteRow({
      dbPath,
      execFileSync,
      table: 'dictionary_entries',
      rowId: created.entryId,
    });
    expect(del.ok).toBe(true);

    // Row data is still accessible
    const rows = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT term, definition, deleted_at FROM dictionary_entries WHERE id = '" +
            created.entryId +
            "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].term).toBe('tombstone-word');
    expect(rows[0].definition).toBe('Will be deleted but data remains');
    expect(rows[0].deleted_at).toBeGreaterThan(0);

    // Occurrence should still exist too (not cascade-deleted)
    const occs = JSON.parse(
      execFileSync(
        'sqlite3',
        [
          dbPath,
          '-json',
          "SELECT id FROM dictionary_occurrences WHERE entry_id = '" + created.entryId + "'",
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    expect(occs).toHaveLength(1);
  });

  it('detached/sourceUnavailable: missing table handled gracefully', async () => {
    const { updateRow, softDeleteRow, findDuplicates, isStaleUpdate } = await import(
      pathToFileURL(join(appRootPath, 'scripts/sync-dev-sqlite.mjs')).href
    );
    const dbDir = makeTempRoot('detached');
    const nonexistentDb = join(dbDir, 'nonexistent.db');
    // Do NOT create the DB — simulate sourceUnavailable

    // updateRow on non-existent DB
    const updateResult = updateRow({
      dbPath: nonexistentDb,
      execFileSync,
      table: 'ghost',
      rowId: 'x',
      updates: { a: 1 },
    });
    expect(updateResult.ok).toBe(false);
    expect(updateResult.error).toBeDefined();

    // softDeleteRow on non-existent DB
    const deleteResult = softDeleteRow({
      dbPath: nonexistentDb,
      execFileSync,
      table: 'ghost',
      rowId: 'x',
    });
    expect(deleteResult.ok).toBe(false);
    expect(deleteResult.error).toBeDefined();

    // findDuplicates on non-existent DB
    const dupResult = findDuplicates({ dbPath: nonexistentDb, execFileSync, table: 'ghost' });
    expect(dupResult.ok).toBe(false);
    expect(dupResult.error).toBeDefined();

    // isStaleUpdate on non-existent DB
    const staleResult = isStaleUpdate({
      dbPath: nonexistentDb,
      execFileSync,
      table: 'ghost',
      rowId: 'x',
      updateTimestamp: 100,
    });
    // isStaleUpdate handles errors gracefully
    expect(staleResult.stale).toBe(false);
  });
});

// ── dev sync clean CLI ─────────────────────────────────
describe('dev sync clean CLI', () => {
  it('delegates to reset and verifies clean state', () => {
    const dataRoot = makeTempRoot('clean-cli');
    mkdirRecursive(join(dataRoot, 'Readest', 'Books'));
    writeFileSync(join(dataRoot, '.biblioteca-dev-sync'), '1', 'utf8');

    const cleanScript = join(appRootPath, 'scripts/dev-sync-clean.mjs');
    const output = runNode(
      cleanScript,
      ['--target', 'desktop-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
      {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DB_DIR: dataRoot,
      },
    );
    const payload = JSON.parse(output);
    expect(payload.ok).toBe(true);
    expect(payload.reset).toBeDefined();
    expect(payload.verification).toBeDefined();
    expect(payload.verification.clean).toBe(true);
  });

  it('rejects without dev harness', () => {
    const cleanScript = join(appRootPath, 'scripts/dev-sync-clean.mjs');
    expect(() => runNode(cleanScript, ['--target', 'desktop-db'], {})).toThrow(
      /harness|BIBLIOTECA_DEV_SYNC_HARNESS/,
    );
  });

  it('defaults to dry-run and does not delete files when --no-dry-run is absent', () => {
    const dataRoot = makeTempRoot('clean-dryrun');
    mkdirRecursive(join(dataRoot, 'Readest', 'Books'));
    writeFileSync(join(dataRoot, '.biblioteca-dev-sync'), '1', 'utf8');
    writeFileSync(join(dataRoot, 'Readest', 'annotations.db'), 'data', 'utf8');

    const cleanScript = join(appRootPath, 'scripts/dev-sync-clean.mjs');
    const result = spawnSync(
      process.execPath,
      [cleanScript, '--target', 'desktop-db', '--confirm', 'DELETE_DEV_SYNC_STATE'],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DB_DIR: dataRoot,
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      reset: { dryRun: boolean; deleted: string[]; preserved: string[] };
      verification: { clean: boolean; residuals: string[] };
    };

    // Exit 1 because state is not clean after dry-run
    expect(result.status).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.reset.dryRun).toBe(true);
    // Files must still exist in dry-run mode
    expect(existsSync(join(dataRoot, 'Readest', 'annotations.db'))).toBe(true);
    // Verification must be present and report dirty
    expect(payload.verification).toBeDefined();
    expect(payload.verification.clean).toBe(false);
  });

  it('rejects ambiguous non-dev-sync paths via reset delegation', () => {
    const cleanScript = join(appRootPath, 'scripts/dev-sync-clean.mjs');
    const result = spawnSync(process.execPath, [cleanScript, '--target', 'desktop-db'], {
      cwd: appRootPath,
      env: {
        ...process.env,
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DB_DIR: process.env.HOME ?? '/home',
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    const payload = JSON.parse(result.stdout) as {
      reset: { error?: string };
      verification: { clean: boolean; residuals: string[] };
    };
    expect(payload.reset.error).toMatch(/unsafe|refusing/i);
  });

  it('dry-run declares deletions and preservations then shows verification status', () => {
    const dataRoot = makeTempRoot('clean-declare');
    mkdirRecursive(join(dataRoot, 'Readest', 'Books'));
    writeFileSync(join(dataRoot, '.biblioteca-dev-sync'), '1', 'utf8');
    writeFileSync(join(dataRoot, 'Readest', 'annotations.db'), 'data', 'utf8');
    writeFileSync(join(dataRoot, 'Readest', 'citas.db'), 'data', 'utf8');
    writeFileSync(join(dataRoot, 'Readest', 'dictionary.db'), 'data', 'utf8');

    const cleanScript = join(appRootPath, 'scripts/dev-sync-clean.mjs');
    const result = spawnSync(
      process.execPath,
      [cleanScript, '--target', 'desktop-db', '--confirm', 'DELETE_DEV_SYNC_STATE'],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DB_DIR: dataRoot,
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as {
      reset: { dryRun: boolean; deleted: string[]; preserved: string[] };
      verification: { clean: boolean; residuals: string[] };
    };

    expect(payload.reset.dryRun).toBe(true);
    // No actual deletions in dry-run
    expect(payload.reset.deleted).toEqual([]);
    // All existing files should be preserved in dry-run
    expect(payload.reset.preserved.length).toBeGreaterThanOrEqual(3);
    // Verification should report dirty since files exist
    expect(payload.verification.clean).toBe(false);
    expect(payload.verification.residuals.length).toBeGreaterThan(0);
  });
});

// ── dev sync assert CLI ────────────────────────────────
describe('dev sync assert CLI', () => {
  it('emits PASS when pre and post snapshots match', () => {
    const dataRoot = makeTempRoot('assert-cli');
    const prePath = join(dataRoot, 'pre.json');
    const postPath = join(dataRoot, 'post.json');
    const snap = {
      db: { presentCount: 3 },
      library: { summary: { count: 5 } },
      books: { dirCount: 2 },
      settings: { exists: true },
    };
    writeFileSync(prePath, JSON.stringify(snap));
    writeFileSync(postPath, JSON.stringify(snap));

    const assertScript = join(appRootPath, 'scripts/dev-sync-assert.mjs');
    const output = runNode(assertScript, ['--pre', prePath, '--post', postPath], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
    });
    const payload = JSON.parse(output);
    expect(payload.ok).toBe(true);
    expect(payload.verdict).toBe('PASS');
  });

  it('emits FAIL and diff when pre and post differ', () => {
    const dataRoot = makeTempRoot('assert-cli');
    const prePath = join(dataRoot, 'pre.json');
    const postPath = join(dataRoot, 'post.json');
    writeFileSync(
      prePath,
      JSON.stringify({
        db: { presentCount: 3 },
        library: { summary: { count: 5 } },
        books: { dirCount: 2 },
        settings: { exists: true },
      }),
    );
    writeFileSync(
      postPath,
      JSON.stringify({
        db: { presentCount: 3 },
        library: { summary: { count: 6 } },
        books: { dirCount: 2 },
        settings: { exists: true },
      }),
    );

    const assertScript = join(appRootPath, 'scripts/dev-sync-assert.mjs');
    expect(() =>
      runNode(assertScript, ['--pre', prePath, '--post', postPath], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      }),
    ).toThrow(); // exits 1
  });

  it('reports error when pre/post files are missing', () => {
    const assertScript = join(appRootPath, 'scripts/dev-sync-assert.mjs');
    expect(() =>
      runNode(assertScript, ['--pre', '/nonexistent.json', '--post', '/missing.json'], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      }),
    ).toThrow();
  });
});

// ── dev sync cycle pipeline mode ───────────────────────
describe('dev sync cycle pipeline mode', () => {
  it('--pipeline with prepare step imports book and captures snapshot', () => {
    const reportDir = makeTempRoot('pipeline-reports');
    const desktopRoot = makeTempRoot('pipeline-desktop');
    const srcDir = makeTempRoot('pipeline-src');
    const srcFile = join(srcDir, 'pipeline-book.epub');
    createEpubZip(
      srcFile,
      '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>',
      '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>Pipeline Book</dc:title>\n    <dc:creator>Pipe Author</dc:creator>\n  </metadata>\n</package>',
    );

    const pipeline = [
      { label: 'import-book', prepare: { import: { file: srcFile } } },
      { label: 'post-import-snapshot' },
    ];

    const result = spawnSync(
      process.execPath,
      [cycleScript, '--json', '--pipeline', JSON.stringify(pipeline)],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
          BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
          BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as {
      runId: string;
      pipeline: Array<{ label: string; ok: boolean; prepare?: Record<string, unknown> }>;
      verdict: string;
    };

    expect(payload.pipeline).toBeDefined();
    expect(payload.pipeline).toHaveLength(2);
    const firstPipelineStep = payload.pipeline[0];
    if (!firstPipelineStep) throw new Error('expected first pipeline step');
    expect(firstPipelineStep.label).toBe('import-book');
    expect(firstPipelineStep.ok).toBe(true);
    expect(firstPipelineStep.prepare).toBeDefined();
    expect(payload.runId).toMatch(/^dev-sync-cycle-/);
  });

  it('--pipeline backward compat: --steps still works unchanged', () => {
    const reportDir = makeTempRoot('pipeline-steps');
    const desktopRoot = makeTempRoot('pipeline-desktop');

    const result = spawnSync(
      process.execPath,
      [cycleScript, '--json', '--steps', JSON.stringify([{ label: 's1' }])],
      {
        cwd: appRootPath,
        env: {
          ...process.env,
          BIBLIOTECA_DEV_SYNC_HARNESS: '1',
          BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
          BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger',
          BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
          BIBLIOTECA_DEV_CYCLE_REPORT_DIR: reportDir,
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(result.stdout) as { steps?: unknown[]; pipeline?: unknown[] };
    // Legacy --steps still produces steps array, not pipeline
    expect(payload.steps).toBeDefined();
    expect(payload.pipeline).toBeUndefined();
  });
});

// ── package.json scripts ───────────────────────────────
describe('dev sync new package scripts', () => {
  it('declares dev:sync:prepare, dev:sync:clean, dev:sync:assert in package.json scripts', () => {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:sync:prepare']).toBe('node scripts/dev-sync-prepare.mjs');
    expect(pkg.scripts['dev:sync:clean']).toBe('node scripts/dev-sync-clean.mjs');
    expect(pkg.scripts['dev:sync:assert']).toBe('node scripts/dev-sync-assert.mjs');
  });
});

// ── dev sync docs + safe smoke (Task 6.1/6.2) ───────────
describe('dev sync operator docs and safe smoke', () => {
  it('documents command contract, manual boundary, cleanup, evidence, and no-build warnings', () => {
    const harness = readFileSync(syncHarnessDoc, 'utf8');
    const smoke = readFileSync(syncSmokeDoc, 'utf8');
    const combined = `${harness}\n${smoke}`;

    expect(combined).toContain('dev:sync:doctor --json');
    expect(combined).toContain('dev:sync:state --json');
    expect(combined).toContain('dev:sync:clean --target all --dry-run');
    expect(combined).toMatch(/Manual vs CLI|Manual-vs-CLI|Responsabilidad manual/i);
    expect(combined).toMatch(/cleanup checklist|checklist de limpieza/i);
    expect(combined).toMatch(/evidence paths|rutas de evidencia/i);
    expect(combined).toMatch(/no builds?|no ejecutar builds?|NO BUILD/i);
    expect(combined).toMatch(/no installs?|no redeploy|no restarts?|no destructive clean/i);
  });

  it('safe smoke JSON plan includes only non-mutating diagnostics by default', () => {
    const output = runNode(smokeScript, ['--json'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
    });
    const payload = JSON.parse(output) as {
      ok: boolean;
      status: string;
      command: string;
      mode: string;
      tasks: Array<{
        name: string;
        command: string[];
        mutates: boolean;
        allowedWithoutAuthorization: boolean;
      }>;
      blockedOperations: string[];
      evidencePaths: string[];
      warnings: string[];
    };

    expect(payload).toMatchObject({
      ok: true,
      status: 'pass',
      command: 'dev:sync:smoke',
      mode: 'plan',
    });
    expect(payload.tasks.map((task) => task.command.join(' '))).toEqual([
      'pnpm dev:sync:doctor --json',
      'pnpm dev:sync:state --json',
      'pnpm dev:sync:clean --target all --dry-run',
    ]);
    expect(
      payload.tasks.every(
        (task) => task.mutates === false && task.allowedWithoutAuthorization === true,
      ),
    ).toBe(true);
    expect(payload.blockedOperations).toEqual(
      expect.arrayContaining([
        'build',
        'install',
        'redeploy',
        'restart',
        'destructive-clean',
        'real-sync-trigger',
      ]),
    );
    expect(payload.evidencePaths).toEqual(
      expect.arrayContaining([
        '/tmp/biblioteca-dev-sync/smoke/doctor.json',
        '/tmp/biblioteca-dev-sync/smoke/state.json',
      ]),
    );
    expect(payload.warnings.join(' ')).toMatch(/WARN|AMBIGUOUS/);
  });

  it('safe smoke can persist its evidence plan without running mutating commands', () => {
    const evidenceDir = makeTempRoot('smoke-evidence');
    const output = runNode(smokeScript, ['--json', '--write-evidence'], {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_SYNC_SMOKE_DIR: evidenceDir,
    });
    const payload = JSON.parse(output) as {
      planPath: string;
      tasks: Array<{ evidencePath: string }>;
    };

    expect(payload.planPath).toBe(join(evidenceDir, 'plan.json'));
    expect(existsSync(payload.planPath)).toBe(true);
    const saved = JSON.parse(readFileSync(payload.planPath, 'utf8')) as {
      tasks: Array<{ command: string[]; mutates: boolean }>;
    };
    expect(saved.tasks.map((task) => task.command.join(' '))).toEqual([
      'pnpm dev:sync:doctor --json',
      'pnpm dev:sync:state --json',
      'pnpm dev:sync:clean --target all --dry-run',
    ]);
    expect(saved.tasks.every((task) => task.mutates === false)).toBe(true);
    expect(payload.tasks.map((task) => task.evidencePath)).toEqual([
      join(evidenceDir, 'doctor.json'),
      join(evidenceDir, 'state.json'),
      join(evidenceDir, 'clean-dry-run.json'),
    ]);
  });

  it('declares dev:sync:smoke in package.json scripts', () => {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:sync:smoke']).toBe('node scripts/dev-sync-smoke.mjs');
  });
});

/**
 * Create a minimal EPUB zip file using Python's zipfile (avoids jsdom/adm-zip Buffer issues).
 */
function createEpubZip(epubPath: string, containerXml: string, opfXml: string): void {
  const script = `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.writestr('META-INF/container.xml', sys.argv[2])
    zf.writestr('OEBPS/content.opf', sys.argv[3])
`;
  execFileSync('python3', ['-c', script, epubPath, containerXml, opfXml], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

/** Naive mkdir -p for test scaffolding (Node 10+). */
function mkdirRecursive(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// ── Caso 8 v2: cycle push idempotence via dataRoot ─────────────

describe('dev sync cycle push idempotence via dataRoot', () => {
  it('cycle propagates dataRoot in POST body and trigger forward yields attempted=0 on second sync', {
    timeout: 90_000,
  }, async () => {
    const desktopRoot = makeTempRoot('cycle-idempotence');
    createFullSyncFixture(desktopRoot);

    // Fake trigger: spawns sync-execute.mjs asynchronously so the cycle's
    // 3-second fetch timeout is not violated. Writes spawn params to a temp
    // file and responds immediately. The test then spawns sync-execute itself
    // after the cycle completes and verifies idempotence via DB state.
    const capturedBodies: Array<Record<string, unknown>> = [];
    const spawnQueue: Array<{ dataRoot?: string; androidUrl: string }> = [];
    const syncResults: Array<unknown> = [];
    let triggerCount = 0;

    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/sync-trigger') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          } catch {
            /* empty body — legacy cycle */
          }
          capturedBodies.push(body);
          const dataRoot = body['BIBLIOTECA_DEV_DESKTOP_DATA_ROOT'] as string | undefined;
          triggerCount++;

          const spawnPort = (server.address() as { port: number }).port;
          // Record spawn intent for post-cycle verification
          spawnQueue.push({ dataRoot, androidUrl: `http://127.0.0.1:${spawnPort}` });

          // Respond immediately with a placeholder — NOT the actual sync result
          // because spawning sync-execute takes >3s (cycle's fetch timeout).
          // The test verifies idempotence by re-spawning sync-execute after the
          // cycle completes.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              count: triggerCount,
              namespace: 'biblioteca-dev-sync',
              ok: true,
              runId: `dev-sync-${triggerCount}-${Date.now()}`,
              syncResult: { ok: true, replicas: {}, evidence: { path: 'syncResult.replicas' } },
              evidence: { path: 'syncResult' },
            }),
          );
        });
        return;
      }

      // Android mock routes (used by spawned sync-execute in post-cycle verification)
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const putChunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => putChunks.push(chunk));
        req.on('end', () => {
          const putBody = JSON.parse(Buffer.concat(putChunks).toString('utf8')) as unknown;
          const count = Array.isArray(putBody) ? putBody.length : 0;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: count }));
        });
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const steps = JSON.stringify([
        { label: 'step-1', sync: true },
        { label: 'step-2', sync: true },
      ]);

      // Cycle uses unreachable Android server for fast state captures.
      // sync-execute (spawned by fake trigger or post-cycle) gets the reachable port.
      const result = await spawnNode(cycleScript, ['--steps', steps], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: `http://127.0.0.1:${address.port}/api/sync-trigger`,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: 'http://127.0.0.1:9',
      });

      const cycleOutput = JSON.parse(result.stdout) as {
        steps: Array<{
          label: string;
          ok: boolean;
          sync?: { response?: Record<string, unknown> };
        }>;
      };

      // Verify the cycle DID NOT crash and produced steps
      expect(cycleOutput.steps).toHaveLength(2);

      // RED assertion: without the fix, capturedBodies[0] has NO dataRoot
      // After GREEN, it WILL have BIBLIOTECA_DEV_DESKTOP_DATA_ROOT
      const step1Body = capturedBodies[0] ?? {};
      expect(step1Body['BIBLIOTECA_DEV_DESKTOP_DATA_ROOT']).toBe(desktopRoot);

      // Post-cycle: spawn sync-execute twice with the correct dataRoot + Android server
      // to verify push idempotence. This covers the actual Caso 8 behavior.
      const postEnv: EnvOverrides = {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      };

      // First sync: pushes all replicas, writes _replicas
      const firstSync = await spawnNode(syncExecuteScript, [], postEnv);
      const firstPayload = parseLastJsonObject(firstSync.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(firstSync.status).toBe(0);
      expect(firstPayload.ok).toBe(true);
      expect(firstPayload.replicas['dictionary-entry'].attempted).toBeGreaterThan(0);
      expect(firstPayload.replicas['dictionary-occurrence'].attempted).toBeGreaterThan(0);
      expect(firstPayload.replicas.quote.attempted).toBeGreaterThan(0);
      expect(firstPayload.replicas.annotation.attempted).toBeGreaterThan(0);

      // Second sync: filter detects unchanged replicas → attempted=0 for all
      const secondSync = await spawnNode(syncExecuteScript, [], postEnv);
      const secondPayload = parseLastJsonObject(secondSync.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(secondSync.status).toBe(0);
      expect(secondPayload.replicas['dictionary-entry']).toMatchObject({
        attempted: 0,
        applied: 0,
      });
      expect(secondPayload.replicas['dictionary-occurrence']).toMatchObject({
        attempted: 0,
        applied: 0,
      });
      expect(secondPayload.replicas.quote).toMatchObject({ attempted: 0, applied: 0 });
      expect(secondPayload.replicas.annotation).toMatchObject({ attempted: 0, applied: 0 });
    } finally {
      server.close();
    }
  });
});

// ── Caso 8 v2: pull filter evidence ────────────────────────────

describe('sync-execute pull filter evidence', () => {
  it('produces pulled=0 on second pull when all Android replicas already exist in Desktop _replicas', async () => {
    const desktopRoot = makeTempRoot('pull-filter');
    createEmptyDesktopSyncRoot(desktopRoot);
    const androidRows = createCaso7AndroidRows();

    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied: 0 }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        const kind = req.url.split('/replicas/')[1] ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(androidRows[kind] ?? []));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    const env: EnvOverrides = {
      BIBLIOTECA_DEV_SYNC_HARNESS: '1',
      BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
      BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
    };

    try {
      // First pull: all Android replicas are new — should be applied
      const first = await spawnNode(syncExecuteScript, [], env);
      const firstPayload = parseLastJsonObject(first.stdout) as SyncExecutePayload;

      expect(first.status).toBe(0);
      expect(firstPayload.replicas['dictionary-entry'].pulled).toBeGreaterThan(0);
      expect(firstPayload.replicas['dictionary-entry'].appliedToDesktop).toBeGreaterThan(0);
      expect(firstPayload.replicas['dictionary-occurrence'].pulled).toBeGreaterThan(0);
      expect(firstPayload.replicas['dictionary-occurrence'].appliedToDesktop).toBeGreaterThan(0);
      expect(firstPayload.replicas.quote.pulled).toBeGreaterThan(0);
      expect(firstPayload.replicas.quote.appliedToDesktop).toBeGreaterThan(0);
      expect(firstPayload.replicas.annotation.pulled).toBeGreaterThan(0);
      expect(firstPayload.replicas.annotation.appliedToDesktop).toBeGreaterThan(0);

      // Second pull: all replicas already in _replicas → pull filter should produce pulled=0
      const second = await spawnNode(syncExecuteScript, [], env);
      const secondPayload = parseLastJsonObject(second.stdout) as SyncExecutePayload;

      expect(second.status).toBe(0);
      expect(secondPayload.replicas['dictionary-entry']).toMatchObject({
        pulled: 0,
        appliedToDesktop: 0,
      });
      expect(secondPayload.replicas['dictionary-occurrence']).toMatchObject({
        pulled: 0,
        appliedToDesktop: 0,
      });
      expect(secondPayload.replicas.quote).toMatchObject({ pulled: 0, appliedToDesktop: 0 });
      expect(secondPayload.replicas.annotation).toMatchObject({ pulled: 0, appliedToDesktop: 0 });
    } finally {
      server.close();
    }
  });
});

// ── Caso 8: dict-entry semantic filter ──────────────────────

describe('sync-execute semantic filter pure functions', () => {
  it('normalizeTerm: NFC composition, lowercase, strips U+00AD, guards null/undefined', async () => {
    const { normalizeTerm } = await import(pathToFileURL(syncFilterStandalone).href);
    // NFC composition: decomposed A + combining acute → composed á
    expect(normalizeTerm('\u0041\u0301')).toBe('á');
    // Lowercase
    expect(normalizeTerm('Hello')).toBe('hello');
    expect(normalizeTerm('SERENDIPÍA')).toBe('serendipía');
    // Strip soft-hyphen (U+00AD)
    expect(normalizeTerm('foo\u00adbar')).toBe('foobar');
    expect(normalizeTerm('\u00adlead\u00ading\u00ad')).toBe('leading');
    // null/undefined → empty string
    expect(normalizeTerm(null)).toBe('');
    expect(normalizeTerm(undefined)).toBe('');
    // Empty string
    expect(normalizeTerm('')).toBe('');
    // Already normalised — preserves
    expect(normalizeTerm('café')).toBe('café');
    expect(normalizeTerm('hello world')).toBe('hello world');
  });

  it('computeSemanticKey: valid JSONB, null fields_jsonb, empty term, missing language', async () => {
    const { computeSemanticKey } = await import(pathToFileURL(syncFilterStandalone).href);
    const makeRow = (term: unknown, lang: unknown) => ({
      fields_jsonb: { term: { v: term }, language: { v: lang } },
    });
    // Valid term + language → normalized key
    expect(computeSemanticKey(makeRow('Hello', 'EN'), 'dictionary-entry')).toBe('hello|en');
    expect(computeSemanticKey(makeRow('SERENDIPÍA', 'ES'), 'dictionary-entry')).toBe(
      'serendipía|es',
    );
    // Soft-hyphen in term
    expect(computeSemanticKey(makeRow('foo\u00adbar', 'en'), 'dictionary-entry')).toBe('foobar|en');
    // null fields_jsonb → null
    expect(computeSemanticKey({ fields_jsonb: null }, 'dictionary-entry')).toBeNull();
    expect(computeSemanticKey({}, 'dictionary-entry')).toBeNull();
    expect(computeSemanticKey({ fields_jsonb: {} }, 'dictionary-entry')).toBeNull();
    // Empty/whitespace term → null
    expect(computeSemanticKey(makeRow('', 'es'), 'dictionary-entry')).toBeNull();
    expect(computeSemanticKey(makeRow('   ', 'es'), 'dictionary-entry')).toBeNull();
    // Missing language → pipe with empty string
    expect(computeSemanticKey(makeRow('foo', null), 'dictionary-entry')).toBe('foo|');
    expect(computeSemanticKey(makeRow('foo', undefined), 'dictionary-entry')).toBe('foo|');
    // Term is not a string → null (v is number)
    expect(computeSemanticKey(makeRow(42, 'es'), 'dictionary-entry')).toBeNull();
  });

  it('newerOrEqualSemanticReplicaExists: match found, not found, HLC gate, null key', async () => {
    const { newerOrEqualSemanticReplicaExists } = await import(
      pathToFileURL(syncFilterStandalone).href
    );
    const dbDir = makeTempRoot('semantic-replica-exists');
    const dbPath = join(dbDir, 'test.db');
    const hlc = '0019ef3300001-00000001-android';
    const higherHlc = '0019ef4400001-00000001-android';
    execFileSync(
      'sqlite3',
      [
        dbPath,
        `
      CREATE TABLE _replicas (
        replica_id TEXT, kind TEXT, semantic_key TEXT, updated_at_ts TEXT
      );
      INSERT INTO _replicas VALUES ('r1', 'dictionary-entry', 'hello|en', '${hlc}');
      INSERT INTO _replicas VALUES ('r2', 'dictionary-entry', 'serendipía|es', '${hlc}');
    `,
      ],
      { encoding: 'utf8' },
    );
    // Match found with same HLC → true
    expect(newerOrEqualSemanticReplicaExists(dbPath, 'hello|en', hlc, 'dictionary-entry')).toBe(
      true,
    );
    expect(
      newerOrEqualSemanticReplicaExists(dbPath, 'serendipía|es', hlc, 'dictionary-entry'),
    ).toBe(true);
    // Match found with lower HLC → true (replica has higher HLC)
    expect(
      newerOrEqualSemanticReplicaExists(
        dbPath,
        'hello|en',
        '0019ef2200001-00000001-desktop',
        'dictionary-entry',
      ),
    ).toBe(true);
    // No match (different semantic key) → false
    expect(
      newerOrEqualSemanticReplicaExists(dbPath, 'nonexistent|en', hlc, 'dictionary-entry'),
    ).toBe(false);
    // Match found but higher requested HLC → false
    expect(
      newerOrEqualSemanticReplicaExists(dbPath, 'hello|en', higherHlc, 'dictionary-entry'),
    ).toBe(false);
    // null/undefined key → false
    expect(
      newerOrEqualSemanticReplicaExists(dbPath, null as unknown as string, hlc, 'dictionary-entry'),
    ).toBe(false);
    expect(
      newerOrEqualSemanticReplicaExists(
        dbPath,
        undefined as unknown as string,
        hlc,
        'dictionary-entry',
      ),
    ).toBe(false);
  });
});

describe('sync-execute semantic filter integration', () => {
  it('dict-entry with remapped replica_id is filtered by semantic match, not re-pushed', async () => {
    const desktopRoot = makeTempRoot('semantic-filter-push');
    createFullSyncFixture(desktopRoot);
    // Pre-populate _replicas with a semantically identical entry
    // that has a DIFFERENT replica_id (simulates Android's resolve_semantic_id())
    const dictionaryDb = join(desktopRoot, 'Readest', 'dictionary.db');
    // Add semantic_key column to existing _replicas + seed an Android row
    execFileSync(
      'sqlite3',
      [
        dictionaryDb,
        `
      ALTER TABLE _replicas ADD COLUMN semantic_key TEXT;
      INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, manifest_jsonb, deleted_at_ts, reincarnation, updated_at_ts, schema_version, semantic_key)
      VALUES (
        'dictionary-entry:android-entry-1', 'dictionary-entry', 'android-user',
        '{}', NULL, NULL, NULL, '0019ef6600001-00000001-android', 1,
        'serendipia|es'
      );
    `,
      ],
      { encoding: 'utf8' },
    );

    const capturedPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          capturedPuts.push({ path: req.url, body: [] });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, applied: 0 }));
        });
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(result.status).toBe(0);
      // The filter should detect the semantic match and skip pushing entry-1
      expect(payload.replicas['dictionary-entry']).toMatchObject({ attempted: 0, applied: 0 });
      // Other kinds should still push normally
      expect(payload.replicas['dictionary-occurrence'].attempted).toBeGreaterThan(0);
      expect(payload.replicas.quote.attempted).toBeGreaterThan(0);
      expect(payload.replicas.annotation.attempted).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it('non-dict-entry kinds still use exact replica_id match only (no semantic regression)', async () => {
    const desktopRoot = makeTempRoot('semantic-filter-nondict');
    createFullSyncFixture(desktopRoot);
    const dictionaryDb = join(desktopRoot, 'Readest', 'dictionary.db');
    // Add semantic_key column + seed rows with semantic keys that DON'T match
    // the fixture entries — this should NOT affect non-dict-entry filter behavior
    execFileSync(
      'sqlite3',
      [
        dictionaryDb,
        `
      ALTER TABLE _replicas ADD COLUMN semantic_key TEXT;
      INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, manifest_jsonb, deleted_at_ts, reincarnation, updated_at_ts, schema_version, semantic_key)
      VALUES
        ('dictionary-occurrence:android-occ-99', 'dictionary-occurrence', 'android-user',
         '{}', NULL, NULL, NULL, '0019ef6600001-00000001-android', 1,
         'some-term|en');
    `,
      ],
      { encoding: 'utf8' },
    );

    const capturedPuts: ReplicaPutCapture[] = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'PUT' && req.url === '/books/index') {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 1 }));
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        capturedPuts.push({ path: req.url, body: [] });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied: 0 }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as {
        ok: boolean;
        replicas: Record<string, { attempted: number; applied: number }>;
      };

      expect(result.status).toBe(0);
      // All four kinds should push (first sync, _replicas empty for desktop rows)
      expect(payload.replicas['dictionary-entry'].attempted).toBeGreaterThan(0);
      expect(payload.replicas['dictionary-occurrence'].attempted).toBeGreaterThan(0);
      expect(payload.replicas.quote.attempted).toBeGreaterThan(0);
      expect(payload.replicas.annotation.attempted).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it('stores semantic_key on pulled dict-entry replicas for future push matching', async () => {
    const desktopRoot = makeTempRoot('semantic-pull-store');
    createEmptyDesktopSyncRoot(desktopRoot);
    const androidRows = createCaso7AndroidRows();
    // The Android dict-entry has term='alborada', language='es'
    // semantic_key should be 'alborada|es'

    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/books/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ books: [] }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/replicas/')) {
        const kind = req.url.split('/replicas/')[1] ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            kind === 'dictionary-entry'
              ? { rows: androidRows[kind] ?? [] }
              : (androidRows[kind] ?? []),
          ),
        );
        return;
      }
      if (req.method === 'PUT' && req.url?.startsWith('/replicas/')) {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, applied: 0 }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to get server port');

    try {
      const result = await spawnNode(syncExecuteScript, [], {
        BIBLIOTECA_DEV_SYNC_HARNESS: '1',
        BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot,
        BIBLIOTECA_DEV_ANDROID_SERVER_URL: `http://127.0.0.1:${address.port}`,
      });
      const payload = parseLastJsonObject(result.stdout) as SyncExecutePayload;

      expect(result.status).toBe(0);
      expect(payload.replicas['dictionary-entry'].pulled).toBeGreaterThan(0);
      expect(payload.replicas['dictionary-entry'].appliedToDesktop).toBeGreaterThan(0);

      // Verify semantic_key was stored for the pulled dict-entry
      const dictionaryDb = join(desktopRoot, 'Readest', 'dictionary.db');
      const rows = readSqliteRows(
        dictionaryDb,
        "SELECT replica_id, semantic_key FROM _replicas WHERE kind = 'dictionary-entry'",
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.semantic_key).toBe('alborada|es');
      }
    } finally {
      server.close();
    }
  });
});
