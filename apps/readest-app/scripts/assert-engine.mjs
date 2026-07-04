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
  { key: 'books', entity: 'book' },
  { key: 'dictionaryEntries', entity: 'dictionary-entry' },
  { key: 'dictionaryOccurrences', entity: 'dictionary-occurrence' },
  { key: 'quotes', entity: 'quote' },
  { key: 'annotations', entity: 'annotation' },
  { key: 'bookNotes', entity: 'book-note' },
];

function normalizeIdentityPart(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function firstValue(row, names) {
  for (const name of names) {
    const value = row?.[name];
    if (value !== undefined && value !== null && value !== '') return value;
    const envelopeValue = row?.fields_jsonb?.[name]?.v;
    if (envelopeValue !== undefined && envelopeValue !== null && envelopeValue !== '') return envelopeValue;
  }
  return undefined;
}

export function bookHashIdentityKey(row) {
  const hash = firstValue(row, ['hash', 'bookHash', 'book_hash']);
  return hash ? `book:${normalizeIdentityPart(hash)}` : '';
}

export function dictionaryEntryIdentityKey(row) {
  const term = normalizeIdentityPart(firstValue(row, ['term', 'word', 'selectedText', 'selected_text', 'text']));
  const language = normalizeIdentityPart(firstValue(row, ['language', 'lang', 'locale']));
  return term ? `dictionary-entry:${term}|${language}` : '';
}

export function dictionaryOccurrenceIdentityKey(row) {
  const entryKey = normalizeIdentityPart(firstValue(row, ['entryKey', 'dictionaryEntryId', 'dictionary_entry_id']) ?? dictionaryEntryIdentityKey(row));
  const bookHash = normalizeIdentityPart(firstValue(row, ['bookHash', 'book_hash', 'hash']));
  const cfi = normalizeIdentityPart(firstValue(row, ['cfi', 'range']));
  const selectedText = normalizeIdentityPart(firstValue(row, ['selectedText', 'selected_text', 'context', 'text']));
  return entryKey || bookHash || cfi || selectedText ? `dictionary-occurrence:${entryKey}|${bookHash}|${cfi}|${selectedText}` : '';
}

export function quoteIdentityKey(row) {
  const bookHash = normalizeIdentityPart(firstValue(row, ['bookHash', 'book_hash', 'hash']));
  const cfi = normalizeIdentityPart(firstValue(row, ['cfi', 'range']));
  const text = normalizeIdentityPart(firstValue(row, ['text', 'selectedText', 'selected_text', 'contentHash', 'content_hash']));
  return bookHash || cfi || text ? `quote:${bookHash}|${cfi}|${text}` : '';
}

export function annotationIdentityKey(row) {
  const bookHash = normalizeIdentityPart(firstValue(row, ['bookHash', 'book_hash', 'hash']));
  const cfi = normalizeIdentityPart(firstValue(row, ['cfi', 'range']));
  const text = normalizeIdentityPart(firstValue(row, ['text', 'selectedText', 'selected_text']));
  return bookHash || cfi || text ? `annotation:${bookHash}|${cfi}|${text}` : '';
}

export function bookNoteIdentityKey(row) {
  const bookHash = normalizeIdentityPart(firstValue(row, ['bookHash', 'book_hash', 'hash']));
  const id = normalizeIdentityPart(firstValue(row, ['id', 'noteId']));
  const type = normalizeIdentityPart(firstValue(row, ['type', 'kind']));
  const cfi = normalizeIdentityPart(firstValue(row, ['cfi', 'range']));
  const group = [
    ['dictionaryEntryId', 'dictionary'],
    ['citeId', 'quote'],
    ['annotationId', 'annotation'],
  ].find(([field]) => firstValue(row, [field]) !== undefined);
  const groupKey = group ? `${group[1]}:${normalizeIdentityPart(firstValue(row, [group[0]]))}` : 'none';
  return bookHash || id || type || cfi ? `book-note:${bookHash}|${id}|${type}|${cfi}|${groupKey}` : '';
}

function rowsFor(state, key) {
  return Array.isArray(state?.[key]) ? state[key] : [];
}

function logicalKey(row, entity) {
  if (row?.logicalKey) return row.logicalKey;
  if (entity === 'book') return bookHashIdentityKey(row);
  if (entity === 'dictionary-entry') return dictionaryEntryIdentityKey(row);
  if (entity === 'dictionary-occurrence') return dictionaryOccurrenceIdentityKey(row);
  if (entity === 'quote') return quoteIdentityKey(row);
  if (entity === 'annotation') return annotationIdentityKey(row);
  if (entity === 'book-note') return bookNoteIdentityKey(row);
  return [row.bookHash, row.cfi, row.term ?? row.text ?? row.selectedText].filter(Boolean).join(':');
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
    const key = logicalKey(row, entity);
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
  const desktopKeys = new Set(desktopRows.map((row) => logicalKey(row, entity)).filter(Boolean));
  const androidKeys = new Set(androidRows.map((row) => logicalKey(row, entity)).filter(Boolean));
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

function latestByKey(rows, entity) {
  const map = new Map();
  for (const row of rows) {
    const key = logicalKey(row, entity);
    if (!key) continue;
    const current = map.get(key);
    if (!current || compareHlc(row.hlc, current.hlc) > 0) map.set(key, row);
  }
  return map;
}

function hlcAndTombstoneFailures(desktopRows, androidRows, entity) {
  const desktop = latestByKey(desktopRows, entity);
  const android = latestByKey(androidRows, entity);
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
  const android = latestByKey(androidRows, entity);
  const failures = [];
  for (const row of desktopRows) {
    const key = logicalKey(row, entity);
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

/**
 * Assert Case 15 convergence: same book hash appears at most once per side.
 * Verifies no duplicate book hash in desktop library facts or Android book index.
 *
 * @param {{desktop?: object, android?: object}} state
 *   Expected shape: { desktop: { books?: Array<{hash?, bookHash?}> }, android: { books?: Array<{hash?, bookHash?}> } }
 * @returns {{verdict: 'PASS'|'FAIL', failures: Array<object>}}
 */
export function assertCase15({ desktop = {}, android = {} }) {
  const failures = [];
  const sides = [
    ['desktop', Array.isArray(desktop.books) ? desktop.books : []],
    ['android', Array.isArray(android.books) ? android.books : []],
  ];

  for (const [side, books] of sides) {
    const seen = new Map();
    for (const book of books) {
      const hash = book?.hash || book?.bookHash;
      if (!hash) continue;
      const count = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, count);
      if (count > 1) {
        failures.push({
          invariant: 'case15-no-duplicate-hash',
          entity: 'book',
          side,
          logicalKey: `book:${hash}`,
          count,
        });
      }
    }
  }

  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}

/**
 * Assert that a specific number of books exist on a given side (live books only, i.e. deletedAt is null/undefined).
 * @param {number} expected - Expected book count
 * @param {object} deviceState - State object for one device ({ books?: Array<{hash?, deletedAt?}> })
 * @returns {{verdict: 'PASS'|'FAIL', failures: Array<object>}}
 */
export function assertBookCount(expected, deviceState) {
  const failures = [];
  const books = Array.isArray(deviceState?.books) ? deviceState.books : [];
  const liveBooks = books.filter((b) => b && b.deletedAt == null);
  const count = liveBooks.length;
  if (count !== expected) {
    failures.push({
      invariant: 'book-count',
      expected,
      actual: count,
      totalBooks: books.length,
      deletedBooks: books.length - count,
    });
  }
  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}

/**
 * Assert that a book with the given hash has a specific metadata field value.
 * @param {string} hash - Book hash to look up
 * @param {string} field - Metadata field name (e.g. 'title')
 * @param {*} expectedValue - Expected field value
 * @param {object} deviceState - State object ({ books?: Array<{hash?, bookHash?, ...}> })
 * @returns {{verdict: 'PASS'|'FAIL', failures: Array<object>}}
 */
export function assertMetadata(hash, field, expectedValue, deviceState) {
  const failures = [];
  const books = Array.isArray(deviceState?.books) ? deviceState.books : [];
  const book = books.find((b) => b && (b.hash === hash || b.bookHash === hash));
  if (!book) {
    failures.push({
      invariant: 'book-not-found',
      hash,
      field,
      expectedValue,
    });
  } else {
    const actualValue = book[field];
    if (actualValue !== expectedValue) {
      failures.push({
        invariant: 'metadata-mismatch',
        hash,
        field,
        expected: expectedValue,
        actual: actualValue,
      });
    }
  }
  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}

/**
 * Assert Case 16 convergence: same normalized dictionary term+language appears at most once per side.
 * Uses dictionaryEntryIdentityKey for semantic identity matching.
 *
 * @param {{desktop?: object, android?: object}} state
 *   Expected shape: { desktop: { dictionaryEntries?: Array<object> }, android: { dictionaryEntries?: Array<object> } }
 * @returns {{verdict: 'PASS'|'FAIL', failures: Array<object>}}
 */
export function assertCase16({ desktop = {}, android = {} }) {
  const failures = [];
  const sides = [
    ['desktop', Array.isArray(desktop.dictionaryEntries) ? desktop.dictionaryEntries : []],
    ['android', Array.isArray(android.dictionaryEntries) ? android.dictionaryEntries : []],
  ];

  for (const [side, rows] of sides) {
    const seen = new Map();
    for (const row of rows) {
      const key = dictionaryEntryIdentityKey(row);
      if (!key) continue;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > 1) {
        failures.push({
          invariant: 'case16-no-duplicate-dictionary-entry',
          entity: 'dictionary-entry',
          side,
          logicalKey: key,
          count,
        });
      }
    }
  }

  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
}

/**
 * Assert Case 17 convergence: same quote (bookHash|cfi|text) appears at most once per side.
 * Uses quoteIdentityKey for semantic identity matching.
 *
 * @param {{desktop?: object, android?: object}} state
 *   Expected shape: { desktop: { quotes?: Array<object> }, android: { quotes?: Array<object> } }
 * @returns {{verdict: 'PASS'|'FAIL', failures: Array<object>}}
 */
export function assertCase17({ desktop = {}, android = {} }) {
  const failures = [];
  const sides = [
    ['desktop', Array.isArray(desktop.quotes) ? desktop.quotes : []],
    ['android', Array.isArray(android.quotes) ? android.quotes : []],
  ];

  for (const [side, rows] of sides) {
    const seen = new Map();
    for (const row of rows) {
      const key = quoteIdentityKey(row);
      if (!key) continue;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > 1) {
        failures.push({
          invariant: 'case17-no-duplicate-quote',
          entity: 'quote',
          side,
          logicalKey: key,
          count,
        });
      }
    }
  }

  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
  };
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
