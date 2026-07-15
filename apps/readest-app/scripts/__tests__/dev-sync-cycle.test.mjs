#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertBookCount,
  assertBookNoteIntegrity,
  assertBookNoteType,
  assertEntityState,
  assertFieldValue,
  assertMetadata,
  dictionaryEntryIdentityKey,
} from '../assert-engine.mjs';

import {
  buildCycleChildSpawnOptions,
  buildRepeatChildArgs,
  buildStateJsonSpawnOptions,
  classifyReliabilityFailure,
  computeCaseAcceptanceVerdict,
  computeReliabilityReport,
  ensurePhase2LiveBook,
  ensurePreCycleCleanup,
  runRepeat,
  setupCase24Ref,
  setupCase25Ref,
  setupCase26Ref,
} from '../dev-sync-cycle.mjs';

function bookConfigWithNotes(booknotes) {
  return { status: 'pass', booknoteCount: booknotes.length, booknotes };
}

function phase4BookConfigState(booknotes) {
  return { bookConfig: bookConfigWithNotes(booknotes) };
}

function case22Action(overrides = {}) {
  return {
    caseRef: '22a',
    entityType: 'dictionary-entry',
    entityId: 'd1',
    deleteHLC: 12,
    editHLC: 11,
    deleteWins: true,
    ...overrides,
  };
}

describe('dev-sync-cycle reliability repeat reporting', () => {
  it('passes only when definitive successes are greater than the configured threshold', async () => {
    const sequence = [
      { verdict: 'pass', reportPath: '/tmp/attempt-1.json' },
      { verdict: 'pass', reportPath: '/tmp/attempt-2.json' },
      { verdict: 'pass', reportPath: '/tmp/attempt-3.json' },
      { verdict: 'pass', reportPath: '/tmp/attempt-4.json' },
      { verdict: 'fail', reportPath: '/tmp/attempt-5.json', failures: ['desktop mismatch'] },
    ];
    const report = await runRepeat({
      attempts: 5,
      minSuccessRate: 0.8,
      timeoutMs: 1000,
      caseRefs: ['9Ma'],
      runAttempt: async ({ attempt }) => sequence[attempt - 1],
    });

    assert.equal(report.status, 'fail', '80% exactly is not greater than the >80% requirement');
    assert.equal(report.numerator, 4);
    assert.equal(report.denominator, 5);
    assert.equal(report.successRate, 0.8);
    assert.deepEqual(report.caseRefs, ['9Ma']);
    assert.deepEqual(report.evidencePaths, [
      '/tmp/attempt-1.json',
      '/tmp/attempt-2.json',
      '/tmp/attempt-3.json',
      '/tmp/attempt-4.json',
      '/tmp/attempt-5.json',
    ]);
    assert.equal(report.attempts[4].failureDomain, 'product');
  });

  it('keeps blocked, ambiguous, timeout, and environment failures in the denominator with domains', async () => {
    const sequence = [
      { verdict: 'pass', reportPath: '/tmp/pass.json' },
      { verdict: 'blocked', reportPath: '/tmp/blocked.json', error: 'capability missing' },
      { verdict: 'ambiguous', reportPath: '/tmp/ambiguous.json', trigger: { evidence: { unavailable: ['syncResult.evidence.path'] } } },
      { timedOut: true, error: 'attempt timed out after 10ms' },
      { ok: false, error: 'connect ECONNREFUSED 127.0.0.1:7878' },
    ];
    const report = await runRepeat({
      attempts: 5,
      minSuccessRate: 0.8,
      timeoutMs: 10,
      caseRefs: ['14a'],
      runAttempt: async ({ attempt }) => sequence[attempt - 1],
    });

    assert.equal(report.status, 'fail');
    assert.equal(report.denominator, 5);
    assert.deepEqual(report.attempts.map((attempt) => attempt.failureDomain), [
      undefined,
      'harness',
      'harness',
      'environment',
      'environment',
    ]);
    assert.deepEqual(report.failureDomains, {
      harness: 2,
      environment: 2,
    });
  });

  it('runs comma-separated case refs as isolated child attempts per case ref', async () => {
    const calls = [];
    const report = await runRepeat({
      attempts: 2,
      minSuccessRate: 0.8,
      timeoutMs: 1000,
      caseRefs: ['9Ma', '13Ma'],
      runAttempt: async ({ attempt, caseRef }) => {
        calls.push({ attempt, caseRef });
        return { verdict: 'pass', reportPath: `/tmp/${attempt}-${caseRef}.json` };
      },
    });

    assert.deepEqual(calls, [
      { attempt: 1, caseRef: '9Ma' },
      { attempt: 1, caseRef: '13Ma' },
      { attempt: 2, caseRef: '9Ma' },
      { attempt: 2, caseRef: '13Ma' },
    ]);
    assert.equal(report.status, 'pass');
    assert.equal(report.numerator, 4);
    assert.equal(report.denominator, 4);
    assert.deepEqual(report.attempts.map((attempt) => attempt.caseRef), ['9Ma', '13Ma', '9Ma', '13Ma']);
    assert.deepEqual(report.evidencePaths, [
      '/tmp/1-9Ma.json',
      '/tmp/1-13Ma.json',
      '/tmp/2-9Ma.json',
      '/tmp/2-13Ma.json',
    ]);
  });

  it('preserves single-case repeat behavior as one child attempt per repeat', async () => {
    const calls = [];
    const report = await runRepeat({
      attempts: 3,
      minSuccessRate: 0.8,
      timeoutMs: 1000,
      caseRefs: ['14a'],
      runAttempt: async ({ attempt, caseRef }) => {
        calls.push({ attempt, caseRef });
        return { verdict: 'pass', reportPath: `/tmp/${attempt}-${caseRef}.json` };
      },
    });

    assert.deepEqual(calls, [
      { attempt: 1, caseRef: '14a' },
      { attempt: 2, caseRef: '14a' },
      { attempt: 3, caseRef: '14a' },
    ]);
    assert.equal(report.denominator, 3);
    assert.deepEqual(report.attempts.map((attempt) => attempt.caseRef), ['14a', '14a', '14a']);
  });

  it('allocates enough child output buffer for verbose per-case repeat evidence without changing failure capture', () => {
    const options = buildCycleChildSpawnOptions(
      { BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: '/tmp/dev-sync-desktop' },
      120_000,
    );

    assert.equal(options.encoding, 'utf8');
    assert.equal(options.stdio, 'pipe');
    assert.equal(options.timeout, 120_000);
    assert.ok(
      options.maxBuffer >= 64 * 1024 * 1024,
      `expected repeat child maxBuffer to hold large JSON evidence, got ${options.maxBuffer}`,
    );
  });

  it('classifies product, harness, environment, and unknown failures deterministically', () => {
    assert.equal(classifyReliabilityFailure({ verdict: 'fail', failures: ['replica value mismatch'] }), 'product');
    assert.equal(classifyReliabilityFailure({ verdict: 'blocked', error: 'missing fixture capability' }), 'harness');
    assert.equal(classifyReliabilityFailure({ verdict: 'warn', caseActions: [{ error: 'harness setup failed: unable to seed live book for Phase 2 case 9Ma: HTTP 503' }] }), 'harness');
    assert.equal(classifyReliabilityFailure({ error: 'health check timeout after cleanup restart' }), 'environment');
    assert.equal(classifyReliabilityFailure({ error: 'unparseable result' }), 'unknown');

    const report = computeReliabilityReport({
      attempts: [
        { attempt: 1, verdict: 'pass', evidencePath: '/tmp/a.json' },
        { attempt: 2, verdict: 'pass', evidencePath: '/tmp/b.json' },
        { attempt: 3, verdict: 'pass', evidencePath: '/tmp/c.json' },
        { attempt: 4, verdict: 'pass', evidencePath: '/tmp/d.json' },
        { attempt: 5, verdict: 'pass', evidencePath: '/tmp/e.json' },
      ],
      minSuccessRate: 0.8,
      caseRefs: ['14Mc'],
    });

    assert.equal(report.status, 'pass');
    assert.equal(report.successRate, 1);
    assert.deepEqual(report.failureDomains, {});
  });

  it('classifies child WARN attempts from evidence instead of leaving them unknown', () => {
    assert.equal(classifyReliabilityFailure({
      verdict: 'warn',
      post: {
        android: {
          sqlite: {
            dictionary: {
              status: 'warn',
              error: 'sqlite3: inaccessible or not found',
            },
          },
        },
      },
    }), 'harness');

    assert.equal(classifyReliabilityFailure({
      verdict: 'warn',
      post: {
        android: {
          bookIndex: {
            importEvidence: {
              status: 'missing-evidence',
              reason: 'target book hash not present in Android /books/index',
            },
          },
        },
      },
    }), 'harness');
  });

  it('keeps sqlite3 absence as unavailable evidence when HTTP/product evidence proves a mismatch', () => {
    const report = computeReliabilityReport({
      attempts: [{
        verdict: 'fail',
        reportPath: '/tmp/phase4-21a.json',
        failures: ['convergence mismatch: desktop definition differs from android definition'],
        post: {
          android: {
            sqlite: {
              dictionary: {
                status: 'warn',
                error: 'sqlite3: inaccessible or not found',
              },
            },
            replicas: {
              'dictionary-entry': {
                reachable: true,
                rowCount: 1,
                rows: [{ id: 'entry-1', definition: 'android value' }],
              },
            },
          },
          desktop: {
            sqlite: {
              dictionary: {
                available: true,
                tables: [{ name: 'dictionary_entries', rows: [{ id: 'entry-1', definition: 'desktop value' }] }],
              },
            },
          },
        },
      }],
      minSuccessRate: 0.8,
      caseRefs: ['21a'],
    });

    assert.equal(report.attempts[0].failureDomain, 'product');
    assert.equal(report.attempts[0].failureReason, 'convergence mismatch: desktop definition differs from android definition');
    assert.deepEqual(report.attempts[0].unavailableEvidence, ['android.sqlite3']);
    assert.deepEqual(report.unavailableEvidence, { 'android.sqlite3': 1 });
    assert.deepEqual(report.failureDomains, { product: 1 });
  });

  it('does not promote repeat attempts with sqlite3-unavailable evidence to environment when executable evidence names product and harness failures', () => {
    const report = computeReliabilityReport({
      attempts: [
        {
          verdict: 'fail',
          reportPath: '/tmp/phase4-21b.json',
          failures: ['convergence mismatch: annotation note differs between desktop and Android device'],
          unavailableEvidence: ['android.sqlite3'],
          post: {
            android: {
              replicas: {
                annotation: {
                  reachable: true,
                  rowCount: 1,
                  rows: [{ id: 'ann-1', note: 'android stale note' }],
                },
              },
            },
            desktop: {
              sqlite: {
                annotation: {
                  available: true,
                  tables: [{ name: 'annotations', rows: [{ id: 'ann-1', note: 'desktop newer note' }] }],
                },
              },
            },
          },
        },
        {
          verdict: 'warn',
          reportPath: '/tmp/phase4-25.json',
          unavailableEvidence: ['android.sqlite3'],
          evidenceGaps: ['harness mismatch: BookNote config evidence incomplete while Android HTTP health is reachable'],
          post: {
            android: {
              health: { ok: true },
              bookConfig: {
                status: 'missing-evidence',
                reason: 'BookNote config missing expected mutation marker',
              },
            },
          },
        },
        {
          ok: false,
          error: 'ADB device offline before HTTP health check',
        },
      ],
      minSuccessRate: 0.8,
      caseRefs: ['21b', '25'],
    });

    assert.equal(report.status, 'fail');
    assert.equal(report.attempts[0].failureDomain, 'product');
    assert.equal(report.attempts[1].failureDomain, 'harness');
    assert.equal(report.attempts[2].failureDomain, 'environment');
    assert.deepEqual(report.attempts[0].unavailableEvidence, ['android.sqlite3']);
    assert.deepEqual(report.attempts[1].unavailableEvidence, ['android.sqlite3']);
    assert.deepEqual(report.failureDomains, { product: 1, harness: 1, environment: 1 });
    assert.deepEqual(report.unavailableEvidence, { 'android.sqlite3': 2 });
  });

  it('uses environment only for blocking prerequisites with no substitute evidence', () => {
    const report = computeReliabilityReport({
      attempts: [{
        ok: false,
        error: 'ADB device offline before HTTP health check',
        diagnostics: { health: { status: 'fail', reason: 'HTTP health check unavailable' } },
      }],
      minSuccessRate: 0.8,
      caseRefs: ['21a'],
    });

    assert.equal(report.attempts[0].failureDomain, 'environment');
    assert.equal(report.attempts[0].failureReason, 'ADB device offline before HTTP health check');
    assert.deepEqual(report.attempts[0].unavailableEvidence, []);
    assert.deepEqual(report.failureDomains, { environment: 1 });
  });

  it('passes 9Ma only when Android metadata converges after an explicit Android edit and sync', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: '2026-01-01T00:00:00.000Z' }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: 1780000000000 }] } },
    };
    const post = {
      status: 'warn',
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Phase2 9Ma', updatedAt: '2026-07-02T00:00:00.000Z' }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Phase2 9Ma', updatedAt: 1782950400000 }] } },
    };

    const context = {
      caseActions: [{ ok: true, caseRef: '9Ma', action: 'android-book-edit', bookHash: 'book-1', title: 'Phase2 9Ma', result: { ok: true, updatedAt: 1782950400000 } }],
      triggerOk: true,
    };
    assert.equal(computeCaseAcceptanceVerdict('9Ma', pre, post, context), 'pass');

    assert.equal(computeCaseAcceptanceVerdict('9Ma', pre, post), 'warn', 'post-state alone must not prove Android edit execution or sync');
    assert.equal(computeCaseAcceptanceVerdict('9Ma', pre, post, { ...context, triggerOk: false }), 'warn', 'sync must run successfully before 9Ma can pass');

    const unchanged = { ...post, desktop: pre.desktop, android: pre.android };
    assert.equal(computeCaseAcceptanceVerdict('9Ma', pre, unchanged, context), 'warn');
  });

  it('keeps 9Ma WARN when desktop title matches but desktop timestamp is not newer than the pre-edit fact', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: 1782950000000 }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: 1782950000000 }] } },
    };
    const post = {
      status: 'warn',
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Phase2 9Ma', updatedAt: 1782950000000 }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Phase2 9Ma', updatedAt: 1782950400000 }] } },
    };
    const context = {
      caseActions: [{ ok: true, caseRef: '9Ma', action: 'android-book-edit', bookHash: 'book-1', title: 'Phase2 9Ma', result: { ok: true, updatedAt: 1782950400000 } }],
      triggerOk: true,
    };

    assert.equal(computeCaseAcceptanceVerdict('9Ma', pre, post, context), 'warn');
  });

  it('passes semantic delete cases only with explicit semantic deletion evidence', () => {
    assert.equal(computeCaseAcceptanceVerdict('14Mc', {}, {
      status: 'warn',
      android: {
        semanticDeleteEvidence: {
          status: 'pass',
          kind: 'annotation',
          associationDeleted: true,
          semanticDeleted: true,
        },
      },
    }), 'pass');

    assert.equal(computeCaseAcceptanceVerdict('14Mc', {}, {
      status: 'warn',
      android: {
        semanticDeleteEvidence: {
          status: 'missing-evidence',
          reason: 'expected exactly one semantic row, found 0',
        },
      },
    }), 'warn');
  });

  it('seeds the sample EPUB on Android when Phase 2 cases have no live book after clean', async () => {
    const calls = [];
    const stateEnv = {};
    const result = await ensurePhase2LiveBook({
      caseRef: '9Ma',
      pre: {
        android: { bookIndex: { facts: [{ hash: 'old', deletedAt: 1783018218698 }] } },
        desktop: { library: { facts: [{ hash: 'old', deletedAt: 1783018218698 }] } },
      },
      stateEnv,
      env: { android: { serverUrl: 'http://android.local' } },
      now: 1783019000000,
      createDescriptor: ({ filePath, now }) => {
        calls.push(['descriptor', filePath, now]);
        return { hash: 'seeded-book', fileName: 'sample-alice.epub', entry: { title: 'Alice' }, bytes: Buffer.from('epub') };
      },
      importBook: async (serverUrl, descriptor, options) => {
        calls.push(['import', serverUrl, descriptor.hash, options.now]);
        return { ok: true, bookHash: descriptor.hash, action: 'imported' };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.bookHash, 'seeded-book');
    assert.equal(result.seeded, true);
    assert.equal(stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH, 'seeded-book');
    assert.match(calls[0][1], /sample-alice\.epub$/);
    assert.deepEqual(calls[1], ['import', 'http://android.local', 'seeded-book', 1783019000000]);
  });

  it('re-seeds instead of trusting a stale env book hash when evidence only has tombstones', async () => {
    const calls = [];
    const dataRoot = mkdtempSync(join(tmpdir(), 'biblioteca-phase2-live-book-'));
    try {
      const booksDir = join(dataRoot, 'Readest', 'Books');
      mkdirSync(booksDir, { recursive: true });
      writeFileSync(join(booksDir, 'library.json'), JSON.stringify([{ hash: 'seeded-live-book', title: 'Old tombstone', updatedAt: 1783037536981, deletedAt: 1783037536981 }]));
      const stateEnv = { BIBLIOTECA_DEV_STATE_BOOK_HASH: 'stale-book', BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dataRoot };
      const result = await ensurePhase2LiveBook({
        caseRef: '13Ma',
        pre: {
          android: { bookIndex: { facts: [{ hash: 'stale-book', updatedAt: 1783037536981, deletedAt: 1783037536981 }] } },
          desktop: { library: { facts: [{ hash: 'stale-book', updatedAt: 1783037536981, deletedAt: 1783037536981 }] } },
        },
        stateEnv,
        env: { android: { serverUrl: 'http://android.local' } },
        now: 1783041002169,
        createDescriptor: () => ({ hash: 'seeded-live-book', fileName: 'sample-alice.epub', entry: { title: 'Alice', author: 'Lewis Carroll' }, bytes: Buffer.from('epub') }),
        importBook: async (serverUrl, descriptor, options) => {
          calls.push(['import', serverUrl, descriptor.hash, options.now]);
          return { ok: true, bookHash: descriptor.hash, action: 'imported' };
        },
      });

      const library = JSON.parse(readFileSync(join(booksDir, 'library.json'), 'utf8'));
      assert.equal(result.ok, true);
      assert.equal(result.bookHash, 'seeded-live-book');
      assert.equal(result.seeded, true);
      assert.equal(stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH, 'seeded-live-book');
      assert.deepEqual(calls, [['import', 'http://android.local', 'seeded-live-book', 1783041002169]]);
      assert.deepEqual(library, [{ hash: 'seeded-live-book', title: 'Alice', author: 'Lewis Carroll', updatedAt: 1783041002169, deletedAt: null }]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it('keeps Phase 2 setup blocked with an exact reason when sample EPUB seeding fails', async () => {
    const result = await ensurePhase2LiveBook({
      caseRef: '14Ma',
      pre: { android: { bookIndex: { facts: [] } }, desktop: { library: { facts: [] } } },
      stateEnv: {},
      env: { android: { serverUrl: 'http://android.local' } },
      createDescriptor: () => ({ hash: 'seeded-book', fileName: 'sample-alice.epub', entry: { title: 'Alice' }, bytes: Buffer.from('epub') }),
      importBook: async () => ({ ok: false, error: 'HTTP 503: unavailable' }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.seeded, false);
    assert.equal(result.error, 'harness setup failed: unable to seed live book for Phase 2 case 14Ma: HTTP 503: unavailable');
  });

  it('seeds Android when only desktop has a live Phase 2 book after Android clean', async () => {
    const stateEnv = {};
    const result = await ensurePhase2LiveBook({
      caseRef: '9Ma',
      pre: {
        android: { bookIndex: { facts: [] }, manifest: { data: { books: [] } } },
        desktop: { library: { facts: [{ hash: 'desktop-only', title: 'Alice', updatedAt: 1783042203117, deletedAt: null }] } },
      },
      stateEnv,
      env: { android: { serverUrl: 'http://android.local' } },
      now: 1783042274764,
      createDescriptor: () => ({ hash: 'android-seeded', fileName: 'sample-alice.epub', entry: { title: 'Alice' }, bytes: Buffer.from('epub') }),
      importBook: async () => ({ ok: true, bookHash: 'android-seeded' }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.seeded, true);
    assert.equal(result.bookHash, 'android-seeded');
    assert.equal(stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH, 'android-seeded');
  });
});

describe('assertBookCount', () => {
  it('passes when live book count matches expected', () => {
    const result = assertBookCount(3, {
      books: [
        { hash: 'a' },
        { hash: 'b' },
        { hash: 'c' },
      ],
    });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('passes when zero books and expected is zero', () => {
    const result = assertBookCount(0, { books: [] });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when count does not match expected', () => {
    const result = assertBookCount(2, {
      books: [
        { hash: 'a' },
        { hash: 'b' },
        { hash: 'c' },
      ],
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'book-count');
    assert.equal(result.failures[0].expected, 2);
    assert.equal(result.failures[0].actual, 3);
  });

  it('excludes deleted books from count', () => {
    const result = assertBookCount(3, {
      books: [
        { hash: 'a' },
        { hash: 'b', deletedAt: null },
        { hash: 'c', deletedAt: 1700000000000 },
        { hash: 'd', deletedAt: undefined },
      ],
    });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('handles missing books array gracefully', () => {
    const result = assertBookCount(0, {});
    assert.equal(result.verdict, 'PASS');
  });
});

describe('assertFieldValue', () => {
  it('passes when dictionary entry definition matches expected value on desktop', () => {
    const state = {
      sqlite: {
        dictionary: {
          available: true,
          tables: [
            {
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'abismo', definition: 'very deep chasm' }],
            },
          ],
        },
      },
    };
    const result = assertFieldValue('dictionary-entry', 'abismo', 'definition', 'very deep chasm', state);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when dictionary entry definition does not match expected value', () => {
    const state = {
      sqlite: {
        dictionary: {
          available: true,
          tables: [
            {
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'abismo', definition: 'profound void' }],
            },
          ],
        },
      },
    };
    const result = assertFieldValue('dictionary-entry', 'abismo', 'definition', 'very deep chasm', state);
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'field-value-mismatch');
    assert.equal(result.failures[0].expected, 'very deep chasm');
    assert.equal(result.failures[0].actual, 'profound void');
  });

  it('fails when entity is not found in state', () => {
    const state = {
      sqlite: {
        dictionary: {
          available: true,
          tables: [
            {
              name: 'dictionary_entries',
              rowCount: 0,
              rows: [],
            },
          ],
        },
      },
    };
    const result = assertFieldValue('dictionary-entry', 'no-such-term', 'definition', 'anything', state);
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'entity-not-found');
  });

  it('passes when annotation note matches expected value', () => {
    const state = {
      sqlite: {
        annotations: {
          available: true,
          tables: [
            {
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'a1', text: 'selected', note: 'alternative interpretation' }],
            },
          ],
        },
      },
    };
    const result = assertFieldValue('annotation', 'a1', 'note', 'alternative interpretation', state);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('passes when book title matches expected value from library facts', () => {
    const state = {
      library: {
        facts: [{ hash: 'abc123', title: 'Android Title' }],
      },
    };
    const result = assertFieldValue('book', 'abc123', 'title', 'Android Title', state);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('reads dictionary entry from android replicas when desktop state not available', () => {
    const state = {
      replicas: {
        'dictionary-entry': {
          reachable: true,
          rowCount: 1,
          rows: [{ id: 'd1', term: 'abismo', definition: 'very deep chasm' }],
        },
      },
    };
    const result = assertFieldValue('dictionary-entry', 'abismo', 'definition', 'very deep chasm', state);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when sqlite table is unavailable', () => {
    const state = {
      sqlite: {
        dictionary: { available: false, tables: [] },
      },
    };
    const result = assertFieldValue('dictionary-entry', 'abismo', 'definition', 'anything', state);
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'source-unavailable');
  });
});

describe('assertEntityState', () => {
  it('returns live for a dictionary entry with null deleted_at', () => {
    const state = {
      sqlite: {
        dictionary: {
          available: true,
          tables: [
            {
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'valle', definition: 'valley', deleted_at: null }],
            },
          ],
        },
      },
    };
    const result = assertEntityState('dictionary-entry', 'valle', state);
    assert.equal(result.state, 'live');
    assert.equal(result.evidence.deletedAt, undefined);
  });

  it('returns tombstone for a dictionary entry with non-null deleted_at', () => {
    const state = {
      sqlite: {
        dictionary: {
          available: true,
          tables: [
            {
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'valle', definition: 'valley', deleted_at: 12345 }],
            },
          ],
        },
      },
    };
    const result = assertEntityState('dictionary-entry', 'valle', state);
    assert.equal(result.state, 'tombstone');
    assert.equal(result.evidence.deletedAt, 12345);
  });

  it('returns not-found when entity is missing', () => {
    const state = {
      sqlite: {
        dictionary: {
          available: true,
          tables: [
            {
              name: 'dictionary_entries',
              rowCount: 0,
              rows: [],
            },
          ],
        },
      },
    };
    const result = assertEntityState('dictionary-entry', 'missing-term', state);
    assert.equal(result.state, 'not-found');
  });

  it('returns live for a book with null deletedAt', () => {
    const state = {
      library: {
        facts: [{ hash: 'abc123', title: 'Alice', deletedAt: null }],
      },
    };
    const result = assertEntityState('book', 'abc123', state);
    assert.equal(result.state, 'live');
  });

  it('returns tombstone for an annotation with non-null deleted_at', () => {
    const state = {
      sqlite: {
        annotations: {
          available: true,
          tables: [
            {
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'a1', text: 'selected', note: 'original', deleted_at: 'T1500' }],
            },
          ],
        },
      },
    };
    const result = assertEntityState('annotation', 'a1', state);
    assert.equal(result.state, 'tombstone');
  });

  it('returns not-found when sqlite is unavailable', () => {
    const state = {
      sqlite: {
        dictionary: { available: false, tables: [] },
      },
    };
    const result = assertEntityState('dictionary-entry', 'any', state);
    assert.equal(result.state, 'not-found');
  });
});

describe('assertMetadata', () => {
  it('passes when book hash matches and field value matches', () => {
    const result = assertMetadata('abc', 'title', 'Alice', {
      books: [{ hash: 'abc', title: 'Alice' }],
    });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('matches by bookHash field as well', () => {
    const result = assertMetadata('abc', 'author', 'Lewis', {
      books: [{ bookHash: 'abc', author: 'Lewis' }],
    });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when book is not found', () => {
    const result = assertMetadata('missing', 'title', 'Alice', {
      books: [{ hash: 'abc', title: 'Alice' }],
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'book-not-found');
  });

  it('fails when field value does not match', () => {
    const result = assertMetadata('abc', 'title', 'Bob', {
      books: [{ hash: 'abc', title: 'Alice' }],
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'metadata-mismatch');
    assert.equal(result.failures[0].expected, 'Bob');
    assert.equal(result.failures[0].actual, 'Alice');
  });

  it('handles missing books array gracefully', () => {
    const result = assertMetadata('abc', 'title', 'Alice', {});
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures[0].invariant, 'book-not-found');
  });
});

describe('case-15 computeCaseAcceptanceVerdict', () => {
  it('15a passes when desktop book propagates to both sides', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Book', updatedAt: '2026-01-01T00:00:00.000Z' }] } },
      android: { bookIndex: { facts: [] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Book', updatedAt: '2026-07-02T00:00:00.000Z' }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Book', updatedAt: 1782950400000 }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15a', pre, post), 'pass');
  });

  it('15a returns warn when android does not get the book', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Book' }] } },
      android: { bookIndex: { facts: [] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Book' }] } },
      android: { bookIndex: { facts: [] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15a', pre, post), 'warn');
  });

  it('15a returns fail on duplicate hash on either side', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Book' }] } },
      android: { bookIndex: { facts: [] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'book-1' }, { hash: 'book-1' }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1' }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15a', pre, post), 'fail');
  });

  it('15b passes when android book propagates to both sides', () => {
    const pre = {
      desktop: { library: { facts: [] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Book', updatedAt: 1782900000000 }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Book', updatedAt: '2026-07-02T00:00:00.000Z' }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Book', updatedAt: 1782950400000 }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15b', pre, post), 'pass');
  });

  it('15c passes when both had same book and each has one copy after sync', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Same' }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Same' }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Same' }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Same' }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15c', pre, post), 'pass');
  });

  it('15c returns warn when a side has no common hash', () => {
    const pre = {
      desktop: { library: { facts: [] } },
      android: { bookIndex: { facts: [] } },
    };
    const post = {
      desktop: { library: { facts: [] } },
      android: { bookIndex: { facts: [] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15c', pre, post), 'warn');
  });

  it('15d passes when titles converge and both updatedAt are newer', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: 1782900000000 }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: 1782900000000 }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'NewTitle', updatedAt: 1783000000000 }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'NewTitle', updatedAt: 1783000000000 }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15d', pre, post), 'pass');
  });

  it('15d returns warn when titles do not match', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: 1782900000000 }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'Old', updatedAt: 1782900000000 }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'book-1', title: 'DesktopTitle', updatedAt: 1783000000000 }] } },
      android: { bookIndex: { facts: [{ hash: 'book-1', title: 'AndroidTitle', updatedAt: 1783000000000 }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15d', pre, post), 'warn');
  });

  it('15e passes when both hashes appear on both sides', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'AAA', title: 'Same' }] } },
      android: { bookIndex: { facts: [{ hash: 'BBB', title: 'Same' }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'AAA', title: 'Same' }, { hash: 'BBB', title: 'Same' }] } },
      android: { bookIndex: { facts: [{ hash: 'AAA', title: 'Same' }, { hash: 'BBB', title: 'Same' }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15e', pre, post), 'pass');
  });

  it('15e returns warn when data is missing', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'AAA', title: 'Same' }] } },
      android: { bookIndex: { facts: [{ hash: 'BBB', title: 'Same' }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'AAA' }] } },
      android: { bookIndex: { facts: [{ hash: 'BBB' }] } },
    };
    assert.equal(computeCaseAcceptanceVerdict('15e', pre, post), 'warn');
  });
});

describe('case-16 computeCaseAcceptanceVerdict', () => {
  const basePre = {
    desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0 }, { name: 'dictionary_occurrences', rowCount: 0 }] } } },
    android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0 }, 'dictionary-occurrence': { reachable: true, rowCount: 0 } } },
  };
  const basePost = {
    desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1 }, { name: 'dictionary_occurrences', rowCount: 1 }] } } },
    android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1 }, 'dictionary-occurrence': { reachable: true, rowCount: 1 } } },
  };
  const context = { caseActions: [{ caseRef: '16a', bookHash: 'h1', term: 'test-term' }] };

  it('16a passes when dictionary propagates to both sides', () => {
    assert.equal(computeCaseAcceptanceVerdict('16a', basePre, basePost, context), 'pass');
  });
  it('16a returns warn when android does not have dictionary-entry replicas', () => {
    const noAndroid = {
      ...basePost,
      android: { replicas: { 'dictionary-entry': { reachable: false, rowCount: 0 }, 'dictionary-occurrence': { reachable: false, rowCount: 0 } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('16a', basePre, noAndroid, context), 'warn');
  });
  it('16a returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('16a', basePre, basePost, {}), 'warn');
  });
  it('16a returns fail on duplicate rows', () => {
    const duplicatePost = {
      ...basePost,
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2 }, { name: 'dictionary_occurrences', rowCount: 1 }] } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('16a', basePre, duplicatePost, context), 'fail');
  });
  it('16b passes when android dict propagates to desktop', () => {
    const ctx = { caseActions: [{ caseRef: '16b', bookHash: 'h1', term: 'test-term' }] };
    assert.equal(computeCaseAcceptanceVerdict('16b', basePre, basePost, ctx), 'pass');
  });
});

describe('case-17 computeCaseAcceptanceVerdict', () => {
  const basePre = {
    desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] } } },
    android: { replicas: { quote: { reachable: true, rowCount: 0 } } },
  };
  const basePost = {
    desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 1 }] } } },
    android: { replicas: { quote: { reachable: true, rowCount: 1 } } },
  };
  const context = { caseActions: [{ caseRef: '17a', bookHash: 'h1', text: 'test-quote' }] };

  it('17a passes when quote propagates to both sides', () => {
    assert.equal(computeCaseAcceptanceVerdict('17a', basePre, basePost, context), 'pass');
  });
  it('17a returns warn when android does not have quote replicas', () => {
    const noAndroid = {
      ...basePost,
      android: { replicas: { quote: { reachable: false, rowCount: 0 } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('17a', basePre, noAndroid, context), 'warn');
  });
  it('17b passes when android quote propagates to desktop', () => {
    const ctx = { caseActions: [{ caseRef: '17b', bookHash: 'h1', text: 'test-quote' }] };
    assert.equal(computeCaseAcceptanceVerdict('17b', basePre, basePost, ctx), 'pass');
  });
});

describe('case-18 computeCaseAcceptanceVerdict', () => {
  const basePre = {
    desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0 }, { name: 'dictionary_occurrences', rowCount: 0 }] } } },
    android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0 }, 'dictionary-occurrence': { reachable: true, rowCount: 0 } } },
  };
  const basePost = {
    desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1 }, { name: 'dictionary_occurrences', rowCount: 1 }] } } },
    android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1 }, 'dictionary-occurrence': { reachable: true, rowCount: 1 } } },
  };
  const context = { caseActions: [{ caseRef: '18a', bookHash: 'h1', term: 'case18-term-test' }] };

  it('18a passes when dict entry exists on both sides after edit cycle', () => {
    assert.equal(computeCaseAcceptanceVerdict('18a', basePre, basePost, context), 'pass');
  });
  it('18a returns warn when android does not have dictionary-entry replicas', () => {
    const noAndroid = {
      ...basePost,
      android: { replicas: { 'dictionary-entry': { reachable: false, rowCount: 0 }, 'dictionary-occurrence': { reachable: false, rowCount: 0 } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('18a', basePre, noAndroid, context), 'warn');
  });
  it('18a returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('18a', basePre, basePost, {}), 'warn');
  });
  it('18a returns fail on duplicate dictionary rows', () => {
    const duplicatePost = {
      ...basePost,
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2 }, { name: 'dictionary_occurrences', rowCount: 1 }] } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('18a', basePre, duplicatePost, context), 'fail');
  });
  it('18b passes when android dict entry propagates to desktop', () => {
    const ctx = { caseActions: [{ caseRef: '18b', bookHash: 'h1', term: 'case18-term-other' }] };
    assert.equal(computeCaseAcceptanceVerdict('18b', basePre, basePost, ctx), 'pass');
  });
  it('18b returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('18b', basePre, basePost, {}), 'warn');
  });
  it('18b returns fail on duplicate android replicas', () => {
    const duplicatePost = {
      ...basePost,
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 2 }, 'dictionary-occurrence': { reachable: true, rowCount: 1 } } },
    };
    const ctx = { caseActions: [{ caseRef: '18b', bookHash: 'h1', term: 'case18-term-other' }] };
    assert.equal(computeCaseAcceptanceVerdict('18b', basePre, duplicatePost, ctx), 'fail');
  });
});

describe('case-19 computeCaseAcceptanceVerdict', () => {
  const basePre = {
    desktop: {
      sqlite: {
        dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0 }, { name: 'dictionary_occurrences', rowCount: 0 }] },
        quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] },
      },
    },
    android: {
      replicas: {
        'dictionary-entry': { reachable: true, rowCount: 0 },
        'dictionary-occurrence': { reachable: true, rowCount: 0 },
        quote: { reachable: true, rowCount: 0 },
      },
    },
  };
  const basePost = {
    desktop: {
      sqlite: {
        dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1 }, { name: 'dictionary_occurrences', rowCount: 1 }] },
        quotes: { available: true, tables: [{ name: 'quotes', rowCount: 1 }] },
      },
    },
    android: {
      replicas: {
        'dictionary-entry': { reachable: true, rowCount: 1 },
        'dictionary-occurrence': { reachable: true, rowCount: 1 },
        quote: { reachable: true, rowCount: 1 },
      },
    },
  };
  const context = { caseActions: [{ caseRef: '19a', bookHash: 'h1', term: 'case19-term-test' }] };

  it('19a passes when dict and quote coexist on both sides', () => {
    assert.equal(computeCaseAcceptanceVerdict('19a', basePre, basePost, context), 'pass');
  });
  it('19a returns warn when android lacks quote replica', () => {
    const noQuote = {
      ...basePost,
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1 }, 'dictionary-occurrence': { reachable: true, rowCount: 1 }, quote: { reachable: false, rowCount: 0 } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('19a', basePre, noQuote, context), 'warn');
  });
  it('19a returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('19a', basePre, basePost, {}), 'warn');
  });
  it('19a returns fail on duplicate dict entries', () => {
    const dupPost = {
      ...basePost,
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2 }, { name: 'dictionary_occurrences', rowCount: 1 }] }, quotes: { available: true, tables: [{ name: 'quotes', rowCount: 1 }] } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('19a', basePre, dupPost, context), 'fail');
  });
  it('19b passes when android-first flow converges', () => {
    const ctx = { caseActions: [{ caseRef: '19b', bookHash: 'h1', term: 'case19-term-other' }] };
    assert.equal(computeCaseAcceptanceVerdict('19b', basePre, basePost, ctx), 'pass');
  });
});

describe('case-23 computeCaseAcceptanceVerdict — concurrent creations', () => {
  const basePre23 = {
    desktop: {
      sqlite: {
        dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0 }, { name: 'dictionary_occurrences', rowCount: 0 }] },
        quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] },
        annotations: { available: true, tables: [{ name: 'annotations', rowCount: 0 }] },
      },
      library: { facts: [] },
    },
    android: {
      replicas: {
        'dictionary-entry': { reachable: true, rowCount: 0 },
        'dictionary-occurrence': { reachable: true, rowCount: 0 },
        quote: { reachable: true, rowCount: 0 },
        annotation: { reachable: true, rowCount: 0 },
      },
      bookIndex: { facts: [] },
    },
  };
  const context23 = { caseActions: [{ caseRef: '23a', bookHash: 'hashXYZ' }] };

  it('23a passes when same book same ID appears on both sides (no duplicate)', () => {
    const post = {
      desktop: { library: { facts: [{ hash: 'hashXYZ', title: 'Book' }] }, sqlite: basePre23.desktop.sqlite },
      android: { bookIndex: { facts: [{ hash: 'hashXYZ', title: 'Book' }] }, replicas: basePre23.android.replicas },
    };
    assert.equal(computeCaseAcceptanceVerdict('23a', basePre23, post, context23), 'pass');
  });

  it('23a returns fail on duplicate book hash on either side', () => {
    const post = {
      desktop: { library: { facts: [{ hash: 'hashXYZ' }, { hash: 'hashXYZ' }] }, sqlite: basePre23.desktop.sqlite },
      android: { bookIndex: { facts: [{ hash: 'hashXYZ' }] }, replicas: basePre23.android.replicas },
    };
    assert.equal(computeCaseAcceptanceVerdict('23a', basePre23, post, context23), 'fail');
  });

  it('23a returns warn when no common hash found', () => {
    const post = {
      desktop: { library: { facts: [] }, sqlite: basePre23.desktop.sqlite },
      android: { bookIndex: { facts: [] }, replicas: basePre23.android.replicas },
    };
    assert.equal(computeCaseAcceptanceVerdict('23a', basePre23, post, {}), 'warn');
  });

  it('23b returns fail on duplicate hash', () => {
    const post = {
      desktop: { library: { facts: [{ hash: 'hashXYZ' }, { hash: 'hashXYZ' }] }, sqlite: basePre23.desktop.sqlite },
      android: { bookIndex: { facts: [{ hash: 'hashXYZ' }] }, replicas: basePre23.android.replicas },
    };
    const ctx = { caseActions: [{ caseRef: '23b', bookHash: 'hashXYZ' }] };
    assert.equal(computeCaseAcceptanceVerdict('23b', basePre23, post, ctx), 'fail');
  });

  it('23b returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('23b', basePre23, basePre23, {}), 'warn');
  });

  it('23b passes when same hash appears once on both sides', () => {
    const post = {
      desktop: { library: { facts: [{ hash: 'hashXYZ', title: 'Unique' }] }, sqlite: basePre23.desktop.sqlite },
      android: { bookIndex: { facts: [{ hash: 'hashXYZ', title: 'Unique' }] }, replicas: basePre23.android.replicas },
    };
    const ctx = { caseActions: [{ caseRef: '23b', bookHash: 'hashXYZ' }] };
    assert.equal(computeCaseAcceptanceVerdict('23b', basePre23, post, ctx), 'pass');
  });

  it('23c passes when dictionary entry converges (same as 16a logic)', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0 }, { name: 'dictionary_occurrences', rowCount: 0 }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0 }, 'dictionary-occurrence': { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1 }, { name: 'dictionary_occurrences', rowCount: 1 }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1 }, 'dictionary-occurrence': { reachable: true, rowCount: 1 } } },
    };
    const ctx = { caseActions: [{ caseRef: '23c', bookHash: 'h1', term: 'zozobrar' }] };
    assert.equal(computeCaseAcceptanceVerdict('23c', pre, post, ctx), 'pass');
  });

  it('23c returns warn when no caseAction found', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0 }, { name: 'dictionary_occurrences', rowCount: 0 }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0 }, 'dictionary-occurrence': { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1 }, { name: 'dictionary_occurrences', rowCount: 1 }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1 }, 'dictionary-occurrence': { reachable: true, rowCount: 1 } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('23c', pre, post, {}), 'warn');
  });

  it('23c returns fail on duplicate dictionary entries', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0 }, { name: 'dictionary_occurrences', rowCount: 0 }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0 }, 'dictionary-occurrence': { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2 }, { name: 'dictionary_occurrences', rowCount: 1 }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1 }, 'dictionary-occurrence': { reachable: true, rowCount: 1 } } },
    };
    const ctx = { caseActions: [{ caseRef: '23c', bookHash: 'h1', term: 'zozobrar' }] };
    assert.equal(computeCaseAcceptanceVerdict('23c', pre, post, ctx), 'fail');
  });

  it('23d returns fail on duplicate quotes', () => {
    const pre = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 2 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 1 } } },
    };
    const ctx = { caseActions: [{ caseRef: '23d', bookHash: 'h1', text: 'test-quote' }] };
    assert.equal(computeCaseAcceptanceVerdict('23d', pre, post, ctx), 'fail');
  });

  it('23d returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('23d', {}, {}, {}), 'warn');
  });

  it('23d passes when quote converges (same as 17a logic)', () => {
    const pre = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 1 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 1 } } },
    };
    const ctx = { caseActions: [{ caseRef: '23d', bookHash: 'h1', text: 'test-quote' }] };
    assert.equal(computeCaseAcceptanceVerdict('23d', pre, post, ctx), 'pass');
  });

  it('23e passes when two quotes exist on both sides (different books)', () => {
    const pre = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 2 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 2 } } },
    };
    const ctx = { caseActions: [{ caseRef: '23e', bookHash: 'h1', secondHash: 'h2' }] };
    assert.equal(computeCaseAcceptanceVerdict('23e', pre, post, ctx), 'pass');
  });

  it('23e returns fail on duplicate quotes', () => {
    const pre = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 3 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 2 } } },
    };
    const ctx = { caseActions: [{ caseRef: '23e', bookHash: 'h1', secondHash: 'h2' }] };
    assert.equal(computeCaseAcceptanceVerdict('23e', pre, post, ctx), 'fail');
  });

  it('23e returns warn when no caseAction found', () => {
    const pre = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 2 }] } } },
      android: { replicas: { quote: { reachable: true, rowCount: 2 } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('23e', pre, post, {}), 'warn');
  });
});

describe('case-24 computeCaseAcceptanceVerdict — annotations same range', () => {
  const basePre24 = {
    desktop: {
      sqlite: {
        annotations: { available: true, tables: [{ name: 'annotations', rowCount: 0 }] },
      },
    },
    android: {
      replicas: {
        annotation: { reachable: true, rowCount: 0 },
      },
      bookConfig: { status: 'pass', booknoteCount: 0, booknotes: [] },
    },
  };

  it('passes when two annotations exist on both sides with notes preserved', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 2,
              rows: [
                { id: 'n1', text: 'selected', note: 'Idea A' },
                { id: 'n2', text: 'selected', note: 'Idea B' },
              ],
            }],
          },
        },
        bookConfig: {
          status: 'pass',
          booknoteCount: 2,
          booknotes: [
            { id: 'bn1', annotationId: 'n1', text: 'selected', note: 'Idea A' },
            { id: 'bn2', annotationId: 'n2', text: 'selected', note: 'Idea B' },
          ],
        },
      },
      android: {
        replicas: { annotation: { reachable: true, rowCount: 2 } },
        bookConfig: {
          status: 'pass',
          booknoteCount: 2,
          booknotes: [
            { id: 'bn1', annotationId: 'n1', text: 'selected', note: 'Idea A' },
            { id: 'bn2', annotationId: 'n2', text: 'selected', note: 'Idea B' },
          ],
        },
      },
    };
    const ctx = { caseActions: [{ caseRef: '24', bookHash: 'h1' }] };
    assert.equal(computeCaseAcceptanceVerdict('24', basePre24, post, ctx), 'pass');
  });

  it('returns fail when only one annotation exists', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'n1', text: 'selected', note: 'Idea A' }],
            }],
          },
        },
        bookConfig: {
          status: 'pass',
          booknoteCount: 1,
          booknotes: [{ id: 'bn1', annotationId: 'n1', text: 'selected', note: 'Idea A' }],
        },
      },
      android: {
        replicas: { annotation: { reachable: true, rowCount: 1 } },
        bookConfig: {
          status: 'pass',
          booknoteCount: 1,
          booknotes: [{ id: 'bn1', annotationId: 'n1', text: 'selected', note: 'Idea A' }],
        },
      },
    };
    const ctx = { caseActions: [{ caseRef: '24', bookHash: 'h1' }] };
    assert.equal(computeCaseAcceptanceVerdict('24', basePre24, post, ctx), 'fail');
  });

  it('returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('24', basePre24, basePre24, {}), 'warn');
  });

  it('returns warn when bookConfig is missing on desktop', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 2,
              rows: [
                { id: 'n1', text: 'selected', note: 'Idea A' },
                { id: 'n2', text: 'selected', note: 'Idea B' },
              ],
            }],
          },
        },
      },
      android: {
        replicas: { annotation: { reachable: true, rowCount: 2 } },
      },
    };
    const ctx = { caseActions: [{ caseRef: '24', bookHash: 'h1' }] };
    assert.equal(computeCaseAcceptanceVerdict('24', basePre24, post, ctx), 'warn');
  });

  it('passes by run-specific annotation ids when stale Idea A/B rows already exist', () => {
    const pre = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 2,
              rows: [
                { id: 'stale-a', bookHash: 'h1', cfi: '/6/4[section]!/6/2:0', text: 'selected', note: 'Idea A' },
                { id: 'stale-b', bookHash: 'h1', cfi: '/6/4[section]!/6/2:0', text: 'selected', note: 'Idea B' },
              ],
            }],
          },
        },
      },
      android: {
        replicas: {
          annotation: {
            reachable: true,
            rowCount: 2,
            rows: [
              { id: 'stale-a', bookHash: 'h1', cfi: '/6/4[section]!/6/2:0', text: 'selected', note: 'Idea A' },
              { id: 'stale-b', bookHash: 'h1', cfi: '/6/4[section]!/6/2:0', text: 'selected', note: 'Idea B' },
            ],
          },
        },
        bookConfig: { status: 'pass', booknoteCount: 0, booknotes: [] },
      },
    };
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 2,
              rows: [
                { id: 'run-desktop-ann', bookHash: 'h1', cfi: '/6/4[case24-run-1]!/6/2:0', text: 'selected', note: 'case24-run-1-Idea A' },
                { id: 'run-android-ann', bookHash: 'h1', cfi: '/6/4[case24-run-1]!/6/2:0', text: 'selected', note: 'case24-run-1-Idea B' },
              ],
            }],
          },
        },
        bookConfig: {
          status: 'pass',
          booknoteCount: 2,
          booknotes: [
            { id: 'bn-run-desktop', annotationId: 'run-desktop-ann', text: 'selected', note: 'case24-run-1-Idea A' },
            { id: 'bn-run-android', annotationId: 'run-android-ann', text: 'selected', note: 'case24-run-1-Idea B' },
          ],
        },
      },
      android: {
        replicas: {
          annotation: {
            reachable: true,
            rowCount: 2,
            rows: [
              { id: 'run-desktop-ann', bookHash: 'h1', cfi: '/6/4[case24-run-1]!/6/2:0', text: 'selected', note: 'case24-run-1-Idea A' },
              { id: 'run-android-ann', bookHash: 'h1', cfi: '/6/4[case24-run-1]!/6/2:0', text: 'selected', note: 'case24-run-1-Idea B' },
            ],
          },
        },
        bookConfig: {
          status: 'pass',
          booknoteCount: 2,
          booknotes: [
            { id: 'bn-run-desktop', annotationId: 'run-desktop-ann', text: 'selected', note: 'case24-run-1-Idea A' },
            { id: 'bn-run-android', annotationId: 'run-android-ann', text: 'selected', note: 'case24-run-1-Idea B' },
          ],
        },
      },
    };
    const ctx = {
      caseActions: [{
        caseRef: '24',
        bookHash: 'h1',
        cfi: '/6/4[case24-run-1]!/6/2:0',
        annIds: ['run-desktop-ann', 'run-android-ann'],
        notes: ['case24-run-1-Idea A', 'case24-run-1-Idea B'],
      }],
    };

    assert.equal(computeCaseAcceptanceVerdict('24', pre, post, ctx), 'pass');
  });

  it('fails when a run-specific annotation is duplicated or lost', () => {
    const pre = basePre24;
    const action = {
      caseRef: '24',
      bookHash: 'h1',
      cfi: '/6/4[case24-run-2]!/6/2:0',
      annIds: ['run-desktop-ann', 'run-android-ann'],
      notes: ['case24-run-2-Idea A', 'case24-run-2-Idea B'],
    };
    const completeDesktop = [
      { id: 'run-desktop-ann', bookHash: 'h1', cfi: action.cfi, text: 'selected', note: action.notes[0] },
      { id: 'run-android-ann', bookHash: 'h1', cfi: action.cfi, text: 'selected', note: action.notes[1] },
    ];
    const duplicatePost = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{ name: 'annotations', rowCount: 3, rows: [...completeDesktop, { id: 'run-duplicate-ann', bookHash: 'h1', cfi: action.cfi, text: 'selected', note: action.notes[1] }] }],
          },
        },
        bookConfig: phase4BookConfigState(completeDesktop.map((row) => ({ id: `bn-${row.id}`, annotationId: row.id, text: row.text, note: row.note }))).bookConfig,
      },
      android: {
        replicas: { annotation: { reachable: true, rowCount: 2, rows: completeDesktop } },
        bookConfig: phase4BookConfigState(completeDesktop.map((row) => ({ id: `bn-${row.id}`, annotationId: row.id, text: row.text, note: row.note }))).bookConfig,
      },
    };
    const lostPost = {
      desktop: duplicatePost.desktop,
      android: {
        replicas: { annotation: { reachable: true, rowCount: 1, rows: [completeDesktop[0]] } },
        bookConfig: phase4BookConfigState([{ id: 'bn-run-desktop-ann', annotationId: 'run-desktop-ann', text: 'selected', note: action.notes[0] }]).bookConfig,
      },
    };

    assert.equal(computeCaseAcceptanceVerdict('24', pre, duplicatePost, { caseActions: [action] }), 'fail');
    assert.equal(computeCaseAcceptanceVerdict('24', pre, lostPost, { caseActions: [action] }), 'fail');
  });

  it('creates run-scoped notes and CFI and returns annotation ids for assertions', async () => {
    const calls = [];
    const result = await setupCase24Ref('24', {}, { android: { serverUrl: 'http://android.test' } }, 'case24-run-3', 1700000000000, {
      spawnStateJson: () => ({ android: { bookIndex: { facts: [{ hash: 'h1' }] } } }),
      ensurePhase2LiveBook: async () => ({ ok: true, bookHash: 'h1' }),
      spawnFixture: (_stateEnv, args) => {
        calls.push(args);
        return { ok: true, annId: args[1] === 'desktop' ? 'desktop-ann-case24-run-3' : 'android-ann-case24-run-3' };
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.annIds, ['desktop-ann-case24-run-3', 'android-ann-case24-run-3']);
    assert.deepEqual(result.notes, ['case24-run-3-Idea A', 'case24-run-3-Idea B']);
    assert.equal(result.cfi, '/6/4[case24-run-3]!/6/2:0');
    assert.deepEqual(calls.map((args) => args[3]), ['case24-run-3-Idea A', 'case24-run-3-Idea B']);
    assert.deepEqual(calls.map((args) => args[7]), ['/6/4[case24-run-3]!/6/2:0', '/6/4[case24-run-3]!/6/2:0']);
  });

  // PC-4: count-based coexistence fallback — divergent annIds across devices
  // but both sides have >= 2 annotations at same CFI with distinct notes.
  it('passes when annIds diverge across devices but count >= 2 with distinct notes at same CFI', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 2,
              rows: [
                { id: 'n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'Idea A' },
                { id: 'n2', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'Idea B' },
              ],
            }],
          },
        },
        bookConfig: {
          status: 'pass',
          booknoteCount: 2,
          booknotes: [
            { id: 'bn1', annotationId: 'n1', text: 'selected', note: 'Idea A' },
            { id: 'bn2', annotationId: 'n2', text: 'selected', note: 'Idea B' },
          ],
        },
      },
      android: {
        replicas: {
          annotation: {
            reachable: true,
            rowCount: 2,
            rows: [
              { id: 'a1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'Idea A' },
              { id: 'a2', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'Idea B' },
            ],
          },
        },
        bookConfig: {
          status: 'pass',
          booknoteCount: 2,
          booknotes: [
            { id: 'bn1', annotationId: 'a1', text: 'selected', note: 'Idea A' },
            { id: 'bn2', annotationId: 'a2', text: 'selected', note: 'Idea B' },
          ],
        },
      },
    };
    // annIds only match desktop; after fix the count-based fallback accepts
    const ctx = {
      caseActions: [{
        caseRef: '24',
        bookHash: 'h1',
        cfi: '/6/4',
        annIds: ['n1', 'n2'],
        notes: ['Idea A', 'Idea B'],
      }],
    };
    assert.equal(computeCaseAcceptanceVerdict('24', basePre24, post, ctx), 'pass');
  });

  // PC-4: Android annotation rows arrive with nested fields_jsonb.
  // flattenAndroidRow must extract bookHash, cfi, note so the count-based
  // coexistence fallback can filter and validate by direct field access.
  it('passes with fields_jsonb envelope format on Android annotations', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: { available: true, tables: [{ name: 'annotations', rowCount: 2, rows: [
            { id: 'n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'Idea A' },
            { id: 'n2', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'Idea B' },
          ] }] },
        },
        bookConfig: { status: 'pass', booknoteCount: 2, booknotes: [
          { id: 'bn1', annotationId: 'n1', text: 'selected', note: 'Idea A' },
          { id: 'bn2', annotationId: 'n2', text: 'selected', note: 'Idea B' },
        ] },
      },
      android: {
        replicas: { annotation: { reachable: true, rowCount: 2, rows: [
          { replica_id: 'annotation:a1', fields_jsonb: { bookHash: { v: 'h1' }, cfi: { v: '/6/4' }, text: { v: 'selected' }, note: { v: 'Idea A' } } },
          { replica_id: 'annotation:a2', fields_jsonb: { bookHash: { v: 'h1' }, cfi: { v: '/6/4' }, text: { v: 'selected' }, note: { v: 'Idea B' } } },
        ] } },
        bookConfig: { status: 'pass', booknoteCount: 2, booknotes: [
          { id: 'bn1', annotationId: 'a1', text: 'selected', note: 'Idea A' },
          { id: 'bn2', annotationId: 'a2', text: 'selected', note: 'Idea B' },
        ] },
      },
    };
    const ctx = { caseActions: [{ caseRef: '24', bookHash: 'h1', cfi: '/6/4', annIds: ['a1', 'a2'], notes: ['Idea A', 'Idea B'] }] };
    assert.equal(computeCaseAcceptanceVerdict('24', basePre24, post, ctx), 'pass');
  });
});

describe('case-21 computeCaseAcceptanceVerdict — same-field edit', () => {
  it('21a passes when definition converges to newer HLC value (android wins)', () => {
    const pre = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'abismo', definition: 'deep hole' }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 0 },
          'dictionary-occurrence': { reachable: true, rowCount: 0 },
        },
      },
    };
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'abismo', definition: 'very deep chasm' }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'abismo', definition: 'very deep chasm' }] },
          'dictionary-occurrence': { reachable: true, rowCount: 0 },
        },
      },
    };
    const ctx = {
      caseActions: [{
        caseRef: '21a',
        bookHash: 'h1',
        term: 'abismo',
        edits: [
          { device: 'desktop', hlc: 10, value: 'profound void' },
          { device: 'android', hlc: 11, value: 'very deep chasm' },
        ],
      }],
    };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctx), 'pass');
  });

  it('21a returns fail when definition reverts to stale value', () => {
    const pre = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'abismo', definition: 'deep hole' }],
            }],
          },
        },
      },
      android: { replicas: {} },
    };
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'abismo', definition: 'deep hole' }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'abismo', definition: 'deep hole' }] },
        },
      },
    };
    const ctx = { caseActions: [{ caseRef: '21a', bookHash: 'h1' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctx), 'fail');
  });

  it('21a passes when both desktop entries converge to same definition (semantic dedup — benign duplicate)', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'd0', term: 'abismo', definition: 'deep hole' }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'a0', term: 'abismo', definition: 'deep hole' }] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2, rows: [
        { id: 'd1', term: 'abismo', definition: 'very deep chasm' },
        { id: 'd2', term: 'abismo', definition: 'very deep chasm' },
      ] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'a1', term: 'abismo', definition: 'very deep chasm' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21a', bookHash: 'h1', term: 'abismo' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctx), 'pass');
  });

  it('21a returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('21a', {}, {}, {}), 'warn');
  });

  it('21b returns fail when note reverts to stale value', () => {
    const pre = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'a1', text: 'selected', note: 'original idea' }],
            }],
          },
        },
      },
      android: { replicas: { annotation: { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'a1', text: 'selected', note: 'original idea' }],
            }],
          },
        },
      },
      android: {
        replicas: {
          annotation: { reachable: true, rowCount: 1, rows: [{ id: 'a1', text: 'selected', note: 'original idea' }] },
        },
      },
    };
    const ctx = { caseActions: [{ caseRef: '21b', bookHash: 'h1' }] };
    assert.equal(computeCaseAcceptanceVerdict('21b', pre, post, ctx), 'fail');
  });

  it('21b returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('21b', {}, {}, {}), 'warn');
  });

  it('21b passes when note converges to newer HLC value (android wins) and text unchanged', () => {
    const pre = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'a1', text: 'selected', note: 'original idea' }],
            }],
          },
        },
      },
      android: { replicas: { annotation: { reachable: true, rowCount: 0 } } },
    };
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'a1', text: 'selected', note: 'alternative interpretation' }],
            }],
          },
        },
      },
      android: {
        replicas: {
          annotation: { reachable: true, rowCount: 1, rows: [{ id: 'a1', text: 'selected', note: 'alternative interpretation' }] },
        },
      },
    };
    const ctx = {
      caseActions: [{
        caseRef: '21b',
        bookHash: 'h1',
        edits: [
          { device: 'desktop', hlc: 10, value: 'revised analysis' },
          { device: 'android', hlc: 12, value: 'alternative interpretation' },
        ],
      }],
    };
    assert.equal(computeCaseAcceptanceVerdict('21b', pre, post, ctx), 'pass');
  });

  it('21b uses the action semantic text instead of the stale fixture default', () => {
    const pre = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 1, rows: [{ id: 'a1', bookHash: 'h1', cfi: '/6/4', text: 'selected-run-42', note: 'original idea' }] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 1, rows: [{ id: 'b1', bookHash: 'h1', cfi: '/6/4', text: 'selected-run-42', note: 'original idea' }] } } },
    };
    const post = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 1, rows: [{ id: 'a1', bookHash: 'h1', cfi: '/6/4', text: 'selected-run-42', note: 'alternative interpretation' }] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 1, rows: [{ id: 'b1', bookHash: 'h1', cfi: '/6/4', text: 'selected-run-42', note: 'alternative interpretation' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21b', bookHash: 'h1', text: 'selected-run-42' }] };
    assert.equal(computeCaseAcceptanceVerdict('21b', pre, post, ctx), 'pass');
  });

  it('21c returns fail when both sides have stale title values', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'abc123', title: 'Original' }] } },
      android: { bookIndex: { facts: [{ hash: 'abc123', title: 'Original' }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'abc123', title: 'Original' }] } },
      android: { bookIndex: { facts: [{ hash: 'abc123', title: 'Original' }] } },
    };
    const ctx = { caseActions: [{ caseRef: '21c', bookHash: 'abc123' }] };
    assert.equal(computeCaseAcceptanceVerdict('21c', pre, post, ctx), 'fail');
  });

  it('21c returns warn when titles do not converge (one side has expected value)', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'abc123', title: 'Original' }] } },
      android: { bookIndex: { facts: [{ hash: 'abc123', title: 'Original' }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'abc123', title: 'Desktop Title' }] } },
      android: { bookIndex: { facts: [{ hash: 'abc123', title: 'Android Title' }] } },
    };
    const ctx = { caseActions: [{ caseRef: '21c', bookHash: 'abc123' }] };
    assert.equal(computeCaseAcceptanceVerdict('21c', pre, post, ctx), 'warn');
  });

  it('21c returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('21c', {}, {}, {}), 'warn');
  });

  it('21c passes when title converges to newer HLC value (android wins)', () => {
    const pre = {
      desktop: { library: { facts: [{ hash: 'abc123', title: 'Original' }] } },
      android: { bookIndex: { facts: [{ hash: 'abc123', title: 'Original' }] } },
    };
    const post = {
      desktop: { library: { facts: [{ hash: 'abc123', title: 'Android Title' }] } },
      android: { bookIndex: { facts: [{ hash: 'abc123', title: 'Android Title' }] } },
    };
    const ctx = {
      caseActions: [{
        caseRef: '21c',
        bookHash: 'abc123',
        edits: [
          { device: 'desktop', hlc: 9, value: 'Desktop Title' },
          { device: 'android', hlc: 14, value: 'Android Title' },
        ],
      }],
    };
    assert.equal(computeCaseAcceptanceVerdict('21c', pre, post, ctx), 'pass');
  });

  it('21d returns warn when definitions differ between devices', () => {
    const pre = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'suerte', definition: 'chance' }],
            }],
          },
        },
      },
      android: { replicas: {} },
    };
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'suerte', definition: 'fate' }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'suerte', definition: 'luck' }] },
        },
      },
    };
    const ctx = { caseActions: [{ caseRef: '21d', bookHash: 'h1', term: 'suerte' }] };
    assert.equal(computeCaseAcceptanceVerdict('21d', pre, post, ctx), 'warn');
  });

  it('21d returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('21d', {}, {}, {}), 'warn');
  });

  it('21d passes when same definition on both sides (tiebreak resolved)', () => {
    const pre = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'suerte', definition: 'chance' }],
            }],
          },
        },
      },
      android: { replicas: {} },
    };
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'suerte', definition: 'fate' }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'suerte', definition: 'fate' }] },
        },
      },
    };
    const ctx = {
      caseActions: [{
        caseRef: '21d',
        bookHash: 'h1',
        term: 'suerte',
        edits: [
          { device: 'desktop', hlc: 'T1000:1:desktop-node', value: 'fate' },
          { device: 'android', hlc: 'T1000:1:android-node', value: 'luck' },
        ],
      }],
    };
    assert.equal(computeCaseAcceptanceVerdict('21d', pre, post, ctx), 'pass');
  });

  it('21d returns fail when both sides converge to neither edit winner', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'd1', term: 'suerte', definition: 'chance' }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'a1', term: 'suerte', definition: 'chance' }] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'd1', term: 'suerte', definition: 'chance' }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'a1', term: 'suerte', definition: 'chance' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21d', bookHash: 'h1', term: 'suerte', edits: [{ value: 'fate' }, { value: 'luck' }] }] };
    assert.equal(computeCaseAcceptanceVerdict('21d', pre, post, ctx), 'fail');
  });

  // SEMANTIC DEDUP: 2 entries same semantic key with same field value → PASS
  // (desktop writes own entry + pulls identical Android replica → 2 rows,
  // but they are semantically the same entity — expected merge behavior)
  it('21a passes when 2 desktop entries share same semantic key and same definition (semantic dedup)', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0, rows: [] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2, rows: [
        { id: 'desk-entry-1', term: 'abismo', language: 'es', definition: 'very deep chasm' },
        { id: 'android-d1', term: 'abismo', language: 'es', definition: 'very deep chasm' },
      ] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'abismo', language: 'es', definition: 'very deep chasm' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21a', bookHash: 'h1', term: 'abismo', language: 'es' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctx), 'pass');
  });

  it('21a fails when 2 desktop entries share same semantic key but have conflicting definitions', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0, rows: [] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2, rows: [
        { id: 'desk-entry-1', term: 'abismo', language: 'es', definition: 'profound void' },
        { id: 'android-d1', term: 'abismo', language: 'es', definition: 'very deep chasm' },
      ] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'abismo', language: 'es', definition: 'very deep chasm' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21a', bookHash: 'h1', term: 'abismo', language: 'es' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctx), 'fail');
  });

  it('21b passes when 2 annotations share same semantic key and same note (semantic dedup)', () => {
    const pre = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 0, rows: [] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 2, rows: [
        { id: 'desk-ann-1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'alternative interpretation' },
        { id: 'android-a1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'alternative interpretation' },
      ] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 1, rows: [
        { id: 'android-a1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'alternative interpretation' },
      ] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21b', bookHash: 'h1', cfi: '/6/4', text: 'selected' }] };
    assert.equal(computeCaseAcceptanceVerdict('21b', pre, post, ctx), 'pass');
  });

  it('21b fails when 2 annotations share same semantic key but have conflicting notes', () => {
    const pre = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 0, rows: [] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 2, rows: [
        { id: 'desk-ann-1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'revised analysis' },
        { id: 'android-a1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'alternative interpretation' },
      ] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 1, rows: [
        { id: 'android-a1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'alternative interpretation' },
      ] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21b', bookHash: 'h1', cfi: '/6/4', text: 'selected' }] };
    assert.equal(computeCaseAcceptanceVerdict('21b', pre, post, ctx), 'fail');
  });

  it('21d passes when 2 desktop entries share same semantic key and same definition (semantic dedup)', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0, rows: [] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2, rows: [
        { id: 'desk-entry-1', term: 'suerte', language: 'es', definition: 'fate' },
        { id: 'android-d1', term: 'suerte', language: 'es', definition: 'fate' },
      ] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'suerte', language: 'es', definition: 'fate' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21d', bookHash: 'h1', term: 'suerte', language: 'es', edits: [{ value: 'fate' }, { value: 'luck' }] }] };
    assert.equal(computeCaseAcceptanceVerdict('21d', pre, post, ctx), 'pass');
  });

  it('21a passes when desktop _replicas table has rows instead of app table (desktop replica naming)', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: '_replicas', rowCount: 0, rows: [] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: '_replicas', rowCount: 2, rows: [
        { replica_id: 'dictionary-entry:desk-entry-1', kind: 'dictionary-entry', fields_jsonb: JSON.stringify({ term: { v: 'abismo' }, language: { v: 'es' }, definition: { v: 'very deep chasm' } }), deleted_at_ts: null },
        { replica_id: 'dictionary-entry:android-d1', kind: 'dictionary-entry', fields_jsonb: JSON.stringify({ term: { v: 'abismo' }, language: { v: 'es' }, definition: { v: 'very deep chasm' } }), deleted_at_ts: null },
      ] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'abismo', language: 'es', definition: 'very deep chasm' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21a', bookHash: 'h1', term: 'abismo', language: 'es' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctx), 'pass');
  });

  it('21a fails when _replicas rows conflict (different definitions for same semantic key)', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: '_replicas', rowCount: 0, rows: [] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: '_replicas', rowCount: 2, rows: [
        { replica_id: 'dictionary-entry:desk-entry-1', kind: 'dictionary-entry', fields_jsonb: JSON.stringify({ term: { v: 'abismo' }, language: { v: 'es' }, definition: { v: 'profound void' } }), deleted_at_ts: null },
        { replica_id: 'dictionary-entry:android-d1', kind: 'dictionary-entry', fields_jsonb: JSON.stringify({ term: { v: 'abismo' }, language: { v: 'es' }, definition: { v: 'very deep chasm' } }), deleted_at_ts: null },
      ] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'abismo', language: 'es', definition: 'very deep chasm' }] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21a', bookHash: 'h1', term: 'abismo', language: 'es' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctx), 'fail');
  });

  it('21b passes when desktop _replicas table has annotation rows (desktop replica naming)', () => {
    const pre = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: '_replicas', rowCount: 0, rows: [] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: '_replicas', rowCount: 2, rows: [
        { replica_id: 'annotation:desk-ann-1', kind: 'annotation', fields_jsonb: JSON.stringify({ bookHash: { v: 'h1' }, cfi: { v: '/6/4' }, text: { v: 'selected' }, note: { v: 'alternative interpretation' } }), deleted_at_ts: null },
        { replica_id: 'annotation:android-a1', kind: 'annotation', fields_jsonb: JSON.stringify({ bookHash: { v: 'h1' }, cfi: { v: '/6/4' }, text: { v: 'selected' }, note: { v: 'alternative interpretation' } }), deleted_at_ts: null },
      ] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 1, rows: [
        { id: 'android-a1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'alternative interpretation' },
      ] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21b', bookHash: 'h1', cfi: '/6/4', text: 'selected' }] };
    assert.equal(computeCaseAcceptanceVerdict('21b', pre, post, ctx), 'pass');
  });

  it('21d passes when desktop state has both _replicas and app tables (merges without double-counting)', () => {
    // Desktop state with app table row + _replicas row for the same entity.
    // The app-table row should take precedence; _replicas should fill any
    // rows not already present in the app table.
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [
        { name: 'dictionary_entries', rowCount: 0, rows: [] },
        { name: '_replicas', rowCount: 0, rows: [] },
      ] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0, rows: [] } } },
    };
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [
        { name: 'dictionary_entries', rowCount: 1, rows: [
          { id: 'desk-entry-1', term: 'suerte', language: 'es', definition: 'fate' },
        ] },
        { name: '_replicas', rowCount: 2, rows: [
          { replica_id: 'dictionary-entry:desk-entry-1', kind: 'dictionary-entry', fields_jsonb: JSON.stringify({ term: { v: 'suerte' }, language: { v: 'es' }, definition: { v: 'fate' } }), deleted_at_ts: null },
          { replica_id: 'dictionary-entry:android-d1', kind: 'dictionary-entry', fields_jsonb: JSON.stringify({ term: { v: 'suerte' }, language: { v: 'es' }, definition: { v: 'fate' } }), deleted_at_ts: null },
        ] },
      ] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [
        { id: 'android-d1', term: 'suerte', language: 'es', definition: 'fate' },
      ] } } },
    };
    const ctx = { caseActions: [{ caseRef: '21d', bookHash: 'h1', term: 'suerte', language: 'es', edits: [{ value: 'fate' }, { value: 'luck' }] }] };
    assert.equal(computeCaseAcceptanceVerdict('21d', pre, post, ctx), 'pass');
  });

  // ── Semantic key language field regression guard ──────────────────────
  // setupCase21Ref actions MUST include language: 'es' so that
  // actionIdentityKey('dictionary-entry', action) produces a key that
  // matches the actual row keys (which always include language).
  // Without language: "term|" → mismatch with "term|es" → hasConflictingSemanticDuplicates
  // returns false (key mismatch hides conflict), and findEntityRow falls back
  // to a nondeterministic term-based search.
  it('21a semantic key with language matches rows for correct conflict detection', () => {
    const pre = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 0, rows: [] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 0, rows: [] } } },
    };
    // Two desktop entries with same term+language but CONFLICTING definitions.
    // With language in action, semantic key = "abismo|es" matches row keys.
    // hasConflictingSemanticDuplicates detects two rows with different definitions → fail.
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 2, rows: [
        { id: 'desk-1', term: 'abismo', language: 'es', definition: 'profound void' },
        { id: 'android-1', term: 'abismo', language: 'es', definition: 'very deep chasm' },
      ] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [
        { id: 'android-1', term: 'abismo', language: 'es', definition: 'very deep chasm' },
      ] } } },
    };
    const ctxWithLang = { caseActions: [{ caseRef: '21a', bookHash: 'h1', term: 'abismo', language: 'es' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctxWithLang), 'fail',
      'with language: conflicting duplicates detected because semantic key matches');

    // Without language: semantic key = "dictionary-entry:abismo|" ≠ row keys "dictionary-entry:abismo|es"
    // → hasConflictingSemanticDuplicates returns false (no match) → conflict undetected.
    // → findEntityRow falls back to term → picks first row (desk-1) = "profound void".
    // → only Android has "very deep chasm" → verdict is 'warn' instead of 'fail'.
    const ctxNoLang = { caseActions: [{ caseRef: '21a', bookHash: 'h1', term: 'abismo' }] };
    assert.equal(computeCaseAcceptanceVerdict('21a', pre, post, ctxNoLang), 'warn',
      'without language: semantic key mismatch hides real conflict → produces warn instead of fail');
  });

  it('dictionaryEntryIdentityKey language field produces correct semantic key', () => {
    // With language: key is well-formed and matches row keys
    assert.equal(dictionaryEntryIdentityKey({ term: 'abismo', language: 'es' }), 'dictionary-entry:abismo|es');
    // Without language: key lacks language portion → mismatch with rows that have language
    assert.equal(dictionaryEntryIdentityKey({ term: 'abismo' }), 'dictionary-entry:abismo|');
    // The keys do NOT match — this is the root cause of setupCase21Ref bug
    assert.notEqual(
      dictionaryEntryIdentityKey({ term: 'abismo' }),
      dictionaryEntryIdentityKey({ term: 'abismo', language: 'es' }),
    );
  });
});

describe('case-20 computeCaseAcceptanceVerdict', () => {
  const basePre = {
    desktop: {
      sqlite: {
        quotes: { available: true, tables: [{ name: 'quotes', rowCount: 0 }] },
        annotations: { available: true, tables: [{ name: 'annotations', rowCount: 0 }] },
      },
    },
    android: {
      replicas: {
        quote: { reachable: true, rowCount: 0 },
        annotation: { reachable: true, rowCount: 0 },
      },
    },
  };
  const basePost = {
    desktop: {
      sqlite: {
        quotes: { available: true, tables: [{ name: 'quotes', rowCount: 1 }] },
        annotations: { available: true, tables: [{ name: 'annotations', rowCount: 1 }] },
      },
    },
    android: {
      replicas: {
        quote: { reachable: true, rowCount: 1 },
        annotation: { reachable: true, rowCount: 1 },
      },
    },
  };
  const context = { caseActions: [{ caseRef: '20a', bookHash: 'h1', text: 'case20-quote-test' }] };

  it('20a passes when quote and annotation coexist on both sides', () => {
    assert.equal(computeCaseAcceptanceVerdict('20a', basePre, basePost, context), 'pass');
  });
  it('20a returns warn when android lacks annotation replica', () => {
    const noAnn = {
      ...basePost,
      android: { replicas: { quote: { reachable: true, rowCount: 1 }, annotation: { reachable: false, rowCount: 0 } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('20a', basePre, noAnn, context), 'warn');
  });
  it('20a returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('20a', basePre, basePost, {}), 'warn');
  });
  it('20a returns fail on duplicate quote rows', () => {
    const dupPost = {
      ...basePost,
      desktop: { sqlite: { quotes: { available: true, tables: [{ name: 'quotes', rowCount: 2 }] }, annotations: { available: true, tables: [{ name: 'annotations', rowCount: 1 }] } } },
    };
    assert.equal(computeCaseAcceptanceVerdict('20a', basePre, dupPost, context), 'fail');
  });
  it('20b passes when android-first flow converges', () => {
    const ctx = { caseActions: [{ caseRef: '20b', bookHash: 'h1', text: 'case20-quote-other' }] };
    assert.equal(computeCaseAcceptanceVerdict('20b', basePre, basePost, ctx), 'pass');
  });
});

describe('case-22 computeCaseAcceptanceVerdict — edit vs delete', () => {
  const basePre22 = {
    desktop: {
      sqlite: {
        dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1 }] },
        annotations: { available: true, tables: [{ name: 'annotations', rowCount: 1 }] },
      },
      bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn-d', type: 'dictionary', dictionaryEntryId: 'd1' }] },
    },
    android: {
      replicas: {
        'dictionary-entry': { reachable: true, rowCount: 1 },
        annotation: { reachable: true, rowCount: 1 },
      },
    },
  };

  // 22a: Dictionary delete-wins (delete HLC 12 > edit HLC 11)
  it('22a passes when entity is tombstoned on both sides (delete wins)', () => {
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'valle', definition: 'valley', deleted_at: 12000 }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'valle', definition: 'valley', deleted_at: 12000 }] },
        },
      },
    };
    const ctx = { caseActions: [case22Action()] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'pass');
  });

  it('22a passes when Android uses a paired semantic dictionary ID while duplicates remain forbidden', () => {
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'desk-d1', term: 'valle', definition: 'valley', deleted_at: 12000 }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'valle', definition: 'valley', deleted_at: 12000 }] } } },
    };
    const ctx = { caseActions: [case22Action({ entityId: 'desk-d1', term: 'valle' })] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'pass');
  });

  it('22a returns fail when semantic dictionary duplicates exist even if one row matches the expected state', () => {
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'desk-d1', term: 'valle', definition: 'valley', deleted_at: 12000 }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 2, rows: [
        { id: 'android-d1', term: 'valle', definition: 'valley', deleted_at: 12000 },
        { id: 'android-d2', term: 'valle', definition: 'valley', deleted_at: 12000 },
      ] } } },
    };
    const ctx = { caseActions: [case22Action({ entityId: 'desk-d1', term: 'valle' })] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'fail');
  });

  it('22a returns warn when entity state matches but HLC ordering evidence is missing', () => {
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'valle', definition: 'valley', deleted_at: 12000 }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'valle', definition: 'valley', deleted_at: 12000 }] },
        },
      },
    };
    const ctx = { caseActions: [case22Action({ deleteHLC: undefined, editHLC: undefined })] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'warn');
  });

  it('22a passes when entity is live with edit value (edit wins)', () => {
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'valle', definition: 'gorge', deleted_at: null }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'valle', definition: 'gorge', deleted_at: null }] },
        },
      },
    };
    const ctx = { caseActions: [case22Action({ deleteHLC: 10, editHLC: 14, deleteWins: false })] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'pass');
  });

  it('22a returns fail when edit value visible despite delete HLC > edit HLC', () => {
    const post = {
      desktop: {
        sqlite: {
          dictionary: {
            available: true,
            tables: [{
              name: 'dictionary_entries',
              rowCount: 1,
              rows: [{ id: 'd1', term: 'valle', definition: 'gorge', deleted_at: null }],
            }],
          },
        },
      },
      android: {
        replicas: {
          'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'd1', term: 'valle', definition: 'gorge', deleted_at: null }] },
        },
      },
    };
    const ctx = { caseActions: [case22Action()] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'fail');
  });

  it('22a returns warn when no caseAction found', () => {
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, basePre22, {}), 'warn');
  });

  // 22b: BLOCKED — always returns 'warn'
  it('22b returns blocked because quotes are immutable', () => {
    assert.equal(computeCaseAcceptanceVerdict('22b', {}, {}, {}), 'blocked');
  });

  // 22c: Annotation delete-wins
  it('22c passes when annotation is tombstoned (delete wins)', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'n1', text: 'selected', note: 'original', deleted_at: 15000 }],
            }],
          },
        },
      },
      android: {
        replicas: {
          annotation: { reachable: true, rowCount: 1, rows: [{ id: 'n1', text: 'selected', note: 'original', deleted_at: 15000 }] },
        },
      },
    };
    const ctx = {
      caseActions: [case22Action({ caseRef: '22c', entityType: 'annotation', entityId: 'n1', deleteHLC: 15, editHLC: 14 })],
    };
    assert.equal(computeCaseAcceptanceVerdict('22c', basePre22, post, ctx), 'pass');
  });

  it('22c passes when Android uses a paired semantic annotation ID while duplicates remain forbidden', () => {
    const post = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 1, rows: [{ id: 'desk-n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'original', deleted_at: 15000 }] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 1, rows: [{ id: 'android-n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'original', deleted_at: 15000 }] } } },
    };
    const ctx = {
      caseActions: [case22Action({ caseRef: '22c', entityType: 'annotation', entityId: 'desk-n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', deleteHLC: 15, editHLC: 14 })],
    };
    assert.equal(computeCaseAcceptanceVerdict('22c', basePre22, post, ctx), 'pass');
  });

  it('22c returns fail when semantic annotation duplicates exist even if one row matches the expected state', () => {
    const post = {
      desktop: { sqlite: { annotations: { available: true, tables: [{ name: 'annotations', rowCount: 1, rows: [{ id: 'desk-n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'original', deleted_at: 15000 }] }] } } },
      android: { replicas: { annotation: { reachable: true, rowCount: 2, rows: [
        { id: 'android-n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'original', deleted_at: 15000 },
        { id: 'android-n2', bookHash: 'h1', cfi: '/6/4', text: 'selected', note: 'original', deleted_at: 15000 },
      ] } } },
    };
    const ctx = {
      caseActions: [case22Action({ caseRef: '22c', entityType: 'annotation', entityId: 'desk-n1', bookHash: 'h1', cfi: '/6/4', text: 'selected', deleteHLC: 15, editHLC: 14 })],
    };
    assert.equal(computeCaseAcceptanceVerdict('22c', basePre22, post, ctx), 'fail');
  });

  it('22c returns warn when tombstone state is plausible but delete/edit HLCs are absent', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'n1', text: 'selected', note: 'original', deleted_at: 15000 }],
            }],
          },
        },
      },
      android: {
        replicas: {
          annotation: { reachable: true, rowCount: 1, rows: [{ id: 'n1', text: 'selected', note: 'original', deleted_at: 15000 }] },
        },
      },
    };
    const ctx = {
      caseActions: [case22Action({ caseRef: '22c', entityType: 'annotation', entityId: 'n1', deleteHLC: undefined, editHLC: undefined })],
    };
    assert.equal(computeCaseAcceptanceVerdict('22c', basePre22, post, ctx), 'warn');
  });

  it('22c passes when annotation is live with edit value (edit wins)', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'n1', text: 'selected', note: 'updated', deleted_at: null }],
            }],
          },
        },
      },
      android: {
        replicas: {
          annotation: { reachable: true, rowCount: 1, rows: [{ id: 'n1', text: 'selected', note: 'updated', deleted_at: null }] },
        },
      },
    };
    const ctx = {
      caseActions: [case22Action({ caseRef: '22c', entityType: 'annotation', entityId: 'n1', deleteHLC: 10, editHLC: 14, deleteWins: false })],
    };
    assert.equal(computeCaseAcceptanceVerdict('22c', basePre22, post, ctx), 'pass');
  });

  it('22c returns fail when edit value visible despite delete winning HLC', () => {
    const post = {
      desktop: {
        sqlite: {
          annotations: {
            available: true,
            tables: [{
              name: 'annotations',
              rowCount: 1,
              rows: [{ id: 'n1', text: 'selected', note: 'updated', deleted_at: null }],
            }],
          },
        },
      },
      android: {
        replicas: {
          annotation: { reachable: true, rowCount: 1, rows: [{ id: 'n1', text: 'selected', note: 'updated', deleted_at: null }] },
        },
      },
    };
    const ctx = {
      caseActions: [case22Action({ caseRef: '22c', entityType: 'annotation', entityId: 'n1', deleteHLC: 15, editHLC: 14 })],
    };
    assert.equal(computeCaseAcceptanceVerdict('22c', basePre22, post, ctx), 'fail');
  });

  it('22c returns warn when no caseAction', () => {
    assert.equal(computeCaseAcceptanceVerdict('22c', basePre22, basePre22, {}), 'warn');
  });

  // PC-3: tombstone-count fallback — divergent replica_ids, matching tombstone
  // state via semantic-key-based count instead of exact entityId match.
  it('22a passes when replica_ids diverge but both sides have tombstoned entries with same semantic key', () => {
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'desk-d1', term: 'valle', definition: 'valley', deleted_at: 12000 }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'valle', definition: 'valley', deleted_at: 12000 }] } } },
    };
    // entityId matches desktop only; tombstone-count fallback catches android
    const ctx = { caseActions: [case22Action({ entityId: 'desk-d1', term: 'valle', deleteHLC: 12, editHLC: 11 })] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'pass');
  });

  // PC-3: tombstone-count fallback when entity not found by id on either side
  // but tombstoned rows exist matching the semantic key.
  it('22a passes when entityId is absent but tombstoned rows exist on both sides by semantic key', () => {
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'desk-d1', term: 'valle', definition: 'valley', deleted_at: 12000 }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ id: 'android-d1', term: 'valle', definition: 'valley', deleted_at: 12000 }] } } },
    };
    // entityId omitted — only term for semantic lookup
    const ctx = { caseActions: [case22Action({ entityId: undefined, term: 'valle', deleteHLC: 12, editHLC: 11 })] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'pass');
  });

  // PC-3: Android replica rows arrive from the API with nested fields_jsonb
  // envelope format. flattenAndroidRow must extract .v values so identity keys,
  // entityRowState, and direct field access (row.definition, row.term) all work.
  // Real Android /replicas/:kind API returns rows with fields_jsonb envelope.
  // After flattenAndroidRow, identity keys (term|language), entityRowState
  // (deleted_at_ts → tombstone), and direct field access all work.
  it('22a passes when Android rows use fields_jsonb envelope format with tombstoned entries', () => {
    const post = {
      desktop: { sqlite: { dictionary: { available: true, tables: [{ name: 'dictionary_entries', rowCount: 1, rows: [{ id: 'desk-d1', term: 'valle', language: 'es', definition: 'valley', deleted_at: 12000 }] }] } } },
      android: { replicas: { 'dictionary-entry': { reachable: true, rowCount: 1, rows: [{ replica_id: 'dictionary-entry:android-d1', fields_jsonb: { term: { v: 'valle' }, language: { v: 'es' }, definition: { v: 'valley' } }, deleted_at_ts: '0019f25f448a0-0000000c' }] } } },
    };
    const ctx = { caseActions: [case22Action({ entityId: 'desk-d1', term: 'valle', language: 'es', deleteHLC: 12, editHLC: 11 })] };
    assert.equal(computeCaseAcceptanceVerdict('22a', basePre22, post, ctx), 'pass');
  });
});

describe('case-25 computeCaseAcceptanceVerdict — highlight group mutation (DISCOVER)', () => {
  const pre25 = {
    desktop: phase4BookConfigState([{ id: 'bn1', type: 'annotation', annotationId: 'n1', cfi: '/6/4' }]),
    android: phase4BookConfigState([{ id: 'bn1', type: 'annotation', annotationId: 'n1', cfi: '/6/4' }]),
  };

  it('returns blocked because case 25 is not applicable', () => {
    const post = {
      desktop: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'annotation', annotationId: 'n1', cfi: '/6/4' }] },
      },
      android: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'annotation', annotationId: 'n1', cfi: '/6/4' }] },
      },
    };
    // Case 25/26 are NOT APPLICABLE — UI does not allow cross-kind highlight mutation
    // or invalid cross-entity refs. User decision 2026-07-14.
    assert.equal(computeCaseAcceptanceVerdict('25', pre25, post), 'blocked');
  });

  it('returns blocked when type drift attempted (not applicable)', () => {
    const post = {
      desktop: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'quote', annotationId: 'n1', cfi: '/6/4' }] },
      },
      android: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'annotation', annotationId: 'n1', cfi: '/6/4' }] },
      },
    };
    const ctx = { caseActions: [{ caseRef: '25', bookHash: 'h1', noteId: 'bn1', originalType: 'annotation' }] };
    assert.equal(computeCaseAcceptanceVerdict('25', pre25, post, ctx), 'blocked');
  });

  it('returns blocked for any 25 scenario (not applicable)', () => {
    const post = {
      desktop: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'annotation', annotationId: 'n1', cfi: '/6/4' }] },
      },
      android: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'dictionary', annotationId: 'n1', cfi: '/6/4' }] },
      },
    };
    const ctx = { caseActions: [{ caseRef: '25', bookHash: 'h1', noteId: 'bn1', originalType: 'annotation' }] };
    assert.equal(computeCaseAcceptanceVerdict('25', pre25, post, ctx), 'blocked');
  });

  it('returns blocked without caseAction (not applicable)', () => {
    assert.equal(computeCaseAcceptanceVerdict('25', pre25, pre25, {}), 'blocked');
  });

  it('returns blocked with missing bookConfig (not applicable)', () => {
    const post = {
      desktop: {},
      android: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'annotation', annotationId: 'n1' }] },
      },
    };
    const ctx = { caseActions: [{ caseRef: '25', bookHash: 'h1', noteId: 'bn1', originalType: 'annotation' }] };
    assert.equal(computeCaseAcceptanceVerdict('25', pre25, post, ctx), 'blocked');
  });
});

describe('case-26 computeCaseAcceptanceVerdict — NOT APPLICABLE (user decision 2026-07-14)', () => {
  const pre26 = {
    desktop: phase4BookConfigState([{ id: 'bn1', type: 'dictionary', dictionaryEntryId: 'd1', cfi: '/6/4' }]),
    android: phase4BookConfigState([{ id: 'bn1', type: 'dictionary', dictionaryEntryId: 'd1', cfi: '/6/4' }]),
  };

  it('returns blocked (not applicable)', () => {
    const post = {
      desktop: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'dictionary', dictionaryEntryId: 'd1', cfi: '/6/4' }] },
      },
      android: {
        bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'dictionary', dictionaryEntryId: 'd1', cfi: '/6/4' }] },
      },
    };
    const ctx = {
      caseActions: [{
        caseRef: '26', bookHash: 'h1', noteId: 'bn1', expectedType: 'dictionary', expectedEntityId: 'd1',
        crossTypeDetected: true,
      }],
    };
    assert.equal(computeCaseAcceptanceVerdict('26', pre26, post, ctx), 'blocked');
  });

  it('returns blocked for any 26 scenario (not applicable)', () => {
    const badConfig = {
      status: 'pass', booknoteCount: 1,
      booknotes: [{ id: 'bn1', type: 'dictionary', citeId: 'quote-entity', cfi: '/6/4' }],
    };
    const post = {
      desktop: { bookConfig: badConfig },
      android: { bookConfig: badConfig },
    };
    const ctx = {
      caseActions: [{ caseRef: '26', bookHash: 'h1', noteId: 'bn1', expectedType: 'dictionary', expectedEntityId: 'd1', crossTypeDetected: false }],
    };
    assert.equal(computeCaseAcceptanceVerdict('26', pre26, post, ctx), 'blocked');
  });

  it('returns blocked without caseAction (not applicable)', () => {
    assert.equal(computeCaseAcceptanceVerdict('26', pre26, pre26, {}), 'blocked');
  });

  it('returns blocked with missing bookConfig (not applicable)', () => {
    const post = {
      desktop: { bookConfig: { status: 'pass', booknoteCount: 1, booknotes: [{ id: 'bn1', type: 'dictionary', dictionaryEntryId: 'd1' }] } },
      android: {},
    };
    const ctx = {
      caseActions: [{ caseRef: '26', bookHash: 'h1', noteId: 'bn1', expectedType: 'dictionary', expectedEntityId: 'd1', crossTypeDetected: true }],
    };
    assert.equal(computeCaseAcceptanceVerdict('26', pre26, post, ctx), 'blocked');
  });
});

describe('assertBookNoteIntegrity', () => {
  const dictConfig = {
    status: 'pass',
    booknoteCount: 1,
    booknotes: [{ id: 'bn1', type: 'dictionary', dictionaryEntryId: 'dict-1', cfi: '/6/4' }],
  };
  const quoteConfig = {
    status: 'pass',
    booknoteCount: 1,
    booknotes: [{ id: 'bn2', type: 'quote', citeId: 'quote-1', cfi: '/6/4' }],
  };
  const annConfig = {
    status: 'pass',
    booknoteCount: 1,
    booknotes: [{ id: 'bn3', type: 'annotation', annotationId: 'ann-1', cfi: '/6/4' }],
  };

  it('passes when dictionary BookNote has correct type and dictionaryEntryId', () => {
    const result = assertBookNoteIntegrity('book-h1', 'bn1', 'dictionary', 'dict-1', dictConfig);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('passes when quote BookNote has correct type and citeId', () => {
    const result = assertBookNoteIntegrity('book-h1', 'bn2', 'quote', 'quote-1', quoteConfig);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('passes when annotation BookNote has correct type and annotationId', () => {
    const result = assertBookNoteIntegrity('book-h1', 'bn3', 'annotation', 'ann-1', annConfig);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when noteId not found in config', () => {
    const result = assertBookNoteIntegrity('book-h1', 'nonexistent', 'dictionary', 'dict-1', dictConfig);
    assert.equal(result.verdict, 'FAIL');
    assert.ok(result.failures.length > 0);
    assert.equal(result.failures[0].invariant, 'booknote-not-found');
  });

  it('fails when type does not match expected', () => {
    const result = assertBookNoteIntegrity('book-h1', 'bn1', 'quote', 'dict-1', dictConfig);
    assert.equal(result.verdict, 'FAIL');
    assert.ok(result.failures.length > 0);
    assert.equal(result.failures[0].invariant, 'booknote-type-mismatch');
  });

  it('fails when pointer field does not match type (cross-type pointer)', () => {
    const invalidConfig = {
      status: 'pass',
      booknoteCount: 1,
      booknotes: [{ id: 'bn-bad', type: 'dictionary', citeId: 'quote-entity', cfi: '/6/4' }],
    };
    const result = assertBookNoteIntegrity('book-h1', 'bn-bad', 'dictionary', 'quote-entity', invalidConfig);
    assert.equal(result.verdict, 'FAIL');
    assert.ok(result.failures.length > 0);
    assert.equal(result.failures[0].invariant, 'booknote-pointer-mismatch');
  });

  it('fails when expected pointer value differs', () => {
    const result = assertBookNoteIntegrity('book-h1', 'bn1', 'dictionary', 'wrong-entity-id', dictConfig);
    assert.equal(result.verdict, 'FAIL');
    assert.ok(result.failures.length > 0);
    assert.equal(result.failures[0].invariant, 'booknote-pointer-mismatch');
  });

  it('returns fail when config is null or has no booknotes', () => {
    const result = assertBookNoteIntegrity('book-h1', 'bn1', 'dictionary', 'dict-1', null);
    assert.equal(result.verdict, 'FAIL');
    assert.ok(result.failures.length > 0);

    const emptyResult = assertBookNoteIntegrity('book-h1', 'bn1', 'dictionary', 'dict-1', { status: 'pass', booknoteCount: 0, booknotes: [] });
    assert.equal(emptyResult.verdict, 'FAIL');
  });
});

describe('assertBookNoteType', () => {
  const config = {
    status: 'pass',
    booknoteCount: 1,
    booknotes: [{ id: 'bn1', type: 'dictionary', dictionaryEntryId: 'dict-1', cfi: '/6/4' }],
  };

  it('passes when type matches expected', () => {
    const result = assertBookNoteType('book-h1', 'bn1', 'dictionary', config);
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when type drift detected', () => {
    const result = assertBookNoteType('book-h1', 'bn1', 'quote', config);
    assert.equal(result.verdict, 'FAIL');
    assert.ok(result.failures.length > 0);
    assert.equal(result.failures[0].invariant, 'booknote-type-mismatch');
  });

  it('fails when noteId not found', () => {
    const result = assertBookNoteType('book-h1', 'nonexistent', 'dictionary', config);
    assert.equal(result.verdict, 'FAIL');
    assert.ok(result.failures.length > 0);
    assert.equal(result.failures[0].invariant, 'booknote-not-found');
  });

  it('returns fail when config is null', () => {
    const result = assertBookNoteType('book-h1', 'bn1', 'dictionary', null);
    assert.equal(result.verdict, 'FAIL');
  });
});

describe('setupCase25Ref — annotation fixture uses real annId', () => {
  it('uses real annId from --note fixture result for noteId', async () => {
    const mockSpawnFixture = (stateEnv, args) => {
      // First call: --note creates annotation, returns real annId
      if (args.includes('--note')) {
        return { ok: true, annId: 'ann-real-1', text: 'original' };
      }
      // Second call: --booknote-mutate
      return { ok: true };
    };
    const mockSpawnStateJson = () => ({ status: 'pass' });
    const mockEnsurePhase2LiveBook = async () => ({ ok: true, bookHash: 'book-h1' });

    const result = await setupCase25Ref('25', {}, { android: { serverUrl: 'http://android' } }, 'run-1', 1000, {
      spawnFixture: mockSpawnFixture,
      spawnStateJson: mockSpawnStateJson,
      ensurePhase2LiveBook: mockEnsurePhase2LiveBook,
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.noteId,
      'ann-real-1',
      'noteId must be the real annId from --note fixture, not a fabricated string',
    );
    assert.equal(result.action, 'case25-discover-mutate');
  });

  it('fails gracefully when --note fixture returns error', async () => {
    const mockSpawnFixture = () => ({ ok: false, error: 'simulated failure' });
    const mockSpawnStateJson = () => ({ status: 'pass' });
    const mockEnsurePhase2LiveBook = async () => ({ ok: true, bookHash: 'book-h1' });

    const result = await setupCase25Ref('25', {}, {}, 'run-1', 1000, {
      spawnFixture: mockSpawnFixture,
      spawnStateJson: mockSpawnStateJson,
      ensurePhase2LiveBook: mockEnsurePhase2LiveBook,
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, 'case25-desk-note');
  });

  it('fails explicitly when Android BookNote mutation does not touch the target noteId', async () => {
    let callIndex = 0;
    const mockSpawnFixture = (stateEnv, args) => {
      callIndex++;
      if (callIndex === 1) {
        assert.ok(args.includes('--note'));
        return { ok: true, annId: 'ann-real-1', text: 'original' };
      }
      assert.ok(args.includes('--booknote-mutate'));
      return { ok: false, action: 'booknote-mutate-missing-note', error: 'BookNote ann-real-1 not found in config' };
    };
    const mockSpawnStateJson = () => ({ status: 'pass' });
    const mockEnsurePhase2LiveBook = async () => ({ ok: true, bookHash: 'book-h1' });

    const result = await setupCase25Ref('25', {}, { android: { serverUrl: 'http://android' } }, 'run-1', 1000, {
      spawnFixture: mockSpawnFixture,
      spawnStateJson: mockSpawnStateJson,
      ensurePhase2LiveBook: mockEnsurePhase2LiveBook,
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, 'case25-and-mutate');
    assert.match(result.error, /ann-real-1/);
  });
});

describe('setupCase26Ref — dictionary fixture uses real entryId', () => {
  it('uses real entryId from --dict fixture result for noteId', async () => {
    let callIndex = 0;
    const mockSpawnFixture = (stateEnv, args) => {
      callIndex++;
      // First call: --dict creates dictionary entry, returns entryId
      if (callIndex === 1) {
        return { ok: true, entryId: 'entry-real-1', term: 'case26-term-run-1' };
      }
      // Second call: --quote creates a quote entity
      if (callIndex === 2) {
        return { ok: true, quoteId: 'quote-1' };
      }
      // Third call: --booknote-invalid-ref
      return { ok: true };
    };
    const mockSpawnStateJson = () => ({ status: 'pass' });
    const mockEnsurePhase2LiveBook = async () => ({ ok: true, bookHash: 'book-h1' });

    const result = await setupCase26Ref('26', {}, { android: { serverUrl: 'http://android' } }, 'run-1', 1000, {
      spawnFixture: mockSpawnFixture,
      spawnStateJson: mockSpawnStateJson,
      ensurePhase2LiveBook: mockEnsurePhase2LiveBook,
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.noteId,
      'entry-real-1',
      'noteId must be the real entryId from --dict fixture, not a fabricated string',
    );
    assert.equal(result.action, 'case26-discover-invalid-ref');
  });

  it('fails gracefully when --dict fixture returns error', async () => {
    const mockSpawnFixture = () => ({ ok: false, error: 'simulated failure' });
    const mockSpawnStateJson = () => ({ status: 'pass' });
    const mockEnsurePhase2LiveBook = async () => ({ ok: true, bookHash: 'book-h1' });

    const result = await setupCase26Ref('26', {}, {}, 'run-1', 1000, {
      spawnFixture: mockSpawnFixture,
      spawnStateJson: mockSpawnStateJson,
      ensurePhase2LiveBook: mockEnsurePhase2LiveBook,
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, 'case26-desk-dict');
  });

  it('fails explicitly when Android invalid-ref mutation does not touch the target noteId', async () => {
    let callIndex = 0;
    const mockSpawnFixture = (stateEnv, args) => {
      callIndex++;
      if (callIndex === 1) {
        assert.ok(args.includes('--dict'));
        return { ok: true, entryId: 'entry-real-1', term: 'case26-term-run-1' };
      }
      if (callIndex === 2) {
        assert.ok(args.includes('--quote'));
        return { ok: true, quoteId: 'quote-1' };
      }
      assert.ok(args.includes('--booknote-invalid-ref'));
      return { ok: false, action: 'booknote-invalid-ref-missing-note', error: 'BookNote entry-real-1 not found in config' };
    };
    const mockSpawnStateJson = () => ({ status: 'pass' });
    const mockEnsurePhase2LiveBook = async () => ({ ok: true, bookHash: 'book-h1' });

    const result = await setupCase26Ref('26', {}, { android: { serverUrl: 'http://android' } }, 'run-1', 1000, {
      spawnFixture: mockSpawnFixture,
      spawnStateJson: mockSpawnStateJson,
      ensurePhase2LiveBook: mockEnsurePhase2LiveBook,
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, 'case26-and-invalid-ref');
    assert.match(result.error, /entry-real-1/);
  });
});

describe('env-var propagation to child processes', () => {
  it('propagates BIBLIOTECA_DEV_SYNC_HARNESS=1 to state-snapshot child processes via buildStateJsonSpawnOptions', () => {
    const options = buildStateJsonSpawnOptions({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: '/tmp/dev-sync-desktop' });
    assert.equal(options.env.BIBLIOTECA_DEV_SYNC_HARNESS, '1', 'env must include BIBLIOTECA_DEV_SYNC_HARNESS=1');
    assert.equal(options.encoding, 'utf8');
    assert.equal(options.stdio, 'pipe');
  });
});

describe('pre-cycle state cleanup before bounded rerun', () => {
  it('runs desktop clean via ensurePreCycleCleanup when --clean-before is requested', async () => {
    const calls = [];
    const result = await ensurePreCycleCleanup(
      { BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: '/tmp/dev-sync-desktop' },
      { android: { serverUrl: 'http://android.test' } },
      {
        spawnClean: (_stateEnv) => { calls.push('desktop-clean'); return { ok: true, verification: 'verification' }; },
        spawnAndroidClean: async (_stateEnv, _env) => { calls.push('android-clean'); return { ok: true, restarted: true }; },
      },
    );
    assert.equal(result.ok, true);
    assert.ok(result.desktopClean, 'desktop clean must have been performed');
    assert.ok(result.androidClean, 'android clean must have been performed');
    assert.deepEqual(calls, ['desktop-clean', 'android-clean']);
  });

  it('reports partial failure when desktop clean fails but android clean succeeds', async () => {
    const result = await ensurePreCycleCleanup(
      { BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: '/tmp/dev-sync-desktop' },
      { android: { serverUrl: 'http://android.test' } },
      {
        spawnClean: () => ({ ok: false, error: 'desktop clean failed' }),
        spawnAndroidClean: async () => ({ ok: true, restarted: true }),
      },
    );
    assert.equal(result.ok, false);
    assert.ok(result.desktopClean && !result.desktopClean.ok, 'desktop clean must have failed');
    assert.ok(result.androidClean && result.androidClean.ok, 'android clean must have succeeded');
  });

  it('includes --clean-before in repeat child args so each bounded rerun resets accumulated replicas', () => {
    const childArgs = buildRepeatChildArgs(
      ['node', 'dev-sync-cycle.mjs', '--repeat', '1', '--case-ref', '21a,21b'],
      '21a',
    );
    assert.ok(childArgs.includes('--clean-before'), 'repeat child args must include --clean-before');
    assert.ok(!childArgs.includes('--repeat'), 'repeat flag must be stripped');
    assert.ok(childArgs.includes('21a'), 'child case ref must be set');
  });
});
