#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  assertPhase2Preflight,
  runPhase2Preflight,
} from '../sync-phase2-preflight.mjs';

describe('Phase 2 preflight enforcement', () => {
  it('allows case actions only when the doctor emits a PASS phase2.preflight gate', () => {
    const payload = {
      checks: [
        {
          name: 'phase2.preflight',
          status: 'pass',
          message: 'Phase 2 preflight passed; case execution may start',
          requiredChecks: ['android.package', 'android.process'],
          failures: [],
        },
      ],
    };

    assert.deepEqual(assertPhase2Preflight(payload), payload.checks[0]);
  });

  it('blocks case actions when phase2.preflight is fail or absent', () => {
    assert.throws(
      () => assertPhase2Preflight({ checks: [{ name: 'phase2.preflight', status: 'fail', message: 'blocked', failures: [] }] }),
      /Phase 2 preflight blocked: blocked/,
    );

    assert.throws(
      () => assertPhase2Preflight({ checks: [{ name: 'android.process', status: 'pass' }] }),
      /Phase 2 preflight blocked: phase2.preflight did not run/,
    );
  });

  it('parses doctor JSON from a failing doctor process before blocking execution', () => {
    const doctorError = new Error('doctor failed');
    doctorError.stdout = JSON.stringify({
      checks: [
        {
          name: 'phase2.preflight',
          status: 'fail',
          message: 'Phase 2 preflight blocked; fix readiness checks before case execution',
          failures: [{ name: 'android.process', status: 'fail', failureClass: 'app-process-absent' }],
        },
      ],
    });

    assert.throws(
      () => runPhase2Preflight({ runDoctor: () => { throw doctorError; } }),
      /android\.process:fail:app-process-absent/,
    );
  });
});
