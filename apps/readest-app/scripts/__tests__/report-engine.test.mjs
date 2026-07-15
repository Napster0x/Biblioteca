#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSyncReport } from '../report-engine.mjs';

describe('report-engine Phase 3 evidence gate', () => {
  it('does not emit PASS when required Phase 3 evidence is unavailable', () => {
    const report = buildSyncReport({
      assertions: { verdict: 'PASS', failures: [] },
      evidence: {
        phase: 'phase3',
        required: ['desktop.library', 'android.bookIndex', 'android.bookConfig.booknotes'],
        available: ['desktop.library'],
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.verdict, 'AMBIGUOUS');
    assert.deepEqual(report.unavailableEvidence, ['android.bookIndex', 'android.bookConfig.booknotes']);
    assert.match(report.diagnosis, /unavailable evidence prevents a safe PASS/);
  });

  it('keeps PASS when all required Phase 3 evidence is available', () => {
    const report = buildSyncReport({
      assertions: { verdict: 'PASS', failures: [] },
      evidence: {
        phase: 'phase3',
        required: ['desktop.library', 'android.bookIndex'],
        available: ['desktop.library', 'android.bookIndex'],
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.verdict, 'PASS');
    assert.deepEqual(report.unavailableEvidence, []);
  });

  it('treats WARN as a non-success Phase 3 report outcome', () => {
    const report = buildSyncReport({
      assertions: { verdict: 'WARN', failures: [] },
      evidence: {
        phase: 'phase3',
        required: ['desktop.library'],
        available: ['desktop.library'],
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.verdict, 'WARN');
    assert.deepEqual(report.unavailableEvidence, []);
    assert.match(report.diagnosis, /WARN: unavailable evidence limits confidence/);
  });
});
