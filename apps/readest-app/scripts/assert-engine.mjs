/**
 * Dev sync assert engine — snapshot comparison functions.
 *
 * Compares pre-state and post-state desktop snapshots
 * (from dev-sync-state.mjs captureDesktopState output) and
 * emits PASS/FAIL verdict with diff details.
 */

/**
 * Compare two desktop state snapshots and return a verdict.
 *
 * Comparison checks:
 * - db.presentCount: number of DB files present
 * - library.summary.count: number of books in library.json
 * - books.dirCount: number of book directories
 * - settings.exists: boolean
 *
 * @param {object} pre - Pre-state snapshot (desktop portion)
 * @param {object} post - Post-state snapshot (desktop portion)
 * @param {object} [expectDelta] - Optional expected deltas {library, books, db}
 * @returns {{verdict: 'PASS'|'FAIL', failures: Array<{field, pre, post}>}}
 */
export function compareSnapshots(pre, post, expectDelta) {
  const failures = [];

  // DB count
  const dbPre = pre.db?.presentCount ?? 0;
  const dbPost = post.db?.presentCount ?? 0;
  const dbDelta = expectDelta?.db ?? 0;
  if (dbPost !== dbPre + dbDelta) {
    failures.push({
      field: 'db.presentCount',
      pre: dbPre,
      post: dbPost,
      expectedDelta: dbDelta,
    });
  }

  // Library count
  const libPreCount = pre.library?.summary?.count ?? 0;
  const libPostCount = post.library?.summary?.count ?? 0;
  const libDelta = expectDelta?.library ?? 0;
  if (libPostCount !== libPreCount + libDelta) {
    failures.push({
      field: 'library.summary.count',
      pre: libPreCount,
      post: libPostCount,
      expectedDelta: libDelta,
    });
  }

  // Books dir count
  const booksPre = pre.books?.dirCount ?? 0;
  const booksPost = post.books?.dirCount ?? 0;
  const booksDelta = expectDelta?.books ?? 0;
  if (booksPost !== booksPre + booksDelta) {
    failures.push({
      field: 'books.dirCount',
      pre: booksPre,
      post: booksPost,
      expectedDelta: booksDelta,
    });
  }

  // Settings exists
  const settingsPre = pre.settings?.exists ?? false;
  const settingsPost = post.settings?.exists ?? false;
  if (settingsPost !== settingsPre) {
    failures.push({
      field: 'settings.exists',
      pre: settingsPre,
      post: settingsPost,
    });
  }

  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}

const ENTITY_CONFIG = [
  { key: 'dictionaryOccurrences', entity: 'dictionary-occurrence' },
  { key: 'quotes', entity: 'quote' },
  { key: 'annotations', entity: 'annotation' },
];

function rowsFor(state, key) {
  return Array.isArray(state?.[key]) ? state[key] : [];
}

function logicalKey(row) {
  return row.logicalKey ?? [row.bookHash, row.cfi, row.term ?? row.text ?? row.selectedText].filter(Boolean).join(':');
}

function isDeleted(row) {
  return row.deleted === true || row.deletedAt !== null && row.deletedAt !== undefined || row.deleted_at !== null && row.deleted_at !== undefined;
}

function compareHlc(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function duplicateFailures(rows, entity) {
  const counts = new Map();
  for (const row of rows) {
    const key = logicalKey(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({
      invariant: 'no-duplicate-logical-rows',
      entity,
      logicalKey: key,
      count,
      probableDomain: 'merge/idempotence',
    }));
}

function convergenceFailures(desktopRows, androidRows, entity) {
  const desktopKeys = new Set(desktopRows.map(logicalKey).filter(Boolean));
  const androidKeys = new Set(androidRows.map(logicalKey).filter(Boolean));
  const failures = [];
  for (const key of desktopKeys) {
    if (!androidKeys.has(key)) {
      failures.push({ invariant: 'convergence', entity, logicalKey: key, side: 'android-missing', probableDomain: 'serialization/transport/merge' });
    }
  }
  for (const key of androidKeys) {
    if (!desktopKeys.has(key)) {
      failures.push({ invariant: 'convergence', entity, logicalKey: key, side: 'desktop-missing', probableDomain: 'serialization/transport/merge' });
    }
  }
  return failures;
}

function latestByKey(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = logicalKey(row);
    if (!key) continue;
    const current = map.get(key);
    if (!current || compareHlc(row.hlc, current.hlc) > 0) map.set(key, row);
  }
  return map;
}

function hlcAndTombstoneFailures(desktopRows, androidRows, entity) {
  const desktop = latestByKey(desktopRows);
  const android = latestByKey(androidRows);
  const failures = [];
  for (const [key, dRow] of desktop.entries()) {
    const aRow = android.get(key);
    if (!aRow) continue;
    const newest = compareHlc(dRow.hlc, aRow.hlc) >= 0 ? dRow : aRow;
    const other = newest === dRow ? aRow : dRow;
    if ((newest.text ?? newest.term ?? newest.selectedText) !== undefined
      && (other.text ?? other.term ?? other.selectedText) !== undefined
      && (newest.text ?? newest.term ?? newest.selectedText) !== (other.text ?? other.term ?? other.selectedText)) {
      failures.push({ invariant: 'hlc-newer-wins', entity, logicalKey: key, probableDomain: 'merge/hlc' });
    }
    if (isDeleted(newest) && !isDeleted(other)) {
      failures.push({ invariant: 'tombstone-respect', entity, logicalKey: key, probableDomain: 'merge/tombstone' });
    }
  }
  return failures;
}

function semanticGroupFailures(desktopRows, androidRows, entity) {
  const android = latestByKey(androidRows);
  const failures = [];
  for (const row of desktopRows) {
    const key = logicalKey(row);
    const other = android.get(key);
    if (!key || !other) continue;
    if (row.semanticGroup && other.semanticGroup && row.semanticGroup !== other.semanticGroup) {
      failures.push({ invariant: 'semantic-groups', entity, logicalKey: key, probableDomain: 'fixture/serialization' });
    }
  }
  return failures;
}

function deletedBookHashes(state) {
  return new Set(rowsFor(state, 'books').filter((book) => book.deleted === true || book.deletedAt).map((book) => book.hash).filter(Boolean));
}

function bookDeleteSurvivalFailures(desktop, android, config) {
  const deleted = new Set([...deletedBookHashes(desktop), ...deletedBookHashes(android)]);
  if (deleted.size === 0) return [];
  const failures = [];
  for (const hash of deleted) {
    const dRows = rowsFor(desktop, config.key).filter((row) => row.bookHash === hash);
    const aRows = rowsFor(android, config.key).filter((row) => row.bookHash === hash);
    failures.push(...convergenceFailures(dRows, aRows, config.entity).map((failure) => ({
      ...failure,
      invariant: 'book-delete-data-survival',
      probableDomain: 'book-delete/semantic-data',
    })));
  }
  return failures;
}

function idempotenceFailures(state) {
  const failures = [];
  let previousCounts = null;
  for (const run of rowsFor(state, 'syncRuns')) {
    if (previousCounts) {
      for (const [entity, count] of Object.entries(run.logicalCounts ?? {})) {
        if (previousCounts[entity] !== undefined && previousCounts[entity] !== count) {
          failures.push({ invariant: 'idempotence', entity, before: previousCounts[entity], after: count, probableDomain: 'merge/idempotence' });
        }
      }
    }
    previousCounts = run.logicalCounts ?? {};
  }
  return failures;
}

export function compareSemanticState({ desktop = {}, android = {} }) {
  const failures = [];
  for (const config of ENTITY_CONFIG) {
    const desktopRows = rowsFor(desktop, config.key);
    const androidRows = rowsFor(android, config.key);
    failures.push(...convergenceFailures(desktopRows, androidRows, config.entity));
    failures.push(...duplicateFailures(desktopRows, config.entity));
    failures.push(...duplicateFailures(androidRows, config.entity));
    failures.push(...hlcAndTombstoneFailures(desktopRows, androidRows, config.entity));
    failures.push(...semanticGroupFailures(desktopRows, androidRows, config.entity));
    failures.push(...bookDeleteSurvivalFailures(desktop, android, config));
  }
  failures.push(...idempotenceFailures(desktop));
  failures.push(...idempotenceFailures(android));

  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}
