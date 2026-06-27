/**
 * HTTP-based injection module for Android dev sync harness.
 *
 * Injects fixture data into Android via the replicas PUT API
 * instead of the broken ADB sqlite3 path.
 *
 * Reuses rowToReplica(), field maps, and millisToHlc() from sync-execute.mjs.
 *
 * Gate: BIBLIOTECA_DEV_SYNC_HARNESS=1 (enforced via requireDevHarness in caller).
 */

import {
  rowToReplica,
  ENTRY_FIELDS,
  OCCURRENCE_FIELDS,
  QUOTE_FIELDS,
  ANNOTATION_FIELDS,
} from './sync-execute.mjs';

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Resolve the Android server URL from a sync-dev-environment object.
 *
 * @param {object} [env] — environment object (e.g., from createSyncDevEnvironment())
 * @param {object} [env.android] — android section
 * @param {string} [env.android.serverUrl] — server URL override
 * @returns {string} — the resolved server URL
 */
export function resolveAndroidServerUrl(env) {
  if (env?.android?.serverUrl) return env.android.serverUrl;
  return 'http://localhost:7878';
}

/**
 * Convert fixture rows to ReplicaRow[] and inject into Android via PUT /replicas/:kind.
 *
 * @param {string} serverUrl — Android server base URL (e.g., http://localhost:7878)
 * @param {string} kind — replica kind (dictionary-entry, dictionary-occurrence, quote, annotation)
 * @param {object[]} rows — fixture row objects
 * @param {object} fieldMap — field map from sync-execute.mjs (ENTRY_FIELDS, OCCURRENCE_FIELDS, etc.)
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, error?: string}>}
 */
export async function injectReplicasViaHttp(serverUrl, kind, rows, fieldMap) {
  if (!rows || rows.length === 0) {
    return { ok: false, inserted: 0, target: 'android-http', table: kind, error: 'no rows to inject' };
  }

  // Convert fixture rows to ReplicaRow[] using the shared conversion
  // Pass Date.now() as fallback timestamp so even rows without updated_at/created_at get valid HLC
  const now = Date.now();
  const replicas = rows.map((row) => rowToReplica(row, kind, fieldMap, now));

  let resp;
  try {
    resp = await fetch(`${serverUrl}/replicas/${kind}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(replicas),
    });
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: kind,
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const responseText = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: kind,
      error: `HTTP ${resp.status}: ${responseText}`,
    };
  }

  return { ok: true, inserted: rows.length, target: 'android-http', table: kind };
}

/**
 * Inject book data (library entries) into Android via PUT /books/index.
 *
 * @param {string} serverUrl — Android server base URL
 * @param {object[]} books — book objects with at minimum { hash, title, fileName }
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, error?: string}>}
 */
export async function injectBookViaHttp(serverUrl, books) {
  if (!books || books.length === 0) {
    return { ok: false, inserted: 0, target: 'android-http', table: 'books', error: 'no books to inject' };
  }

  let resp;
  try {
    resp = await fetch(`${serverUrl}/books/index`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(books),
    });
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: 'books',
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const responseText = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: 'books',
      error: `HTTP ${resp.status}: ${responseText}`,
    };
  }

  return { ok: true, inserted: books.length, target: 'android-http', table: 'books' };
}

/**
 * Map fixture table names to their replica kind and field map.
 */
export const TABLE_REPLICA_MAP = {
  dictionary_entries: { kind: 'dictionary-entry', fields: ENTRY_FIELDS },
  dictionary_occurrences: { kind: 'dictionary-occurrence', fields: OCCURRENCE_FIELDS },
  quotes: { kind: 'quote', fields: QUOTE_FIELDS },
  annotations: { kind: 'annotation', fields: ANNOTATION_FIELDS },
};
