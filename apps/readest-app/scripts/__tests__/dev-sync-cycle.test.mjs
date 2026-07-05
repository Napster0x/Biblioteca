#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertBookCount,
  assertMetadata,
} from '../assert-engine.mjs';

import {
  classifyReliabilityFailure,
  computeCaseAcceptanceVerdict,
  computeReliabilityReport,
  ensurePhase2LiveBook,
  runRepeat,
} from '../dev-sync-cycle.mjs';

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
    }), 'environment');

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
