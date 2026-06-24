function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function flattenEvidencePaths(evidence = {}) {
  return [
    ...asArray(evidence.snapshots),
    ...asArray(evidence.operations),
    ...asArray(evidence.triggers),
    ...asArray(evidence.assertions),
    ...asArray(evidence.cleanup),
  ].filter(Boolean);
}

function firstFailure(assertions = {}) {
  return asArray(assertions.failures)[0] ?? null;
}

function buildDiagnosis({ verdict, assertions, unavailableEvidence }) {
  const failure = firstFailure(assertions);
  if (verdict === 'PASS') return 'PASS: semantic convergence verified across available evidence.';
  if (verdict === 'WARN') return `WARN: unavailable evidence limits confidence (${unavailableEvidence.join(', ') || 'none listed'}).`;
  if (verdict === 'AMBIGUOUS') return `AMBIGUOUS: unavailable evidence prevents a safe PASS (${unavailableEvidence.join(', ') || 'none listed'}).`;
  if (!failure) return 'FAIL: semantic divergence detected.';

  const equalCounts = assertions.counts && assertions.counts.desktop === assertions.counts.android ? ' despite equal counts' : '';
  return `FAIL: ${failure.entity ?? 'entity'} ${failure.logicalKey ?? ''} violates ${failure.invariant ?? 'semantic invariant'}${equalCounts}.`;
}

export function buildSyncReport({ assertions = {}, evidence = {}, unavailableEvidence = [], cleanup = null } = {}) {
  const verdict = assertions.verdict ?? (unavailableEvidence.length > 0 ? 'AMBIGUOUS' : 'PASS');
  const failure = firstFailure(assertions);
  const normalizedUnavailable = [...new Set([...unavailableEvidence, ...asArray(evidence.unavailable)])];

  return {
    ok: verdict === 'PASS' || verdict === 'WARN',
    verdict,
    diagnosis: buildDiagnosis({ verdict, assertions, unavailableEvidence: normalizedUnavailable }),
    probableDomain: failure?.probableDomain,
    evidencePaths: flattenEvidencePaths(evidence),
    unavailableEvidence: normalizedUnavailable,
    cleanupOutcome: cleanup ?? { status: 'not-run' },
    failures: asArray(assertions.failures),
  };
}
