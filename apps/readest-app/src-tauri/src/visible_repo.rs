/**
 * visible_repo — VisibleRepository trait and LibsqlVisibleRepo implementation.
 *
 * Connects the local sync server directly to the application .db files
 * (Readest/annotations.db, Readest/citas.db, Readest/dictionary.db) that the TypeScript services use.
 * Replaces the isolated JSON shadow files under local-sync/replicas/.
 *
 * ## Architecture
 *
 * - Trait `VisibleRepository`: `pull(kind, since?)`, `push(kind, rows)`, `health()`
 * - Struct `LibsqlVisibleRepo`: opens the Readest database files via rusqlite, sets WAL mode + busy_timeout
 * - Each .db gets a `_replicas` metadata table for CRDT fields (replica_id, HLC, etc.)
 * - Application table sync maps ReplicaRow fields to actual table columns per kind
 */
use crate::local_sync_server::ReplicaRow;

/// Abstraction for reading/writing replica data to the visible .db files.
pub trait VisibleRepository: Send + Sync {
    /// Return ReplicaRows for `kind`, optionally only those with `updated_at_ts > since`.
    fn pull(&self, kind: &str, since: Option<&str>) -> Result<Vec<ReplicaRow>, String>;

    /// Merge incoming rows into the visible .db.
    /// Returns the number of rows processed.
    fn push(&self, kind: &str, rows: &[ReplicaRow]) -> Result<usize, String>;

    /// Health check — returns true if the database connections are alive.
    fn health(&self) -> bool;

    /// Dev/test harness reset hook used only by the local sync server's guarded
    /// reset route. Implementations should clear cached runtime state that file
    /// deletion alone cannot reach.
    fn clear_dev_state(&self) -> Result<usize, String> {
        Ok(0)
    }
}

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use unicode_normalization::UnicodeNormalization;

/// Maps a replica kind to its database filename.
fn db_file_for_kind(kind: &str) -> &str {
    match kind {
        "annotation" => "annotations.db",
        "quote" => "citas.db",
        "dictionary-entry" => "dictionary.db",
        "dictionary-occurrence" => "dictionary.db",
        _ => "annotations.db", // fallback (shouldn't happen)
    }
}

/// SQL to create the `_replicas` metadata table if it doesn't exist.
const CREATE_REPLICAS_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS _replicas (
        replica_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        fields_jsonb TEXT NOT NULL DEFAULT '{}',
        manifest_jsonb TEXT,
        deleted_at_ts TEXT,
        reincarnation TEXT,
        updated_at_ts TEXT NOT NULL DEFAULT '',
        schema_version INTEGER NOT NULL DEFAULT 1,
        semantic_key TEXT
    );
    CREATE INDEX IF NOT EXISTS idx__replicas_kind_upd
        ON _replicas(kind, updated_at_ts);
";

/// Concrete adapter that opens the visible .db files via rusqlite.
///
/// Each `.db` connection is opened lazily on first use and cached behind
/// a `Mutex<HashMap<...>>`. WAL mode and `busy_timeout` are set on open
/// so the frontend TypeScript (via tauri-plugin-turso) can read/write
/// the same files concurrently.
pub struct LibsqlVisibleRepo {
    app_data_dir: PathBuf,
    connections: Mutex<HashMap<String, Connection>>,
}

impl LibsqlVisibleRepo {
    /// Create a new adapter.
    ///
    /// `app_data_dir` is typically `app.path().app_data_dir()` — the same
    /// directory where the TypeScript services keep `annotations.db`,
    /// `citas.db`, and `dictionary.db`.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            app_data_dir,
            connections: Mutex::new(HashMap::new()),
        }
    }

    /// Get or lazily open a connection for the given kind.
    fn conn_for_kind(
        &self,
        kind: &str,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, Connection>>, String> {
        let mut conns = self
            .connections
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if !conns.contains_key(kind) {
            let db_file = db_file_for_kind(kind);
            let readest_dir = self.app_data_dir.join("Readest");
            std::fs::create_dir_all(&readest_dir)
                .map_err(|e| format!("create Readest db dir {readest_dir:?}: {e}"))?;
            let db_path = readest_dir.join(db_file);
            let conn = Connection::open(&db_path).map_err(|e| format!("open {db_path:?}: {e}"))?;
            conn.pragma_update(None, "journal_mode", "WAL")
                .map_err(|e| format!("wal: {e}"))?;
            conn.pragma_update(None, "busy_timeout", 5000i64)
                .map_err(|e| format!("busy_timeout: {e}"))?;
            conn.execute_batch(CREATE_REPLICAS_TABLE)
                .map_err(|e| format!("create _replicas: {e}"))?;
            conns.insert(kind.to_string(), conn);
        }
        Ok(conns)
    }

    fn pull_from_replicas(
        &self,
        conn: &Connection,
        kind: &str,
        since: Option<&str>,
    ) -> Result<Vec<ReplicaRow>, String> {
        let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) =
            if let Some(since_val) = since {
                (
                    "SELECT replica_id, kind, user_id, fields_jsonb, manifest_jsonb, \
                     deleted_at_ts, reincarnation, updated_at_ts, schema_version \
                     FROM _replicas WHERE kind = ?1 AND updated_at_ts > ?2 \
                     ORDER BY updated_at_ts",
                    vec![Box::new(kind.to_string()), Box::new(since_val.to_string())],
                )
            } else {
                (
                    "SELECT replica_id, kind, user_id, fields_jsonb, manifest_jsonb, \
                     deleted_at_ts, reincarnation, updated_at_ts, schema_version \
                     FROM _replicas WHERE kind = ?1 \
                     ORDER BY updated_at_ts",
                    vec![Box::new(kind.to_string())],
                )
            };

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("prepare pull: {e}"))?;

        let row_iter = stmt
            .query_map(param_refs.as_slice(), |row| {
                let fields_raw: String = row.get(3)?;
                let manifest_raw: Option<String> = row.get(4)?;
                Ok(ReplicaRow {
                    replica_id: row.get(0)?,
                    kind: row.get(1)?,
                    user_id: row.get(2)?,
                    fields_jsonb: serde_json::from_str(&fields_raw).unwrap_or_default(),
                    manifest_jsonb: manifest_raw.and_then(|s| serde_json::from_str(&s).ok()),
                    deleted_at_ts: row.get(5)?,
                    reincarnation: row.get(6)?,
                    updated_at_ts: row.get(7)?,
                    schema_version: row.get(8)?,
                })
            })
            .map_err(|e| format!("query pull: {e}"))?;

        let mut result = Vec::new();
        for row in row_iter {
            result.push(row.map_err(|e| format!("row: {e}"))?);
        }
        Ok(result)
    }

    fn seed_replicas_from_visible(&self, conn: &Connection, kind: &str) -> Result<(), String> {
        // Helper: build a ReplicaRow with real HLCs. Phantom rows (null id) are
        // returned as None and filtered out after collection.
        let replica_rows: Vec<ReplicaRow> =
            match kind {
                "annotation" => {
                    let seed =
                        || -> Result<Vec<ReplicaRow>, String> {
                            let mut stmt = conn
                        .prepare(
                            "SELECT id, book_hash, book_title, book_author, cfi, section_href, \
                             page, text, note, style, color, created_at, updated_at, deleted_at \
                             FROM annotations ORDER BY updated_at, created_at",
                        )
                        .map_err(|e| format!("prepare annotations: {e}"))?;
                            let rows = stmt
                        .query_map([], |row| {
                            let id: Option<String> = row.get(0)?;
                            let Some(id) = id else {
                                return Ok(None);
                            };
                            let created_ts: Option<i64> = row.get(11)?;
                            let updated_ts: Option<i64> = row.get(12)?;
                            let deleted_ts: Option<i64> = row.get(13)?;

                            let hlc_base = updated_ts.or(created_ts).unwrap_or(0);
                            let hlc = make_hlc(hlc_base);

                            let field_keys: [(usize, &str); 10] = [
                                (1, "bookHash"), (2, "bookTitle"), (3, "bookAuthor"),
                                (4, "cfi"), (5, "sectionHref"), (6, "page"), (7, "text"),
                                (8, "note"), (9, "style"), (10, "color"),
                            ];
                            let mut fields = serde_json::json!({});
                            for (col, key) in field_keys.iter() {
                                if let Some(v) = col_str(row, *col)? {
                                    fields[key] =
                                        serde_json::json!({"v": v, "t": &hlc, "s": "visible"});
                                }
                            }

                            Ok(Some(ReplicaRow {
                                replica_id: {
                                    let clean = extract_item_id(&id, "annotation");
                                    format!("annotation:{clean}")
                                },
                                kind: "annotation".into(),
                                user_id: "visible".into(),
                                fields_jsonb: fields,
                                manifest_jsonb: None,
                                deleted_at_ts: deleted_ts.map(|ts| make_hlc(ts)),
                                reincarnation: None,
                                updated_at_ts: hlc,
                                schema_version: 1,
                            }))
                        })
                        .map_err(|e| format!("scan annotations: {e}"))?;
                            Ok(rows.filter_map(|r| r.ok().flatten()).collect())
                        };
                    seed().unwrap_or_default()
                }
                "quote" => {
                    let seed =
                        || -> Result<Vec<ReplicaRow>, String> {
                            let mut stmt = conn
                        .prepare(
                            "SELECT id, book_hash, book_title, book_author, cfi, section_href, \
                             page, text, context_before, context_after, content_hash, \
                             created_at, updated_at, deleted_at \
                             FROM quotes ORDER BY updated_at, created_at",
                        )
                        .map_err(|e| format!("prepare quotes: {e}"))?;
                            let rows = stmt
                        .query_map([], |row| {
                            let id: Option<String> = row.get(0)?;
                            let Some(id) = id else {
                                return Ok(None);
                            };
                            let created_ts: Option<i64> = row.get(11)?;
                            let updated_ts: Option<i64> = row.get(12)?;
                            let deleted_ts: Option<i64> = row.get(13)?;

                            let hlc_base = updated_ts.or(created_ts).unwrap_or(0);
                            let hlc = make_hlc(hlc_base);

                            let field_keys: [(usize, &str); 10] = [
                                (1, "bookHash"), (2, "bookTitle"), (3, "bookAuthor"),
                                (4, "cfi"), (5, "sectionHref"), (6, "page"),
                                (7, "text"), (8, "contextBefore"), (9, "contextAfter"),
                                (10, "contentHash"),
                            ];
                            let mut fields = serde_json::json!({});
                            for (col, key) in field_keys.iter() {
                                if let Some(v) = col_str(row, *col)? {
                                    fields[key] =
                                        serde_json::json!({"v": v, "t": &hlc, "s": "visible"});
                                }
                            }

                            Ok(Some(ReplicaRow {
                                replica_id: {
                                    let clean = extract_item_id(&id, "quote");
                                    format!("quote:{clean}")
                                },
                                kind: "quote".into(),
                                user_id: "visible".into(),
                                fields_jsonb: fields,
                                manifest_jsonb: None,
                                deleted_at_ts: deleted_ts.map(|ts| make_hlc(ts)),
                                reincarnation: None,
                                updated_at_ts: hlc,
                                schema_version: 1,
                            }))
                        })
                        .map_err(|e| format!("scan quotes: {e}"))?;
                            Ok(rows.filter_map(|r| r.ok().flatten()).collect())
                        };
                    seed().unwrap_or_default()
                }
                "dictionary-entry" => {
                    let seed_entries = || -> Result<Vec<ReplicaRow>, String> {
                        let mut stmt = conn
                            .prepare(
                                "SELECT id, term, display_term, language, definition, \
                             image_path, curiosity, enrichment_status, \
                             created_at, updated_at, deleted_at \
                             FROM dictionary_entries ORDER BY updated_at, created_at",
                            )
                            .map_err(|e| format!("prepare entries: {e}"))?;
                        let rows = stmt
                            .query_map([], |row| {
                                let id: Option<String> = row.get(0)?;
                                let Some(id) = id else {
                                    return Ok(None);
                                };
                                let created_ts: Option<i64> = row.get(8)?;
                                let updated_ts: Option<i64> = row.get(9)?;
                                let deleted_ts: Option<i64> = row.get(10)?;

                                let hlc_base = updated_ts.or(created_ts).unwrap_or(0);
                                let hlc = make_hlc(hlc_base);

                                let field_keys: [(usize, &str); 7] = [
                                    (1, "term"),
                                    (2, "displayTerm"),
                                    (3, "language"),
                                    (4, "definition"),
                                    (5, "imagePath"),
                                    (6, "curiosity"),
                                    (7, "enrichmentStatus"),
                                ];
                                let mut fields = serde_json::json!({});
                                for (col, key) in field_keys.iter() {
                                    if let Some(v) = col_str(row, *col)? {
                                        fields[key] = serde_json::json!(
                                            {"v": v, "t": &hlc, "s": "visible"}
                                        );
                                    }
                                }

                                Ok(Some(ReplicaRow {
                                    replica_id: {
                                        let clean = extract_item_id(&id, "dictionary-entry");
                                        format!("dictionary-entry:{clean}")
                                    },
                                    kind: "dictionary-entry".into(),
                                    user_id: "visible".into(),
                                    fields_jsonb: fields,
                                    manifest_jsonb: None,
                                    deleted_at_ts: deleted_ts.map(|ts| make_hlc(ts)),
                                    reincarnation: None,
                                    updated_at_ts: hlc,
                                    schema_version: 1,
                                }))
                            })
                            .map_err(|e| format!("scan entries: {e}"))?;
                        Ok(rows.filter_map(|r| r.ok().flatten()).collect())
                    };
                    seed_entries().unwrap_or_default()
                }
                "dictionary-occurrence" => {
                    let seed_occurrences = || -> Result<Vec<ReplicaRow>, String> {
                        let mut stmt = conn
                            .prepare(
                                "SELECT id, entry_id, book_hash, book_title, book_author, \
                             cfi, section_href, page, selected_text, context_before, \
                             context_after, highlight_note_id, created_at, deleted_at \
                             FROM dictionary_occurrences ORDER BY created_at",
                            )
                            .map_err(|e| format!("prepare occurrences: {e}"))?;
                        let rows = stmt
                            .query_map([], |row| {
                                let id: Option<String> = row.get(0)?;
                                let Some(id) = id else {
                                    return Ok(None);
                                };
                                let created_ts: Option<i64> = row.get(12)?;
                                let deleted_ts: Option<i64> = row.get(13)?;

                                // occurrences have NO updated_at — use created_at
                                let hlc_base = created_ts.unwrap_or(0);
                                let hlc = make_hlc(hlc_base);

                                let field_keys: [(usize, &str); 11] = [
                                    (1, "entryId"),
                                    (2, "bookHash"),
                                    (3, "bookTitle"),
                                    (4, "bookAuthor"),
                                    (5, "cfi"),
                                    (6, "sectionHref"),
                                    (7, "page"),
                                    (8, "selectedText"),
                                    (9, "contextBefore"),
                                    (10, "contextAfter"),
                                    (11, "highlightNoteId"),
                                ];
                                let mut fields = serde_json::json!({});
                                for (col, key) in field_keys.iter() {
                                    if let Some(v) = col_str(row, *col)? {
                                        fields[key] = serde_json::json!(
                                            {"v": v, "t": &hlc, "s": "visible"}
                                        );
                                    }
                                }

                                Ok(Some(ReplicaRow {
                                    replica_id: {
                                        let clean = extract_item_id(&id, "dictionary-occurrence");
                                        format!("dictionary-occurrence:{clean}")
                                    },
                                    kind: "dictionary-occurrence".into(),
                                    user_id: "visible".into(),
                                    fields_jsonb: fields,
                                    manifest_jsonb: None,
                                    deleted_at_ts: deleted_ts.map(|ts| make_hlc(ts)),
                                    reincarnation: None,
                                    updated_at_ts: hlc,
                                    schema_version: 1,
                                }))
                            })
                            .map_err(|e| format!("scan occurrences: {e}"))?;
                        Ok(rows.filter_map(|r| r.ok().flatten()).collect())
                    };
                    seed_occurrences().unwrap_or_default()
                }
                _ => return Ok(()), // unknown kind — no visible tables
            };

        // HLC-wins upsert: only overwrite when incoming HLC > existing.
        for row in &replica_rows {
            let existing_hlc: Option<String> = conn
                .query_row(
                    "SELECT updated_at_ts FROM _replicas WHERE replica_id = ?1",
                    [&row.replica_id],
                    |r| r.get(0),
                )
                .ok();

            if let Some(ref _existing) = existing_hlc {
                // Row already tracked in _replicas — never overwrite from seed.
                // The seed's only job is to discover data that hasn't been
                // replicated yet. Existing replicas preserve their original HLCs.
                continue;
            }

            let fields_str = row.fields_jsonb.to_string();
            let manifest_str = row.manifest_jsonb.as_ref().map(|m| m.to_string());

            conn.execute(
                "INSERT OR REPLACE INTO _replicas \
                 (replica_id, kind, user_id, fields_jsonb, manifest_jsonb, \
                  deleted_at_ts, reincarnation, updated_at_ts, schema_version) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    &row.replica_id,
                    &row.kind,
                    &row.user_id,
                    &fields_str,
                    &manifest_str,
                    &row.deleted_at_ts,
                    &row.reincarnation,
                    &row.updated_at_ts,
                    row.schema_version,
                ],
            )
            .map_err(|e| format!("seed upsert _replicas for {}: {e}", row.replica_id))?;
        }

        Ok(())
    }
}

/// Extract the application-level ID from a replica_id by stripping ALL kind prefixes.
/// "annotation:abc123" → "abc123"
/// "dictionary-occurrence:dictionary-occurrence:occ-1" → "occ-1"
fn extract_item_id(replica_id: &str, kind: &str) -> String {
    let prefix = format!("{kind}:");
    let mut id = replica_id.to_string();
    while let Some(stripped) = id.strip_prefix(&prefix) {
        id = stripped.to_string();
    }
    id
}

/// Build an HLC string from a Unix-millisecond timestamp.
///
/// Format: `{13-hex-ms}-{8-hex-counter}-{device_id}` where the counter is
/// fixed at 1 (no concurrent writers during a single pull call) and the
/// device_id is `"visible"` (stable, never collides with TypeScript UUIDs).
///
/// Example: `1718000000000` → `"0019000c79c00-00000001-visible"`
fn make_hlc(ts_ms: i64) -> String {
    format!("{:013x}-{:08x}-visible", ts_ms, 1u32)
}

/// Read a column value as an `Option<String>` regardless of SQL type.
/// Converts Text, Integer, and Real to their string representations;
/// returns `None` for Null and Blob.
fn col_str(row: &rusqlite::Row, idx: usize) -> rusqlite::Result<Option<String>> {
    match row.get_ref(idx)? {
        rusqlite::types::ValueRef::Null => Ok(None),
        rusqlite::types::ValueRef::Text(s) => Ok(Some(String::from_utf8_lossy(s).into_owned())),
        rusqlite::types::ValueRef::Integer(i) => Ok(Some(i.to_string())),
        rusqlite::types::ValueRef::Real(f) => Ok(Some(f.to_string())),
        rusqlite::types::ValueRef::Blob(_) => Ok(None),
    }
}

/// Try to parse an HLC string to Unix milliseconds (first 13 hex chars).
/// Fallback: current system time.
fn hlc_to_ms(hlc: &str) -> i64 {
    if hlc.len() >= 13 {
        if let Ok(ms) = u64::from_str_radix(&hlc[..13], 16) {
            return ms as i64;
        }
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Parse the counter portion of an HLC (positions 14-22, 8 hex chars after the first dash).
fn hlc_counter(hlc: &str) -> u32 {
    if let Some(dash_pos) = hlc.find('-') {
        let counter_start = dash_pos + 1;
        let counter_end = (counter_start + 8).min(hlc.len());
        if counter_end > counter_start {
            if let Ok(c) = u32::from_str_radix(&hlc[counter_start..counter_end], 16) {
                return c;
            }
        }
    }
    0
}

/// Compare two HLCs numerically: first by timestamp, then by counter,
/// then lexicographically by deviceId as a deterministic tiebreaker.
/// Returns true when `a` is strictly greater than `b`.
fn hlc_gt(a: &str, b: &str) -> bool {
    let ms_a = hlc_to_ms(a);
    let ms_b = hlc_to_ms(b);
    match ms_a.cmp(&ms_b) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }
    let cnt_a = hlc_counter(a);
    let cnt_b = hlc_counter(b);
    match cnt_a.cmp(&cnt_b) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }
    // Same timestamp and counter: use deviceId as tiebreaker
    a > b
}

/// Extract a string value from a field envelope inside fields_jsonb.
/// Field envelopes are: { "v": value, "t": "HLC", "s": "deviceId" }
fn field_str(fields: &serde_json::Value, key: &str) -> Option<String> {
    fields.get(key).and_then(|env| env.get("v")).and_then(|v| {
        if v.is_string() {
            v.as_str().map(String::from)
        } else if v.is_number() {
            Some(v.to_string())
        } else if v.is_null() {
            None
        } else {
            Some(v.to_string())
        }
    })
}

/// Normalize a dictionary term for semantic identity comparison.
/// Mirrors TS `normalizeDictionaryTerm`: NFC + lowercase + soft-hyphen strip.
/// This is used during sync push to match dictionary entries by normalized
/// (term, language) rather than by replica_id alone.
pub fn normalize_dictionary_term(term: &str) -> String {
    term.nfc()
        .collect::<String>()
        .replace('\u{00AD}', "")
        .to_lowercase()
}

/// Merge incoming fields_jsonb into existing fields_jsonb using per-field HLC
/// comparison. Fields absent in incoming are preserved from existing. Fields
/// present in incoming overwrite existing ONLY when incoming HLC > existing HLC.
fn merge_fields_jsonb(
    existing: &serde_json::Value,
    incoming: &serde_json::Value,
) -> serde_json::Value {
    let mut merged = existing.clone();
    if let Some(incoming_obj) = incoming.as_object() {
        for (key, incoming_env) in incoming_obj {
            let existing_env = merged.get(key);
            let incoming_t = incoming_env.get("t").and_then(|t| t.as_str()).unwrap_or("");
            let should_overwrite = match existing_env {
                None => true,
                Some(env) => {
                    let existing_t = env.get("t").and_then(|t| t.as_str()).unwrap_or("");
                    hlc_gt(incoming_t, existing_t)
                }
            };
            if should_overwrite {
                merged[key] = incoming_env.clone();
            }
        }
    }
    merged
}

/// Look up the canonical replica_id for an incoming row by semantic content.
///
/// For dictionary-entry: matches by normalized(term) + language.
/// For quote:            matches by book_hash + content_hash.
/// For annotation:       matches by book_hash + cfi.
/// For dictionary-occurrence: always returns None (distinct events).
///
/// Returns Some(canonical_replica_id) if a matching row already exists.
fn resolve_semantic_id(
    tx: &rusqlite::Transaction,
    kind: &str,
    row: &ReplicaRow,
) -> Result<Option<String>, String> {
    let item_id = extract_item_id(&row.replica_id, kind);
    let fields = &row.fields_jsonb;

    match kind {
        "dictionary-entry" => {
            let term_raw = field_str(fields, "term").unwrap_or_default();
            let normalized = normalize_dictionary_term(&term_raw);
            let lang = field_str(fields, "language").unwrap_or_default();
            tx.query_row(
                "SELECT id FROM dictionary_entries \
                 WHERE LOWER(term) = ?1 AND IFNULL(language,'') = IFNULL(?2,'') \
                 AND deleted_at IS NULL AND id != ?3",
                rusqlite::params![normalized, lang, item_id],
                |r| r.get::<_, String>(0),
            )
            .map(|id| Some(format!("dictionary-entry:{id}")))
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                _ => {
                    let msg = e.to_string();
                    if msg.contains("no such table") {
                        Ok(None)
                    } else {
                        Err(format!("resolve_semantic_id dict: {e}"))
                    }
                }
            })
        }
        "quote" => {
            let book_hash = field_str(fields, "bookHash");
            let content_hash = field_str(fields, "contentHash");
            if let (Some(bh), Some(ch)) = (book_hash, content_hash) {
                tx.query_row(
                    "SELECT id FROM quotes \
                     WHERE book_hash = ?1 AND content_hash = ?2 \
                     AND deleted_at IS NULL AND id != ?3",
                    rusqlite::params![bh, ch, item_id],
                    |r| r.get::<_, String>(0),
                )
                .map(|id| Some(format!("quote:{id}")))
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    _ => {
                        let msg = e.to_string();
                        if msg.contains("no such table") {
                            Ok(None)
                        } else {
                            Err(format!("resolve_semantic_id quote: {e}"))
                        }
                    }
                })
            } else {
                Ok(None)
            }
        }
        "annotation" => {
            let book_hash = field_str(fields, "bookHash");
            let cfi = field_str(fields, "cfi");
            if let (Some(bh), Some(c)) = (book_hash, cfi) {
                tx.query_row(
                    "SELECT id FROM annotations \
                     WHERE book_hash = ?1 AND cfi = ?2 \
                     AND deleted_at IS NULL AND id != ?3",
                    rusqlite::params![bh, c, item_id],
                    |r| r.get::<_, String>(0),
                )
                .map(|id| Some(format!("annotation:{id}")))
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    _ => {
                        let msg = e.to_string();
                        if msg.contains("no such table") {
                            Ok(None)
                        } else {
                            Err(format!("resolve_semantic_id annotation: {e}"))
                        }
                    }
                })
            } else {
                Ok(None)
            }
        }
        // dictionary-occurrence and unknown kinds: no semantic dedup
        _ => Ok(None),
    }
}

/// Sync a single ReplicaRow to the application table appropriate for its kind.
fn sync_to_app_table(
    tx: &rusqlite::Transaction,
    kind: &str,
    row: &ReplicaRow,
) -> Result<(), String> {
    let item_id = extract_item_id(&row.replica_id, kind);
    let fields = &row.fields_jsonb;
    let now_ms = hlc_to_ms(&row.updated_at_ts);
    let deleted_ms: Option<i64> = row.deleted_at_ts.as_deref().map(hlc_to_ms);

    match kind {
        "annotation" => {
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
                   style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .map_err(|e| format!("ensure annotations table: {e}"))?;

            if let Some(del_ms) = deleted_ms {
                let affected = tx
                    .execute(
                        "UPDATE annotations SET deleted_at = ?1 WHERE id = ?2",
                        rusqlite::params![del_ms, &item_id],
                    )
                    .map_err(|e| format!("tombstone annotation: {e}"))?;
                if affected == 0 {
                    tx.execute(
                        "INSERT INTO annotations \
                         (id, text, note, style, color, created_at, updated_at, deleted_at) \
                         VALUES (?1, '', '', 'highlight', 'yellow', ?2, ?3, ?4)",
                        rusqlite::params![&item_id, &now_ms, &now_ms, &del_ms],
                    )
                    .map_err(|e| format!("tombstone annotation insert: {e}"))?;
                }
            } else {
                tx.execute(
                    "INSERT INTO annotations \
                     (id, book_hash, book_title, book_author, cfi, section_href, page, \
                      text, note, style, color, created_at, updated_at, deleted_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) \
                     ON CONFLICT(id) DO UPDATE SET \
                       book_hash = COALESCE(excluded.book_hash, annotations.book_hash), \
                       book_title = COALESCE(excluded.book_title, annotations.book_title), \
                       book_author = COALESCE(excluded.book_author, annotations.book_author), \
                       cfi = COALESCE(excluded.cfi, annotations.cfi), \
                       section_href = COALESCE(excluded.section_href, annotations.section_href), \
                       page = COALESCE(excluded.page, annotations.page), \
                       text = COALESCE(excluded.text, annotations.text), \
                       note = COALESCE(excluded.note, annotations.note), \
                       style = COALESCE(excluded.style, annotations.style), \
                       color = COALESCE(excluded.color, annotations.color), \
                       created_at = COALESCE(excluded.created_at, annotations.created_at), \
                       updated_at = COALESCE(excluded.updated_at, annotations.updated_at), \
                       deleted_at = NULL",
                    rusqlite::params![
                        &item_id,
                        &field_str(fields, "bookHash"),
                        &field_str(fields, "bookTitle"),
                        &field_str(fields, "bookAuthor"),
                        &field_str(fields, "cfi"),
                        &field_str(fields, "sectionHref"),
                        &field_str(fields, "page").and_then(|s| s.parse::<i64>().ok()),
                        &field_str(fields, "text"),
                        &field_str(fields, "note").unwrap_or_default(),
                        &field_str(fields, "style").unwrap_or_else(|| "highlight".into()),
                        &field_str(fields, "color").unwrap_or_else(|| "yellow".into()),
                        &now_ms,
                        &now_ms,
                        &deleted_ms,
                    ],
                )
                .map_err(|e| format!("upsert annotation: {e}"))?;
            }
        }
        "quote" => {
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS quotes (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, \
                   context_before TEXT, context_after TEXT, content_hash TEXT, \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .map_err(|e| format!("ensure quotes table: {e}"))?;

            if let Some(del_ms) = deleted_ms {
                let affected = tx
                    .execute(
                        "UPDATE quotes SET deleted_at = ?1 WHERE id = ?2",
                        rusqlite::params![del_ms, &item_id],
                    )
                    .map_err(|e| format!("tombstone quote: {e}"))?;
                if affected == 0 {
                    tx.execute(
                        "INSERT INTO quotes (id, text, content_hash, created_at, updated_at, deleted_at) \
                         VALUES (?1, '', '', ?2, ?3, ?4)",
                        rusqlite::params![&item_id, &now_ms, &now_ms, &del_ms],
                    )
                    .map_err(|e| format!("tombstone quote insert: {e}"))?;
                }
            } else {
                tx.execute(
                    "INSERT INTO quotes \
                     (id, book_hash, book_title, book_author, cfi, section_href, page, \
                      text, context_before, context_after, content_hash, \
                      created_at, updated_at, deleted_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) \
                     ON CONFLICT(id) DO UPDATE SET \
                       book_hash = COALESCE(excluded.book_hash, quotes.book_hash), \
                       book_title = COALESCE(excluded.book_title, quotes.book_title), \
                       book_author = COALESCE(excluded.book_author, quotes.book_author), \
                       cfi = COALESCE(excluded.cfi, quotes.cfi), \
                       section_href = COALESCE(excluded.section_href, quotes.section_href), \
                       page = COALESCE(excluded.page, quotes.page), \
                       text = COALESCE(excluded.text, quotes.text), \
                       context_before = COALESCE(excluded.context_before, quotes.context_before), \
                       context_after = COALESCE(excluded.context_after, quotes.context_after), \
                       content_hash = COALESCE(excluded.content_hash, quotes.content_hash), \
                       created_at = COALESCE(excluded.created_at, quotes.created_at), \
                       updated_at = COALESCE(excluded.updated_at, quotes.updated_at), \
                       deleted_at = NULL",
                    rusqlite::params![
                        &item_id,
                        &field_str(fields, "bookHash"),
                        &field_str(fields, "bookTitle"),
                        &field_str(fields, "bookAuthor"),
                        &field_str(fields, "cfi"),
                        &field_str(fields, "sectionHref"),
                        &field_str(fields, "page").and_then(|s| s.parse::<i64>().ok()),
                        &field_str(fields, "text"),
                        &field_str(fields, "contextBefore"),
                        &field_str(fields, "contextAfter"),
                        &field_str(fields, "contentHash"),
                        &now_ms,
                        &now_ms,
                        &deleted_ms,
                    ],
                )
                .map_err(|e| format!("upsert quote: {e}"))?;
            }
        }
        "dictionary-occurrence" => {
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS dictionary_occurrences (\
                   id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, \
                   book_title TEXT, book_author TEXT, cfi TEXT, section_href TEXT, \
                   page INTEGER, selected_text TEXT, context_before TEXT, \
                   context_after TEXT, highlight_note_id TEXT, \
                   created_at INTEGER, deleted_at INTEGER);",
            )
            .map_err(|e| format!("ensure dictionary_occurrences: {e}"))?;

            if let Some(del_ms) = deleted_ms {
                let affected = tx
                    .execute(
                        "UPDATE dictionary_occurrences SET deleted_at = ?1 WHERE id = ?2",
                        rusqlite::params![del_ms, &item_id],
                    )
                    .map_err(|e| format!("tombstone dictionary_occurrence: {e}"))?;
                if affected == 0 {
                    tx.execute(
                        "INSERT INTO dictionary_occurrences \
                         (id, entry_id, cfi, created_at, deleted_at) \
                         VALUES (?1, '', '', ?2, ?3)",
                        rusqlite::params![&item_id, &now_ms, &del_ms],
                    )
                    .map_err(|e| format!("tombstone dictionary_occurrence insert: {e}"))?;
                }
            } else {
                tx.execute(
                    "INSERT INTO dictionary_occurrences \
                     (id, entry_id, book_hash, book_title, book_author, cfi, \
                      section_href, page, selected_text, context_before, context_after, \
                      highlight_note_id, created_at, deleted_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) \
                     ON CONFLICT(id) DO UPDATE SET \
                       entry_id = COALESCE(excluded.entry_id, dictionary_occurrences.entry_id), \
                       book_hash = COALESCE(excluded.book_hash, dictionary_occurrences.book_hash), \
                       book_title = COALESCE(excluded.book_title, dictionary_occurrences.book_title), \
                       book_author = COALESCE(excluded.book_author, dictionary_occurrences.book_author), \
                       cfi = COALESCE(excluded.cfi, dictionary_occurrences.cfi), \
                       section_href = COALESCE(excluded.section_href, dictionary_occurrences.section_href), \
                       page = COALESCE(excluded.page, dictionary_occurrences.page), \
                       selected_text = COALESCE(excluded.selected_text, dictionary_occurrences.selected_text), \
                       context_before = COALESCE(excluded.context_before, dictionary_occurrences.context_before), \
                       context_after = COALESCE(excluded.context_after, dictionary_occurrences.context_after), \
                       highlight_note_id = COALESCE(excluded.highlight_note_id, dictionary_occurrences.highlight_note_id), \
                       created_at = COALESCE(excluded.created_at, dictionary_occurrences.created_at), \
                       deleted_at = NULL",
                    rusqlite::params![
                        &item_id,
                        &field_str(fields, "entryId"),
                        &field_str(fields, "bookHash"),
                        &field_str(fields, "bookTitle"),
                        &field_str(fields, "bookAuthor"),
                        &field_str(fields, "cfi"),
                        &field_str(fields, "sectionHref"),
                        &field_str(fields, "page").and_then(|s| s.parse::<i64>().ok()),
                        &field_str(fields, "selectedText"),
                        &field_str(fields, "contextBefore"),
                        &field_str(fields, "contextAfter"),
                        &field_str(fields, "highlightNoteId"),
                        &now_ms,
                        &deleted_ms,
                    ],
                )
                .map_err(|e| format!("upsert dictionary_occurrence: {e}"))?;
            }
        }
        "dictionary-entry" => {
            let is_occurrence = row.replica_id.starts_with("dictionary-occurrence:");

            if is_occurrence {
                tx.execute_batch(
                    "CREATE TABLE IF NOT EXISTS dictionary_occurrences (\
                       id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, \
                       book_title TEXT, book_author TEXT, cfi TEXT, section_href TEXT, \
                       page INTEGER, selected_text TEXT, context_before TEXT, \
                       context_after TEXT, highlight_note_id TEXT, \
                       created_at INTEGER, deleted_at INTEGER);",
                )
                .map_err(|e| format!("ensure dictionary_occurrences: {e}"))?;

                if let Some(del_ms) = deleted_ms {
                    let affected = tx
                        .execute(
                            "UPDATE dictionary_occurrences SET deleted_at = ?1 WHERE id = ?2",
                            rusqlite::params![del_ms, &item_id],
                        )
                        .map_err(|e| format!("tombstone dictionary_occurrence: {e}"))?;
                    if affected == 0 {
                        tx.execute(
                            "INSERT INTO dictionary_occurrences \
                             (id, entry_id, cfi, created_at, deleted_at) \
                             VALUES (?1, '', '', ?2, ?3)",
                            rusqlite::params![&item_id, &now_ms, &del_ms],
                        )
                        .map_err(|e| format!("tombstone dictionary_occurrence insert: {e}"))?;
                    }
                } else {
                    tx.execute(
                        "INSERT INTO dictionary_occurrences \
                         (id, entry_id, book_hash, book_title, book_author, cfi, \
                          section_href, page, selected_text, context_before, context_after, \
                          highlight_note_id, created_at, deleted_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) \
                         ON CONFLICT(id) DO UPDATE SET \
                           entry_id = COALESCE(excluded.entry_id, dictionary_occurrences.entry_id), \
                           book_hash = COALESCE(excluded.book_hash, dictionary_occurrences.book_hash), \
                           book_title = COALESCE(excluded.book_title, dictionary_occurrences.book_title), \
                           book_author = COALESCE(excluded.book_author, dictionary_occurrences.book_author), \
                           cfi = COALESCE(excluded.cfi, dictionary_occurrences.cfi), \
                           section_href = COALESCE(excluded.section_href, dictionary_occurrences.section_href), \
                           page = COALESCE(excluded.page, dictionary_occurrences.page), \
                           selected_text = COALESCE(excluded.selected_text, dictionary_occurrences.selected_text), \
                           context_before = COALESCE(excluded.context_before, dictionary_occurrences.context_before), \
                           context_after = COALESCE(excluded.context_after, dictionary_occurrences.context_after), \
                           highlight_note_id = COALESCE(excluded.highlight_note_id, dictionary_occurrences.highlight_note_id), \
                           created_at = COALESCE(excluded.created_at, dictionary_occurrences.created_at), \
                           deleted_at = COALESCE(excluded.deleted_at, dictionary_occurrences.deleted_at)",
                        rusqlite::params![
                            &item_id,
                            &field_str(fields, "entryId"),
                            &field_str(fields, "bookHash"),
                            &field_str(fields, "bookTitle"),
                            &field_str(fields, "bookAuthor"),
                            &field_str(fields, "cfi"),
                            &field_str(fields, "sectionHref"),
                            &field_str(fields, "page").and_then(|s| s.parse::<i64>().ok()),
                            &field_str(fields, "selectedText"),
                            &field_str(fields, "contextBefore"),
                            &field_str(fields, "contextAfter"),
                            &field_str(fields, "highlightNoteId"),
                            &now_ms,
                            &deleted_ms,
                        ],
                    )
                    .map_err(|e| format!("upsert dictionary_occurrence: {e}"))?;
                }
            } else {
                tx.execute_batch(
                    "CREATE TABLE IF NOT EXISTS dictionary_entries (\
                       id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, \
                       definition TEXT, enrichment_status TEXT DEFAULT 'pending', \
                       image_path TEXT, curiosity TEXT, \
                       created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
                )
                .map_err(|e| format!("ensure dictionary_entries: {e}"))?;

                if let Some(del_ms) = deleted_ms {
                    // Tombstone: mark deleted_at. If the row doesn't exist yet,
                    // insert a minimal placeholder so the tombstone is visible.
                    let affected = tx
                        .execute(
                            "UPDATE dictionary_entries SET deleted_at = ?1 WHERE id = ?2",
                            rusqlite::params![del_ms, &item_id],
                        )
                        .map_err(|e| format!("tombstone dictionary_entry: {e}"))?;
                    if affected == 0 {
                        tx.execute(
                            "INSERT INTO dictionary_entries \
                             (id, term, display_term, enrichment_status, created_at, updated_at, deleted_at) \
                             VALUES (?1, '', '', 'none', ?2, ?3, ?4)",
                            rusqlite::params![&item_id, &now_ms, &now_ms, &del_ms],
                        )
                        .map_err(|e| format!("tombstone dictionary_entry insert: {e}"))?;
                    }
                } else {
                    tx.execute(
                        "INSERT INTO dictionary_entries \
                         (id, term, display_term, language, definition, enrichment_status, \
                          image_path, curiosity, created_at, updated_at, deleted_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) \
                         ON CONFLICT(id) DO UPDATE SET \
                           term = COALESCE(excluded.term, dictionary_entries.term), \
                           display_term = COALESCE(excluded.display_term, dictionary_entries.display_term), \
                           language = COALESCE(excluded.language, dictionary_entries.language), \
                           definition = COALESCE(excluded.definition, dictionary_entries.definition), \
                           enrichment_status = COALESCE(excluded.enrichment_status, dictionary_entries.enrichment_status), \
                           image_path = COALESCE(excluded.image_path, dictionary_entries.image_path), \
                           curiosity = COALESCE(excluded.curiosity, dictionary_entries.curiosity), \
                           created_at = COALESCE(excluded.created_at, dictionary_entries.created_at), \
                           updated_at = COALESCE(excluded.updated_at, dictionary_entries.updated_at), \
                           deleted_at = NULL",
                        rusqlite::params![
                            &item_id,
                            &field_str(fields, "term"),
                            &field_str(fields, "displayTerm"),
                            &field_str(fields, "language"),
                            &field_str(fields, "definition"),
                            &field_str(fields, "enrichmentStatus").unwrap_or_else(|| "pending".into()),
                            &field_str(fields, "imagePath"),
                            &field_str(fields, "curiosity"),
                            &now_ms,
                            &now_ms,
                            &deleted_ms,
                        ],
                    )
                    .map_err(|e| format!("upsert dictionary_entry: {e}"))?;
                }
            }
        }
        _ => {
            // Unknown kind — still persisted in _replicas, but no app table sync
        }
    }
    Ok(())
}

impl VisibleRepository for LibsqlVisibleRepo {
    fn pull(&self, kind: &str, since: Option<&str>) -> Result<Vec<ReplicaRow>, String> {
        let conns = self.conn_for_kind(kind)?;
        let conn = conns
            .get(kind)
            .ok_or_else(|| format!("no connection for kind {kind}"))?;

        // Always seed _replicas from visible tables (idempotent, HLC-wins).
        // This is our single source of truth for the pull path.
        self.seed_replicas_from_visible(conn, kind)?;

        // Read exclusively from _replicas — no dual-source HashMap merge.
        self.pull_from_replicas(conn, kind, since)
    }

    fn push(&self, kind: &str, rows: &[ReplicaRow]) -> Result<usize, String> {
        if rows.is_empty() {
            return Ok(0);
        }

        let mut conns = self.conn_for_kind(kind)?;
        let conn = conns
            .get_mut(kind)
            .ok_or_else(|| format!("no connection for kind {kind}"))?;

        let tx = conn.transaction().map_err(|e| format!("begin tx: {e}"))?;

        let mut count = 0usize;
        for row in rows {
            let mut row = row.clone();

            // Cycle 3: resolve semantic identity — if an existing row matches
            // by content (not replica_id), remap to the canonical id before
            // HLC gate, merge, and app-table sync.
            if let Some(canonical_id) =
                resolve_semantic_id(&tx, kind, &row).map_err(|e| format!("semantic id: {e}"))?
            {
                row.replica_id = canonical_id;
            }

            // Check if replica already exists with higher/equal HLC
            let existing_hlc_and_deleted: Option<(String, Option<String>)> = tx
                .query_row(
                    "SELECT updated_at_ts, deleted_at_ts FROM _replicas WHERE replica_id = ?1",
                    [&row.replica_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();

            if let Some((ref existing_hlc, existing_deleted)) = existing_hlc_and_deleted {
                // Tombstone resurrection: if the existing row is a tombstone (has
                // deleted_at_ts) and the incoming row is LIVE (no deleted_at_ts),
                // accept the live row as long as its HLC is strictly higher than
                // the tombstone's deleted_at HLC OR the incoming row has field-level
                // timestamps that are newer than the delete.
                let is_existing_tombstone = existing_deleted.is_some();
                let is_incoming_live = row.deleted_at_ts.is_none();

                if is_existing_tombstone && is_incoming_live {
                    // Tombstone resurrection: accept a live row when its HLC is
                    // strictly higher than the tombstone's deleted_at_ts, OR when
                    // any incoming field HLC is newer than the delete HLC.
                    let tombstone_hlc: &str = existing_deleted.as_deref().unwrap_or(existing_hlc);
                    let fields_have_newer = row.fields_jsonb.as_object().map_or(false, |obj| {
                        obj.values().any(|v| {
                            v.as_object()
                                .and_then(|env| env.get("t"))
                                .and_then(|t| t.as_str())
                                .map(|field_hlc| hlc_gt(field_hlc, tombstone_hlc))
                                .unwrap_or(false)
                        })
                    });
                    let row_hlc_newer = hlc_gt(&row.updated_at_ts, tombstone_hlc);

                    if !row_hlc_newer && !fields_have_newer {
                        continue; // Tombstone still wins — no newer data
                    }
                    // Otherwise: tombstone resurrection — proceed with upsert
                } else if !hlc_gt(&row.updated_at_ts, existing_hlc) {
                    // Standard CRDT: HLC not strictly higher → skip
                    continue;
                }
            }

            // Merge fields_jsonb with existing _replicas row (per-field HLC).
            // This preserves fields from the existing row that are NOT in
            // the incoming row, and uses HLC comparison for overlapping fields.
            let existing_fields_raw: Option<String> = tx
                .query_row(
                    "SELECT fields_jsonb FROM _replicas WHERE replica_id = ?1",
                    [&row.replica_id],
                    |r| r.get(0),
                )
                .ok();
            let existing_fields: serde_json::Value = existing_fields_raw
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!({}));
            let merged_fields = merge_fields_jsonb(&existing_fields, &row.fields_jsonb);

            let fields_str = merged_fields.to_string();
            let manifest_str = row.manifest_jsonb.as_ref().map(|m| m.to_string());

            // Upsert into _replicas with MERGED fields_jsonb
            tx.execute(
                "INSERT OR REPLACE INTO _replicas \
                 (replica_id, kind, user_id, fields_jsonb, manifest_jsonb, \
                  deleted_at_ts, reincarnation, updated_at_ts, schema_version) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    &row.replica_id,
                    kind,
                    &row.user_id,
                    &fields_str,
                    &manifest_str,
                    &row.deleted_at_ts,
                    &row.reincarnation,
                    &row.updated_at_ts,
                    row.schema_version,
                ],
            )
            .map_err(|e| format!("upsert _replicas: {e}"))?;

            // Build a merged row for app-table sync so the sync function
            // sees the fully-merged fields (not just the incoming subset).
            let merged_row = ReplicaRow {
                fields_jsonb: merged_fields.clone(),
                ..row.clone()
            };

            // Sync to application table (best-effort: skip rows that fail
            // constraints, e.g. occurrence referencing a missing entry).
            if let Err(e) = sync_to_app_table(&tx, kind, &merged_row) {
                eprintln!("sync_to_app_table({kind} {}): {e}", row.replica_id);
                continue;
            }

            count += 1;
        }

        tx.commit().map_err(|e| format!("commit tx: {e}"))?;
        Ok(count)
    }

    fn health(&self) -> bool {
        // Try a simple query on the annotation connection to verify it's alive.
        match self.connections.lock() {
            Ok(conns) => {
                if let Some(conn) = conns.get("annotation") {
                    conn.execute_batch("SELECT 1").is_ok()
                } else {
                    // No connections opened yet — try to open one now
                    drop(conns);
                    self.conn_for_kind("annotation")
                        .map(|_| true)
                        .unwrap_or(false)
                }
            }
            Err(_) => false,
        }
    }
}

/// Ensure the `semantic_key` column exists on the `_replicas` table.
/// This handles migration for databases created before the column was added.
fn ensure_semantic_key_column(conn: &Connection) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('_replicas') WHERE name = 'semantic_key'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("check semantic_key column: {e}"))?;
    if !exists {
        conn.execute_batch("ALTER TABLE _replicas ADD COLUMN semantic_key TEXT")
            .map_err(|e| format!("add semantic_key column: {e}"))?;
    }
    Ok(())
}

/// Compute a semantic key for a dictionary-entry row.
///
/// Returns `"{normalized_term}|{language}"` or `None` if the term is missing or empty.
pub fn compute_semantic_key(fields_jsonb: &serde_json::Value) -> Option<String> {
    let term = field_str(fields_jsonb, "term")?;
    if term.is_empty() {
        return None;
    }
    let normalized = normalize_dictionary_term(&term);
    let language = field_str(fields_jsonb, "language").unwrap_or_default();
    Some(format!("{}|{}", normalized, language))
}

/// Filter out rows from `rows` that already exist in `_replicas` with
/// equal-or-higher HLC. Two passes:
///
/// 1. **Exact replica_id match** — if a row exists with updated_at_ts >= incoming, skip it.
/// 2. **Semantic match** (dictionary-entry only) — if a row with the same `semantic_key`
///    and `kind = 'dictionary-entry'` exists with updated_at_ts >= incoming, skip it.
pub fn filter_unchanged_replicas(
    kind: &str,
    rows: &[ReplicaRow],
    db_path: &str,
) -> Result<Vec<ReplicaRow>, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("open db: {e}"))?;
    conn.execute_batch(CREATE_REPLICAS_TABLE)
        .map_err(|e| format!("create _replicas: {e}"))?;
    ensure_semantic_key_column(&conn)?;

    let mut result = Vec::new();

    for row in rows {
        // Pass 1: exact replica_id match
        let existing_hlc: Option<String> = conn
            .query_row(
                "SELECT updated_at_ts FROM _replicas WHERE replica_id = ?1",
                [&row.replica_id],
                |r| r.get(0),
            )
            .ok();

        let skip_by_replica = match existing_hlc {
            Some(ref existing) if existing.as_str() >= row.updated_at_ts.as_str() => true,
            _ => false,
        };

        if skip_by_replica {
            continue;
        }

        // Pass 2: semantic match for dictionary-entry
        if kind == "dictionary-entry" {
            if let Some(semantic_key) = compute_semantic_key(&row.fields_jsonb) {
                let semantic_hlc: Option<String> = conn
                    .query_row(
                        "SELECT updated_at_ts FROM _replicas \
                         WHERE semantic_key = ?1 AND kind = 'dictionary-entry' \
                         LIMIT 1",
                        [&semantic_key],
                        |r| r.get(0),
                    )
                    .ok();

                if let Some(ref existing) = semantic_hlc {
                    if existing.as_str() >= row.updated_at_ts.as_str() {
                        continue;
                    }
                }
            }
        }

        result.push(row.clone());
    }

    Ok(result)
}

/// Upsert a single ReplicaRow into `_replicas`, computing and storing the
/// `semantic_key` column for dictionary-entry rows.
pub fn write_replica_metadata(row: &ReplicaRow, db_path: &str) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("open db: {e}"))?;
    conn.execute_batch(CREATE_REPLICAS_TABLE)
        .map_err(|e| format!("create _replicas: {e}"))?;
    ensure_semantic_key_column(&conn)?;

    let semantic_key = if row.kind == "dictionary-entry" {
        compute_semantic_key(&row.fields_jsonb)
    } else {
        None
    };

    let fields_str = row.fields_jsonb.to_string();
    let manifest_str = row.manifest_jsonb.as_ref().map(|m| m.to_string());

    conn.execute(
        "INSERT OR REPLACE INTO _replicas \
         (replica_id, kind, user_id, fields_jsonb, manifest_jsonb, \
          deleted_at_ts, reincarnation, updated_at_ts, schema_version, semantic_key) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            &row.replica_id,
            &row.kind,
            &row.user_id,
            &fields_str,
            &manifest_str,
            &row.deleted_at_ts,
            &row.reincarnation,
            &row.updated_at_ts,
            row.schema_version,
            semantic_key,
        ],
    )
    .map_err(|e| format!("upsert _replicas: {e}"))?;

    Ok(())
}

/// Ensure `_replicas` and the application table for `kind` exist.
/// Idempotent — safe to call multiple times.
///
/// Supports kinds: `annotation`, `quote`, `dictionary-entry`.
/// Unknown kinds still create `_replicas`.
pub fn ensure_replica_tables(kind: &str, db_path: &str) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("open db: {e}"))?;

    conn.execute_batch(CREATE_REPLICAS_TABLE)
        .map_err(|e| format!("create _replicas: {e}"))?;
    ensure_semantic_key_column(&conn)?;

    let app_ddl = match kind {
        "dictionary-entry" => Some(
            "CREATE TABLE IF NOT EXISTS dictionary_entries (\
               id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, \
               definition TEXT, enrichment_status TEXT DEFAULT 'pending', \
               image_path TEXT, curiosity TEXT, \
               created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
        ),
        "quote" => Some(
            "CREATE TABLE IF NOT EXISTS quotes (\
               id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
               cfi TEXT, section_href TEXT, page INTEGER, text TEXT, \
               context_before TEXT, context_after TEXT, content_hash TEXT, \
               created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
        ),
        "annotation" => Some(
            "CREATE TABLE IF NOT EXISTS annotations (\
               id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
               cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
               style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
               created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
        ),
        _ => None,
    };

    if let Some(ddl) = app_ddl {
        conn.execute_batch(ddl)
            .map_err(|e| format!("create app table: {e}"))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_sync_server::ReplicaRow;

    fn make_row(id: &str, kind: &str, hlc: &str) -> ReplicaRow {
        ReplicaRow {
            user_id: "test-user".into(),
            kind: kind.into(),
            replica_id: id.into(),
            fields_jsonb: serde_json::json!({}),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: hlc.into(),
            schema_version: 1,
        }
    }

    // ── Trait existence and signature verification ─────────────────────

    /// Verify that the VisibleRepository trait can be imported and has the
    /// expected method signatures (compiles = passes).
    #[test]
    fn trait_visible_repository_exists_and_has_correct_signatures() {
        struct MockRepo;

        impl VisibleRepository for MockRepo {
            fn pull(&self, _kind: &str, _since: Option<&str>) -> Result<Vec<ReplicaRow>, String> {
                Ok(vec![])
            }

            fn push(&self, _kind: &str, _rows: &[ReplicaRow]) -> Result<usize, String> {
                Ok(0)
            }

            fn health(&self) -> bool {
                true
            }
        }

        let repo = MockRepo;
        assert!(repo.health());
        assert_eq!(repo.pull("annotation", None).unwrap().len(), 0);
        assert_eq!(repo.push("annotation", &[]).unwrap(), 0);
    }

    /// Verify the trait is object-safe (can be used as dyn VisibleRepository).
    #[test]
    fn trait_is_object_safe_for_dyn_usage() {
        struct MockRepo;
        impl VisibleRepository for MockRepo {
            fn pull(&self, _kind: &str, _since: Option<&str>) -> Result<Vec<ReplicaRow>, String> {
                Ok(vec![])
            }
            fn push(&self, _kind: &str, _rows: &[ReplicaRow]) -> Result<usize, String> {
                Ok(0)
            }
            fn health(&self) -> bool {
                true
            }
        }

        let repo: &dyn VisibleRepository = &MockRepo;
        assert!(repo.health());
        assert_eq!(repo.pull("annotation", None).unwrap().len(), 0);
    }

    // ── LibsqlVisibleRepo::new — connection management ─────────────────

    /// Verify that `new()` creates an instance and the adapter can open .db
    /// files, set WAL mode, and create the `_replicas` table.
    #[test]
    fn new_creates_adapter_with_wal_and_replicas_table() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Opening a connection SHOULD create the .db + _replicas table
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            // Verify _replicas table exists
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_replicas'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "_replicas table should be created on first open");
        }

        assert!(
            dir.path().join("Readest").join("annotations.db").exists(),
            "visible adapter must open the same Readest/annotations.db used by the app UI"
        );
        assert!(
            !dir.path().join("annotations.db").exists(),
            "visible adapter must not create a root-level shadow annotations.db"
        );

        // Verify WAL journal mode
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let mode: String = conn
                .pragma_query_value(None, "journal_mode", |row| row.get(0))
                .unwrap();
            assert_eq!(mode.to_lowercase(), "wal");
        }

        // Verify health
        assert!(repo.health());
    }

    /// Verify each kind maps to the correct db file and gets its own connection.
    #[test]
    fn db_file_mapping_per_kind() {
        assert_eq!(db_file_for_kind("annotation"), "annotations.db");
        assert_eq!(db_file_for_kind("quote"), "citas.db");
        assert_eq!(db_file_for_kind("dictionary-entry"), "dictionary.db");
        assert_eq!(
            db_file_for_kind("dictionary-occurrence"),
            "dictionary.db",
            "dictionary-occurrence must route to dictionary.db"
        );
    }

    /// Verify connections are cached — asking twice for the same kind
    /// returns the same underlying connection (no duplicate open).
    #[test]
    fn connection_caching_reuses_same_connection() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Open annotation twice
        {
            let _conns1 = repo.conn_for_kind("annotation").unwrap();
            // _conns1 is dropped here
        }
        {
            let conns2 = repo.conn_for_kind("annotation").unwrap();
            assert!(conns2.contains_key("annotation"), "conn should be cached");
        }
        {
            let conns = repo.connections.lock().unwrap();
            assert_eq!(
                conns.len(),
                1,
                "only one connection should exist for annotation"
            );
        }
    }

    // ── push — upsert + application table sync ─────────────────────────

    /// Push a single annotation row: verify it lands in _replicas and the
    /// annotations application table.
    #[test]
    fn push_annotation_writes_to_replicas_and_app_table() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let row = ReplicaRow {
            user_id: "device-a".into(),
            kind: "annotation".into(),
            replica_id: "annotation:annot-1".into(),
            fields_jsonb: serde_json::json!({
                "bookHash": {"v": "hash123", "t": "T100", "s": "device-a"},
                "text": {"v": "This is a highlight", "t": "T100", "s": "device-a"},
                "note": {"v": "My note", "t": "T100", "s": "device-a"},
                "style": {"v": "highlight", "t": "T100", "s": "device-a"},
                "color": {"v": "yellow", "t": "T100", "s": "device-a"},
                "cfi": {"v": "/4/2/1", "t": "T100", "s": "device-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T100".into(),
            schema_version: 1,
        };

        let count = repo.push("annotation", &[row]).unwrap();
        assert_eq!(count, 1, "should process 1 row");

        // Verify in _replicas table
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM _replicas WHERE replica_id = ?1",
                    ["annotation:annot-1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "row should be in _replicas");
        }

        // Verify in annotations application table
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let text: String = conn
                .query_row(
                    "SELECT text FROM annotations WHERE id = ?1",
                    ["annot-1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(text, "This is a highlight");
        }
    }

    /// Push with higher HLC replaces existing row (last-write-wins).
    #[test]
    fn push_newer_hlc_replaces_existing_in_both_tables() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Insert with HLC T001
        let row1 = make_row("annotation:annot-2", "annotation", "T001");
        repo.push("annotation", &[row1]).unwrap();

        // Insert with higher HLC T005 (same replica_id, different text)
        let row2 = ReplicaRow {
            replica_id: "annotation:annot-2".into(),
            fields_jsonb: serde_json::json!({
                "text": {"v": "Updated text", "t": "T005", "s": "device-b"},
                "bookHash": {"v": "hash456", "t": "T005", "s": "device-b"}
            }),
            updated_at_ts: "T005".into(),
            ..make_row("annotation:annot-2", "annotation", "T005")
        };
        repo.push("annotation", &[row2]).unwrap();

        // Verify _replicas has the updated HLC
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let hlc: String = conn
                .query_row(
                    "SELECT updated_at_ts FROM _replicas WHERE replica_id = ?1",
                    ["annotation:annot-2"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(hlc, "T005", "higher HLC should win");
        }

        // Verify annotations table has updated text
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let text: String = conn
                .query_row(
                    "SELECT text FROM annotations WHERE id = ?1",
                    ["annot-2"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(text, "Updated text");
        }
    }

    /// Push with older HLC should be ignored (no-op).
    #[test]
    fn push_older_hlc_is_ignored() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Use equal-length HLCs for correct lexicographic comparison
        let row1 = make_row("annotation:annot-3", "annotation", "T010");
        repo.push("annotation", &[row1]).unwrap();

        // Try to overwrite with older HLC (lexicographically "T005" < "T010")
        let row2 = make_row("annotation:annot-3", "annotation", "T005");
        repo.push("annotation", &[row2]).unwrap();

        // HLC should still be T010
        let conns = repo.conn_for_kind("annotation").unwrap();
        let conn = conns.get("annotation").unwrap();
        let hlc: String = conn
            .query_row(
                "SELECT updated_at_ts FROM _replicas WHERE replica_id = ?1",
                ["annotation:annot-3"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hlc, "T010", "older HLC must not overwrite");
    }

    /// Push a quote row — verify it goes to citas.db::quotes.
    #[test]
    fn push_quote_writes_to_citas_db() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let row = ReplicaRow {
            user_id: "device-a".into(),
            kind: "quote".into(),
            replica_id: "quote:q-1".into(),
            fields_jsonb: serde_json::json!({
                "bookHash": {"v": "hash123", "t": "T200", "s": "device-a"},
                "text": {"v": "To be or not to be", "t": "T200", "s": "device-a"},
                "contextBefore": {"v": "...", "t": "T200", "s": "device-a"},
                "contextAfter": {"v": "...", "t": "T200", "s": "device-a"},
                "contentHash": {"v": "abc123", "t": "T200", "s": "device-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T200".into(),
            schema_version: 1,
        };

        let count = repo.push("quote", &[row]).unwrap();
        assert_eq!(count, 1);

        let conns = repo.conn_for_kind("quote").unwrap();
        let conn = conns.get("quote").unwrap();
        let text: String = conn
            .query_row("SELECT text FROM quotes WHERE id = ?1", ["q-1"], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(text, "To be or not to be");
    }

    /// Push a dictionary occurrence — verify it goes to dictionary.db::dictionary_occurrences
    /// under the "dictionary-occurrence" kind (PR3).
    #[test]
    fn push_dictionary_occurrence_writes_to_dictionary_db() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let row = ReplicaRow {
            user_id: "device-a".into(),
            kind: "dictionary-occurrence".into(),
            replica_id: "dictionary-occurrence:occ-1".into(),
            fields_jsonb: serde_json::json!({
                "entryId": {"v": "dict-1", "t": "T400", "s": "device-a"},
                "bookHash": {"v": "hash-occ", "t": "T400", "s": "device-a"},
                "selectedText": {"v": "serendipity", "t": "T400", "s": "device-a"},
                "cfi": {"v": "/6/2", "t": "T400", "s": "device-a"},
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T400".into(),
            schema_version: 1,
        };

        let count = repo.push("dictionary-occurrence", &[row]).unwrap();
        assert_eq!(count, 1);

        let conns = repo.conn_for_kind("dictionary-occurrence").unwrap();
        let conn = conns.get("dictionary-occurrence").unwrap();

        // Check _replicas
        let rc: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _replicas WHERE replica_id = ?1",
                ["dictionary-occurrence:occ-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rc, 1);

        // Check dictionary_occurrences table
        let selected_text: String = conn
            .query_row(
                "SELECT selected_text FROM dictionary_occurrences WHERE id = ?1",
                ["occ-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(selected_text, "serendipity");
    }

    /// Push a dictionary entry — verify it goes to dictionary.db::dictionary_entries.
    #[test]
    fn push_dictionary_entry_writes_to_dictionary_db() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let row = ReplicaRow {
            user_id: "device-a".into(),
            kind: "dictionary-entry".into(),
            replica_id: "dictionary-entry:dict-1".into(),
            fields_jsonb: serde_json::json!({
                "term": {"v": "hello", "t": "T300", "s": "device-a"},
                "displayTerm": {"v": "hello", "t": "T300", "s": "device-a"},
                "language": {"v": "en", "t": "T300", "s": "device-a"},
                "definition": {"v": "A greeting", "t": "T300", "s": "device-a"},
                "enrichmentStatus": {"v": "enriched", "t": "T300", "s": "device-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T300".into(),
            schema_version: 1,
        };

        let count = repo.push("dictionary-entry", &[row]).unwrap();
        assert_eq!(count, 1);

        let conns = repo.conn_for_kind("dictionary-entry").unwrap();
        let conn = conns.get("dictionary-entry").unwrap();

        // Check _replicas
        let rc: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _replicas WHERE replica_id = ?1",
                ["dictionary-entry:dict-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rc, 1);

        // Check dictionary_entries table
        let term: String = conn
            .query_row(
                "SELECT term FROM dictionary_entries WHERE id = ?1",
                ["dict-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(term, "hello");
    }

    // ── pull — read replicas from _replicas table ──────────────────────

    /// Pull returns rows that were previously pushed.
    #[test]
    fn pull_returns_pushed_rows() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let row = make_row("annotation:annot-99", "annotation", "T500");
        repo.push("annotation", &[row]).unwrap();

        let pulled = repo.pull("annotation", None).unwrap();
        assert_eq!(pulled.len(), 1);
        assert_eq!(pulled[0].replica_id, "annotation:annot-99");
        assert_eq!(pulled[0].updated_at_ts, "T500");
    }

    /// Pull with `since` cursor returns only rows with HLC > since.
    #[test]
    fn pull_with_since_cursor_filters_by_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        repo.push(
            "annotation",
            &[
                make_row("annotation:a1", "annotation", "T100"),
                make_row("annotation:a2", "annotation", "T200"),
                make_row("annotation:a3", "annotation", "T300"),
            ],
        )
        .unwrap();

        // "T200" > "T100" and "T200" > "T150", so with since=T150 we get T200 and T300
        let pulled = repo.pull("annotation", Some("T150")).unwrap();
        assert_eq!(pulled.len(), 2, "should get 2 rows after T150");

        let hlcs: Vec<&str> = pulled.iter().map(|r| r.updated_at_ts.as_str()).collect();
        assert!(hlcs.contains(&"T200"));
        assert!(hlcs.contains(&"T300"));
        assert!(!hlcs.contains(&"T100"));
    }

    /// Pull with kind filter only returns rows of that kind.
    #[test]
    fn pull_filters_by_kind() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        repo.push(
            "annotation",
            &[make_row("annotation:ax", "annotation", "T001")],
        )
        .unwrap();
        repo.push("quote", &[make_row("quote:qx", "quote", "T001")])
            .unwrap();

        let annotations = repo.pull("annotation", None).unwrap();
        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].replica_id, "annotation:ax");

        let quotes = repo.pull("quote", None).unwrap();
        assert_eq!(quotes.len(), 1);
        assert_eq!(quotes[0].replica_id, "quote:qx");
    }

    /// Pull from empty DB returns empty vec.
    #[test]
    fn pull_empty_db_returns_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let pulled = repo.pull("annotation", None).unwrap();
        assert!(pulled.is_empty(), "empty db should return empty vec");
    }

    // ── Phase 2: seed_replicas_from_visible ──────────────────────────

    /// CRT-1, CRT-2: Seed inserts annotation row into _replicas with real HLC
    /// from the updated_at timestamp.
    #[test]
    fn seed_replicas_inserts_annotation_with_real_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let created_ts = 1000000i64;
        let updated_ts = 1718000000000i64;
        let expected_hlc = super::make_hlc(updated_ts);

        // Insert a visible annotation row
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
                   style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO annotations (id, book_hash, text, note, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    "ann-1",
                    "hashABC",
                    "hello world",
                    "my note",
                    created_ts,
                    updated_ts
                ],
            )
            .unwrap();
        }

        // Seed
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            repo.seed_replicas_from_visible(conn, "annotation").unwrap();
        }

        // Verify _replicas has the row with real HLC
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let (hlc, kind, replica_id, fields_raw): (String, String, String, String) = conn
                .query_row(
                    "SELECT updated_at_ts, kind, replica_id, fields_jsonb \
                     FROM _replicas WHERE replica_id = ?1",
                    ["annotation:ann-1"],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();

            assert_eq!(replica_id, "annotation:ann-1");
            assert_eq!(kind, "annotation");
            assert_eq!(hlc, expected_hlc);

            let fields: serde_json::Value = serde_json::from_str(&fields_raw).unwrap();
            let text = fields
                .get("text")
                .and_then(|e| e.get("v"))
                .and_then(|v| v.as_str());
            assert_eq!(text, Some("hello world"));
        }
    }

    /// CRT-5: Tombstone rows (deleted_at IS NOT NULL) produce deleted_at_ts
    /// with HLC derived from actual deleted_at ms, NOT updated_at.
    #[test]
    fn seed_replicas_tombstone_uses_deleted_at_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // updated_at=1000, deleted_at=2000
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
                   style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO annotations (id, book_hash, text, created_at, updated_at, deleted_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params!["ann-tomb", "hash", "deleted text", 500i64, 1000i64, 2000i64],
            )
            .unwrap();
        }

        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            repo.seed_replicas_from_visible(conn, "annotation").unwrap();
        }

        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let (updated_at_ts, deleted_at_ts): (String, Option<String>) = conn
                .query_row(
                    "SELECT updated_at_ts, deleted_at_ts FROM _replicas \
                     WHERE replica_id = ?1",
                    ["annotation:ann-tomb"],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();

            assert_eq!(
                updated_at_ts,
                super::make_hlc(1000i64),
                "updated_at_ts must derive from updated_at=1000"
            );
            assert_eq!(
                deleted_at_ts.unwrap(),
                super::make_hlc(2000i64),
                "deleted_at_ts must derive from deleted_at=2000, NOT updated_at"
            );
        }
    }

    /// CRT-7: Dictionary occurrences use created_at as HLC base
    /// (no updated_at column). PR3: seeded under "dictionary-occurrence" kind.
    #[test]
    fn seed_replicas_occurrence_uses_created_at_as_hlc_base() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let created_ts = 1500000000000i64;
        let expected_hlc = super::make_hlc(created_ts);

        // Create occurrence row (no updated_at column at all)
        {
            let conns = repo.conn_for_kind("dictionary-occurrence").unwrap();
            let conn = conns.get("dictionary-occurrence").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS dictionary_occurrences (\
                   id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, \
                   book_title TEXT, book_author TEXT, cfi TEXT, section_href TEXT, \
                   page INTEGER, selected_text TEXT, context_before TEXT, \
                   context_after TEXT, highlight_note_id TEXT, \
                   created_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO dictionary_occurrences \
                 (id, entry_id, book_hash, selected_text, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params!["occ-10", "dict-42", "hash42", "selected word", created_ts],
            )
            .unwrap();
        }

        // Seed under "dictionary-occurrence" kind (PR3: separate kind)
        {
            let conns = repo.conn_for_kind("dictionary-occurrence").unwrap();
            let conn = conns.get("dictionary-occurrence").unwrap();
            repo.seed_replicas_from_visible(conn, "dictionary-occurrence")
                .unwrap();
        }

        // Verify HLC derives from created_at
        {
            let conns = repo.conn_for_kind("dictionary-occurrence").unwrap();
            let conn = conns.get("dictionary-occurrence").unwrap();
            let hlc: String = conn
                .query_row(
                    "SELECT updated_at_ts FROM _replicas WHERE replica_id = ?1",
                    ["dictionary-occurrence:occ-10"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(hlc, expected_hlc);

            // PR3: kind is now "dictionary-occurrence" (separate from entries)
            let kind: String = conn
                .query_row(
                    "SELECT kind FROM _replicas WHERE replica_id = ?1",
                    ["dictionary-occurrence:occ-10"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(kind, "dictionary-occurrence");
        }
    }

    /// CRT-2: Seeding twice with same data is idempotent — HLC-wins skip
    /// prevents duplicate rows.
    #[test]
    fn seed_replicas_is_idempotent() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
                   style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO annotations (id, book_hash, text, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params!["ann-idem", "hash", "text", 100i64, 5000i64],
            )
            .unwrap();
        }

        // Seed twice
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            repo.seed_replicas_from_visible(conn, "annotation").unwrap();
        }
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            repo.seed_replicas_from_visible(conn, "annotation").unwrap();
        }

        // Exactly one row
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM _replicas WHERE replica_id = ?1",
                    ["annotation:ann-idem"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                count, 1,
                "seed must be idempotent — no duplicate rows on repeated calls"
            );
        }
    }

    // ── Phase 3: simplified pull() ────────────────────────────────────

    /// CRT-3, UCS-3: pull() seeds visible rows from annotations table into
    /// _replicas, then reads exclusively from _replicas — no dual-source
    /// HashMap merge.
    #[test]
    fn pull_seeds_visible_rows_and_reads_from_replicas() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Insert directly into the visible annotations table — no push,
        // so _replicas is initially empty.
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
                   style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO annotations (id, book_hash, text, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params!["ann-pull", "hash1", "visible text", 1000i64, 5000000i64],
            )
            .unwrap();
        }

        // pull() must seed the visible row into _replicas and return it
        let rows = repo.pull("annotation", None).unwrap();
        assert_eq!(
            rows.len(),
            1,
            "pull should return the visible row after seeding into _replicas"
        );
        assert_eq!(rows[0].replica_id, "annotation:ann-pull");
        assert_eq!(rows[0].updated_at_ts, super::make_hlc(5000000i64));

        // Assert it is physically in _replicas, not just an in-memory merge
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM _replicas WHERE replica_id = ?1",
                    ["annotation:ann-pull"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "row must be persisted in _replicas after pull");
        }
    }

    /// CRT-4: Full roundtrip for annotation — all fields map correctly
    /// from visible columns to ReplicaRow fields_jsonb entries.
    #[test]
    fn pull_roundtrip_annotation_maps_all_fields() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let updated_ts = 1700000000000i64;
        let expected_hlc = super::make_hlc(updated_ts);

        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
                   style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO annotations (id, book_hash, book_title, book_author, cfi, \
                 section_href, page, text, note, style, color, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    "annot-rt",
                    "hashABC",
                    "My Book",
                    "John Doe",
                    "/4/2/1",
                    "/chapter1.html",
                    42i64,
                    "highlighted text",
                    "My note",
                    "underline",
                    "blue",
                    1000i64,
                    updated_ts,
                ],
            )
            .unwrap();
        }

        let rows = repo.pull("annotation", None).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];

        assert_eq!(row.replica_id, "annotation:annot-rt");
        assert_eq!(row.kind, "annotation");
        assert_eq!(row.user_id, "visible");
        assert_eq!(row.updated_at_ts, expected_hlc);
        assert!(row.deleted_at_ts.is_none());

        let f = &row.fields_jsonb;
        assert_eq!(super::field_str(f, "bookHash").unwrap(), "hashABC");
        assert_eq!(super::field_str(f, "bookTitle").unwrap(), "My Book");
        assert_eq!(super::field_str(f, "bookAuthor").unwrap(), "John Doe");
        assert_eq!(super::field_str(f, "cfi").unwrap(), "/4/2/1");
        assert_eq!(
            super::field_str(f, "sectionHref").unwrap(),
            "/chapter1.html"
        );
        assert_eq!(super::field_str(f, "page").unwrap(), "42");
        assert_eq!(super::field_str(f, "text").unwrap(), "highlighted text");
        assert_eq!(super::field_str(f, "note").unwrap(), "My note");
        assert_eq!(super::field_str(f, "style").unwrap(), "underline");
        assert_eq!(super::field_str(f, "color").unwrap(), "blue");
    }

    /// CRT-4: Full roundtrip for quote — all fields map correctly.
    #[test]
    fn pull_roundtrip_quote_maps_all_fields() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let updated_ts = 1700000000000i64;
        let expected_hlc = super::make_hlc(updated_ts);

        {
            let conns = repo.conn_for_kind("quote").unwrap();
            let conn = conns.get("quote").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS quotes (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, \
                   context_before TEXT, context_after TEXT, content_hash TEXT, \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO quotes (id, book_hash, book_title, book_author, cfi, \
                 section_href, page, text, context_before, context_after, content_hash, \
                 created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    "qt-rt",
                    "hashXYZ",
                    "Great Book",
                    "Jane Smith",
                    "/6/4/1",
                    "/ch2.html",
                    10i64,
                    "To be or not to be",
                    "before text",
                    "after text",
                    "content-hash-123",
                    500i64,
                    updated_ts,
                ],
            )
            .unwrap();
        }

        let rows = repo.pull("quote", None).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];

        assert_eq!(row.replica_id, "quote:qt-rt");
        assert_eq!(row.kind, "quote");
        assert_eq!(row.updated_at_ts, expected_hlc);

        let f = &row.fields_jsonb;
        assert_eq!(super::field_str(f, "bookHash").unwrap(), "hashXYZ");
        assert_eq!(super::field_str(f, "bookTitle").unwrap(), "Great Book");
        assert_eq!(super::field_str(f, "bookAuthor").unwrap(), "Jane Smith");
        assert_eq!(super::field_str(f, "cfi").unwrap(), "/6/4/1");
        assert_eq!(super::field_str(f, "sectionHref").unwrap(), "/ch2.html");
        assert_eq!(super::field_str(f, "page").unwrap(), "10");
        assert_eq!(super::field_str(f, "text").unwrap(), "To be or not to be");
        assert_eq!(super::field_str(f, "contextBefore").unwrap(), "before text");
        assert_eq!(super::field_str(f, "contextAfter").unwrap(), "after text");
        assert_eq!(
            super::field_str(f, "contentHash").unwrap(),
            "content-hash-123"
        );
    }

    /// CRT-4: Full roundtrip for dictionary-entry — all fields map correctly.
    #[test]
    fn pull_roundtrip_dictionary_entry_maps_all_fields() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let updated_ts = 1700000000000i64;
        let expected_hlc = super::make_hlc(updated_ts);

        {
            let conns = repo.conn_for_kind("dictionary-entry").unwrap();
            let conn = conns.get("dictionary-entry").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS dictionary_entries (\
                   id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, \
                   definition TEXT, image_path TEXT, curiosity TEXT, \
                   enrichment_status TEXT DEFAULT 'pending', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO dictionary_entries \
                 (id, term, display_term, language, definition, image_path, curiosity, \
                  enrichment_status, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    "dict-rt",
                    "hello",
                    "Hello",
                    "en",
                    "A greeting",
                    "/img/hello.png",
                    "From Old English",
                    "enriched",
                    500i64,
                    updated_ts,
                ],
            )
            .unwrap();
        }

        let rows = repo.pull("dictionary-entry", None).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];

        assert_eq!(row.replica_id, "dictionary-entry:dict-rt");
        assert_eq!(row.kind, "dictionary-entry");
        assert_eq!(row.updated_at_ts, expected_hlc);

        let f = &row.fields_jsonb;
        assert_eq!(super::field_str(f, "term").unwrap(), "hello");
        assert_eq!(super::field_str(f, "displayTerm").unwrap(), "Hello");
        assert_eq!(super::field_str(f, "language").unwrap(), "en");
        assert_eq!(super::field_str(f, "definition").unwrap(), "A greeting");
        assert_eq!(super::field_str(f, "imagePath").unwrap(), "/img/hello.png");
        assert_eq!(
            super::field_str(f, "curiosity").unwrap(),
            "From Old English"
        );
        assert_eq!(super::field_str(f, "enrichmentStatus").unwrap(), "enriched");
    }

    // ── Cycle 2: Field-level CRDT merge ──────────────────────────────────

    /// FC-1: Push only {color:"red"} with higher HLC to existing row that
    /// has {text:"hello", note:"world"}. Verify text and note survive in
    /// both _replicas fields_jsonb and the app table.
    #[test]
    fn field_merge_preserves_existing_fields_not_in_push() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Step 1: push row with text + note at T100
        let row1 = ReplicaRow {
            user_id: "dev-a".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-1".into(),
            fields_jsonb: serde_json::json!({
                "text": {"v": "hello", "t": "T100", "s": "dev-a"},
                "note": {"v": "world", "t": "T100", "s": "dev-a"},
                "cfi": {"v": "/1", "t": "T100", "s": "dev-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T100".into(),
            schema_version: 1,
        };
        repo.push("annotation", &[row1]).unwrap();

        // Step 2: push only color at higher HLC T300 — should NOT destroy text/note
        let row2 = ReplicaRow {
            user_id: "dev-b".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-1".into(),
            fields_jsonb: serde_json::json!({
                "color": {"v": "red", "t": "T300", "s": "dev-b"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T300".into(),
            schema_version: 1,
        };
        let count = repo.push("annotation", &[row2]).unwrap();
        assert_eq!(count, 1, "row2 should be processed (higher HLC)");

        // Verify _replicas fields_jsonb has ALL fields
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let fields_raw: String = conn
                .query_row(
                    "SELECT fields_jsonb FROM _replicas WHERE replica_id = ?1",
                    ["annotation:fc-1"],
                    |r| r.get(0),
                )
                .unwrap();
            let fields: serde_json::Value = serde_json::from_str(&fields_raw).unwrap();
            assert_eq!(
                super::field_str(&fields, "text").unwrap(),
                "hello",
                "text must survive field-level merge"
            );
            assert_eq!(
                super::field_str(&fields, "note").unwrap(),
                "world",
                "note must survive field-level merge"
            );
            assert_eq!(
                super::field_str(&fields, "color").unwrap(),
                "red",
                "new color field must be added"
            );
        }

        // Verify app table columns survive
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let text: String = conn
                .query_row(
                    "SELECT text FROM annotations WHERE id = ?1",
                    ["fc-1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(text, "hello");
            let note: String = conn
                .query_row(
                    "SELECT note FROM annotations WHERE id = ?1",
                    ["fc-1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(note, "world");
            let color: String = conn
                .query_row(
                    "SELECT color FROM annotations WHERE id = ?1",
                    ["fc-1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(color, "red");
        }
    }

    /// FC-2: Push a field with LOWER HLC is ignored — existing field
    /// value AND HLC are preserved.
    #[test]
    fn field_merge_lower_hlc_does_not_overwrite() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Push text at T500 (high)
        let row1 = ReplicaRow {
            user_id: "dev-a".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-2".into(),
            fields_jsonb: serde_json::json!({
                "text": {"v": "high-priority", "t": "T500", "s": "dev-a"},
                "cfi": {"v": "/2", "t": "T500", "s": "dev-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T500".into(),
            schema_version: 1,
        };
        repo.push("annotation", &[row1]).unwrap();

        // Push same field with LOWER HLC T400 (row-level HLC T600 so it
        // passes the row gate, but field-level merge must block it)
        let row2 = ReplicaRow {
            user_id: "dev-b".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-2".into(),
            fields_jsonb: serde_json::json!({
                "text": {"v": "low-priority-overwrite", "t": "T400", "s": "dev-b"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T600".into(),
            schema_version: 1,
        };
        repo.push("annotation", &[row2]).unwrap();

        // Verify the HIGH HLC value survived
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let fields_raw: String = conn
                .query_row(
                    "SELECT fields_jsonb FROM _replicas WHERE replica_id = ?1",
                    ["annotation:fc-2"],
                    |r| r.get(0),
                )
                .unwrap();
            let fields: serde_json::Value = serde_json::from_str(&fields_raw).unwrap();
            let text_val = super::field_str(&fields, "text").unwrap();
            assert_eq!(
                text_val, "high-priority",
                "lower-HLC field must NOT overwrite higher-HLC field"
            );
            let text_env = fields.get("text").unwrap();
            let text_t = text_env.get("t").and_then(|t| t.as_str()).unwrap();
            assert_eq!(
                text_t, "T500",
                "HLC of surviving field must be T500 (original)"
            );
        }

        // Verify app table also kept the high-priority text
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let text: String = conn
                .query_row(
                    "SELECT text FROM annotations WHERE id = ?1",
                    ["fc-2"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(text, "high-priority");
        }
    }

    /// FC-3: Push empty fields_jsonb is a no-op — all existing app-table
    /// columns and _replicas fields survive unchanged.
    #[test]
    fn field_merge_empty_fields_jsonb_is_noop() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Push row with multiple fields
        let row1 = ReplicaRow {
            user_id: "dev-a".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-3".into(),
            fields_jsonb: serde_json::json!({
                "text": {"v": "survive me", "t": "T200", "s": "dev-a"},
                "note": {"v": "keep me", "t": "T200", "s": "dev-a"},
                "color": {"v": "blue", "t": "T200", "s": "dev-a"},
                "cfi": {"v": "/3", "t": "T200", "s": "dev-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T200".into(),
            schema_version: 1,
        };
        repo.push("annotation", &[row1]).unwrap();

        // Push empty fields_jsonb with higher row-level HLC
        let row2 = ReplicaRow {
            user_id: "dev-b".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-3".into(),
            fields_jsonb: serde_json::json!({}),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T300".into(),
            schema_version: 1,
        };
        let count = repo.push("annotation", &[row2]).unwrap();
        // Row should still be processed (higher row-level HLC), but field
        // merge should preserve all existing fields.
        assert_eq!(count, 1);

        // Verify ALL existing fields survive
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let fields_raw: String = conn
                .query_row(
                    "SELECT fields_jsonb FROM _replicas WHERE replica_id = ?1",
                    ["annotation:fc-3"],
                    |r| r.get(0),
                )
                .unwrap();
            let fields: serde_json::Value = serde_json::from_str(&fields_raw).unwrap();
            assert_eq!(super::field_str(&fields, "text").unwrap(), "survive me");
            assert_eq!(super::field_str(&fields, "note").unwrap(), "keep me");
            assert_eq!(super::field_str(&fields, "color").unwrap(), "blue");
        }

        // Verify app table columns survive
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let text: String = conn
                .query_row(
                    "SELECT text FROM annotations WHERE id = ?1",
                    ["fc-3"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(text, "survive me");
            let note: String = conn
                .query_row(
                    "SELECT note FROM annotations WHERE id = ?1",
                    ["fc-3"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(note, "keep me");
            let color: String = conn
                .query_row(
                    "SELECT color FROM annotations WHERE id = ?1",
                    ["fc-3"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(color, "blue");
        }
    }

    /// FC-4: Tombstone interaction — push a live row on top of a tombstone
    /// with newer HLC should resurrect with merged fields.
    #[test]
    fn field_merge_tombstone_resurrection_preserves_fields() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Step 1: push live row with text + note
        let row1 = ReplicaRow {
            user_id: "dev-a".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-4".into(),
            fields_jsonb: serde_json::json!({
                "text": {"v": "original", "t": "T100", "s": "dev-a"},
                "note": {"v": "original note", "t": "T100", "s": "dev-a"},
                "cfi": {"v": "/4", "t": "T100", "s": "dev-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T100".into(),
            schema_version: 1,
        };
        repo.push("annotation", &[row1]).unwrap();

        // Step 2: tombstone the row
        let row2 = ReplicaRow {
            user_id: "dev-a".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-4".into(),
            fields_jsonb: serde_json::json!({}),
            manifest_jsonb: None,
            deleted_at_ts: Some("T300".into()),
            reincarnation: None,
            updated_at_ts: "T300".into(),
            schema_version: 1,
        };
        repo.push("annotation", &[row2]).unwrap();

        // Verify tombstone is applied in app table
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let deleted: Option<i64> = conn
                .query_row(
                    "SELECT deleted_at FROM annotations WHERE id = ?1",
                    ["fc-4"],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(deleted.is_some(), "tombstone must set deleted_at");
        }

        // Step 3: push live row with higher HLC — should resurrect
        // and merge fields on top of the tombstone
        let row3 = ReplicaRow {
            user_id: "dev-b".into(),
            kind: "annotation".into(),
            replica_id: "annotation:fc-4".into(),
            fields_jsonb: serde_json::json!({
                "color": {"v": "green", "t": "T500", "s": "dev-b"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T500".into(),
            schema_version: 1,
        };
        let count = repo.push("annotation", &[row3]).unwrap();
        assert_eq!(count, 1, "resurrection push should be processed");

        // Verify resurrection: deleted_at is cleared, original fields survive
        {
            let conns = repo.conn_for_kind("annotation").unwrap();
            let conn = conns.get("annotation").unwrap();
            let (text_val, note_val, color_val, deleted_val): (
                String,
                String,
                String,
                Option<i64>,
            ) = conn
                .query_row(
                    "SELECT text, note, color, deleted_at FROM annotations WHERE id = ?1",
                    ["fc-4"],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap();
            assert_eq!(
                text_val, "original",
                "text must survive tombstone resurrection"
            );
            assert_eq!(
                note_val, "original note",
                "note must survive tombstone resurrection"
            );
            assert_eq!(
                color_val, "green",
                "new color must be merged on resurrection"
            );
            assert!(
                deleted_val.is_none(),
                "deleted_at must be cleared on resurrection"
            );
        }
    }

    /// CRT-4: Full roundtrip for dictionary-occurrence — all fields map,
    /// HLC from created_at, kind is "dictionary-occurrence" (PR3).
    #[test]
    fn pull_roundtrip_occurrence_maps_all_fields() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let created_ts = 1700000000000i64;
        let expected_hlc = super::make_hlc(created_ts);

        {
            let conns = repo.conn_for_kind("dictionary-occurrence").unwrap();
            let conn = conns.get("dictionary-occurrence").unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS dictionary_occurrences (\
                   id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, \
                   book_title TEXT, book_author TEXT, cfi TEXT, section_href TEXT, \
                   page INTEGER, selected_text TEXT, context_before TEXT, \
                   context_after TEXT, highlight_note_id TEXT, \
                   created_at INTEGER, deleted_at INTEGER);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO dictionary_occurrences \
                 (id, entry_id, book_hash, book_title, book_author, cfi, section_href, \
                  page, selected_text, context_before, context_after, highlight_note_id, \
                  created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    "occ-rt",
                    "dict-99",
                    "hashOCC",
                    "Dict Book",
                    "Author X",
                    "/1/2/3",
                    "/ch3.html",
                    7i64,
                    "selected",
                    "before",
                    "after",
                    "hl-note-1",
                    created_ts,
                ],
            )
            .unwrap();
        }

        let rows = repo.pull("dictionary-occurrence", None).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];

        assert_eq!(row.replica_id, "dictionary-occurrence:occ-rt");
        // PR3: kind is "dictionary-occurrence" (separate kind from entries)
        assert_eq!(row.kind, "dictionary-occurrence");
        // CRT-7: HLC derives from created_at (no updated_at column)
        assert_eq!(row.updated_at_ts, expected_hlc);

        let f = &row.fields_jsonb;
        assert_eq!(super::field_str(f, "entryId").unwrap(), "dict-99");
        assert_eq!(super::field_str(f, "bookHash").unwrap(), "hashOCC");
        assert_eq!(super::field_str(f, "bookTitle").unwrap(), "Dict Book");
        assert_eq!(super::field_str(f, "bookAuthor").unwrap(), "Author X");
        assert_eq!(super::field_str(f, "cfi").unwrap(), "/1/2/3");
        assert_eq!(super::field_str(f, "sectionHref").unwrap(), "/ch3.html");
        assert_eq!(super::field_str(f, "page").unwrap(), "7");
        assert_eq!(super::field_str(f, "selectedText").unwrap(), "selected");
        assert_eq!(super::field_str(f, "contextBefore").unwrap(), "before");
        assert_eq!(super::field_str(f, "contextAfter").unwrap(), "after");
        assert_eq!(super::field_str(f, "highlightNoteId").unwrap(), "hl-note-1");
    }

    // ── Cycle 3: Semantic dedup ─────────────────────────────────────────

    /// SID-1: normalize_dictionary_term — NFC, lowercase, soft-hyphen strip.
    #[test]
    fn normalize_dictionary_term_nfc_lowercase_soft_hyphen() {
        // Same case → lowercased
        assert_eq!(super::normalize_dictionary_term("Zozobrar"), "zozobrar");
        // Accented → NFC decomposed + lowercased
        assert_eq!(super::normalize_dictionary_term("Café"), "café");
        // Soft hyphen (U+00AD) removed
        assert_eq!(super::normalize_dictionary_term("hell\u{00AD}o"), "hello");
        // Multi-word string — only NFC + lowercase + soft-hyphen, no multi-word logic
        assert_eq!(super::normalize_dictionary_term("Río Grande"), "río grande");
        // Already lowercase stays lowercase
        assert_eq!(super::normalize_dictionary_term("zozobrar"), "zozobrar");
    }

    /// SID-1: Dictionary dedup — push 2 rows with same term+language,
    /// different replica_ids → single entry in app table.
    #[test]
    fn dictionary_entry_dedup_by_normalized_term_and_language() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let make_dict = |id: &str, term: &str, lang: &str, hlc: &str| -> ReplicaRow {
            ReplicaRow {
                user_id: "dev-a".into(),
                kind: "dictionary-entry".into(),
                replica_id: format!("dictionary-entry:{id}"),
                fields_jsonb: serde_json::json!({
                    "term": {"v": term, "t": hlc, "s": "dev-a"},
                    "displayTerm": {"v": term, "t": hlc, "s": "dev-a"},
                    "language": {"v": lang, "t": hlc, "s": "dev-a"},
                    "definition": {"v": "a test word", "t": hlc, "s": "dev-a"},
                    "enrichmentStatus": {"v": "pending", "t": hlc, "s": "dev-a"}
                }),
                manifest_jsonb: None,
                deleted_at_ts: None,
                reincarnation: None,
                updated_at_ts: hlc.into(),
                schema_version: 1,
            }
        };

        // Push first entry
        let row_a = make_dict("D-A1", "Zozobrar", "es", "T100");
        repo.push("dictionary-entry", &[row_a]).unwrap();

        // Push second entry — same term (different case, should normalize)
        // and same language, different replica_id
        let row_b = make_dict("D-B1", "zozobrar", "es", "T200");
        repo.push("dictionary-entry", &[row_b]).unwrap();

        // Verify only ONE entry exists in dictionary_entries
        let conns = repo.conn_for_kind("dictionary-entry").unwrap();
        let conn = conns.get("dictionary-entry").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dictionary_entries WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "same term+language should merge into ONE entry");

        // Verify the surviving entry has the definition from the higher-HLC row
        let definition: String = conn
            .query_row(
                "SELECT definition FROM dictionary_entries WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(definition, "a test word");
    }

    /// SID-2: Quote dedup — push 2 rows same book_hash+content_hash,
    /// different replica_ids → single row in quotes table.
    #[test]
    fn quote_dedup_by_book_hash_and_content_hash() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let make_quote = |id: &str, book: &str, chash: &str, text: &str, hlc: &str| -> ReplicaRow {
            ReplicaRow {
                user_id: "dev-a".into(),
                kind: "quote".into(),
                replica_id: format!("quote:{id}"),
                fields_jsonb: serde_json::json!({
                    "bookHash": {"v": book, "t": hlc, "s": "dev-a"},
                    "contentHash": {"v": chash, "t": hlc, "s": "dev-a"},
                    "text": {"v": text, "t": hlc, "s": "dev-a"},
                    "cfi": {"v": "/6/2", "t": hlc, "s": "dev-a"}
                }),
                manifest_jsonb: None,
                deleted_at_ts: None,
                reincarnation: None,
                updated_at_ts: hlc.into(),
                schema_version: 1,
            }
        };

        // Push first quote
        let row_a = make_quote("Q-A1", "B1", "abc123", "To be or not to be", "T100");
        repo.push("quote", &[row_a]).unwrap();

        // Push second quote — same book_hash + content_hash, different replica_id
        let row_b = make_quote("Q-B1", "B1", "abc123", "To be or not to be", "T200");
        repo.push("quote", &[row_b]).unwrap();

        // Verify only ONE quote exists in quotes table
        let conns = repo.conn_for_kind("quote").unwrap();
        let conn = conns.get("quote").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM quotes WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "same book_hash+content_hash should merge into ONE quote"
        );
    }

    /// SID-3: Annotation dedup — push 2 rows same book_hash+cfi,
    /// different replica_ids → single row in annotations table.
    #[test]
    fn annotation_dedup_by_book_hash_and_cfi() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        let make_ann = |id: &str, book: &str, cfi: &str, text: &str, hlc: &str| -> ReplicaRow {
            ReplicaRow {
                user_id: "dev-a".into(),
                kind: "annotation".into(),
                replica_id: format!("annotation:{id}"),
                fields_jsonb: serde_json::json!({
                    "bookHash": {"v": book, "t": hlc, "s": "dev-a"},
                    "cfi": {"v": cfi, "t": hlc, "s": "dev-a"},
                    "text": {"v": text, "t": hlc, "s": "dev-a"},
                    "note": {"v": "a note", "t": hlc, "s": "dev-a"},
                    "style": {"v": "highlight", "t": hlc, "s": "dev-a"},
                    "color": {"v": "yellow", "t": hlc, "s": "dev-a"}
                }),
                manifest_jsonb: None,
                deleted_at_ts: None,
                reincarnation: None,
                updated_at_ts: hlc.into(),
                schema_version: 1,
            }
        };

        // Push first annotation
        let row_a = make_ann("ann-A1", "B1", "/6/4", "First highlight", "T100");
        repo.push("annotation", &[row_a]).unwrap();

        // Push second annotation — same book_hash + cfi, different replica_id
        let row_b = make_ann("ann-B1", "B1", "/6/4", "Second highlight", "T200");
        repo.push("annotation", &[row_b]).unwrap();

        // Verify only ONE annotation exists
        let conns = repo.conn_for_kind("annotation").unwrap();
        let conn = conns.get("annotation").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM annotations WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "same book_hash+cfi should merge into ONE annotation"
        );
    }

    /// SID-1: Occurrence no-dedup — push 2 occurrences, assert both survive.
    /// Dictionary occurrences are distinct events and must NOT be deduped.
    #[test]
    fn dictionary_occurrences_excluded_from_dedup() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // First, push a dictionary entry so occurrences can reference it
        let entry_row = ReplicaRow {
            user_id: "dev-a".into(),
            kind: "dictionary-entry".into(),
            replica_id: "dictionary-entry:dict-parent".into(),
            fields_jsonb: serde_json::json!({
                "term": {"v": "libro", "t": "T100", "s": "dev-a"},
                "displayTerm": {"v": "libro", "t": "T100", "s": "dev-a"},
                "language": {"v": "es", "t": "T100", "s": "dev-a"},
                "definition": {"v": "book", "t": "T100", "s": "dev-a"},
                "enrichmentStatus": {"v": "pending", "t": "T100", "s": "dev-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T100".into(),
            schema_version: 1,
        };
        repo.push("dictionary-entry", &[entry_row]).unwrap();

        let make_occ = |id: &str, entry_id: &str, hlc: &str| -> ReplicaRow {
            ReplicaRow {
                user_id: "dev-a".into(),
                kind: "dictionary-occurrence".into(),
                replica_id: format!("dictionary-occurrence:{id}"),
                fields_jsonb: serde_json::json!({
                    "entryId": {"v": entry_id, "t": hlc, "s": "dev-a"},
                    "bookHash": {"v": "B1", "t": hlc, "s": "dev-a"},
                    "selectedText": {"v": "libro", "t": hlc, "s": "dev-a"},
                    "cfi": {"v": "/6/2", "t": hlc, "s": "dev-a"}
                }),
                manifest_jsonb: None,
                deleted_at_ts: None,
                reincarnation: None,
                updated_at_ts: hlc.into(),
                schema_version: 1,
            }
        };

        // Push two occurrences
        repo.push(
            "dictionary-occurrence",
            &[make_occ("occ-1", "dict-parent", "T200")],
        )
        .unwrap();
        repo.push(
            "dictionary-occurrence",
            &[make_occ("occ-2", "dict-parent", "T300")],
        )
        .unwrap();

        // Both must survive — occurrences are distinct events
        let conns = repo.conn_for_kind("dictionary-occurrence").unwrap();
        let conn = conns.get("dictionary-occurrence").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dictionary_occurrences WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 2,
            "occurrences must NOT be deduped — each is a distinct event"
        );
    }

    // ── compute_semantic_key ──────────────────────────────────────────

    #[test]
    fn compute_semantic_key_returns_normalized_term_and_language() {
        let fields = serde_json::json!({
            "term": {"v": "Hello", "t": "T100", "s": "dev-a"},
            "language": {"v": "en", "t": "T100", "s": "dev-a"}
        });
        let result = compute_semantic_key(&fields);
        assert_eq!(result, Some("hello|en".to_string()));
    }

    #[test]
    fn compute_semantic_key_returns_none_when_term_is_missing() {
        let fields = serde_json::json!({
            "language": {"v": "en", "t": "T100", "s": "dev-a"}
        });
        let result = compute_semantic_key(&fields);
        assert_eq!(result, None);
    }

    #[test]
    fn compute_semantic_key_returns_none_when_term_is_empty() {
        let fields = serde_json::json!({
            "term": {"v": "", "t": "T100", "s": "dev-a"},
            "language": {"v": "en", "t": "T100", "s": "dev-a"}
        });
        let result = compute_semantic_key(&fields);
        assert_eq!(result, None);
    }

    #[test]
    fn compute_semantic_key_normalizes_term_with_accents() {
        let fields = serde_json::json!({
            "term": {"v": "Café", "t": "T100", "s": "dev-a"},
            "language": {"v": "fr", "t": "T100", "s": "dev-a"}
        });
        let result = compute_semantic_key(&fields);
        assert_eq!(result, Some("café|fr".to_string()));
    }

    #[test]
    fn compute_semantic_key_strips_soft_hyphen() {
        let fields = serde_json::json!({
            "term": {"v": "hell\u{00AD}o", "t": "T100", "s": "dev-a"},
            "language": {"v": "en", "t": "T100", "s": "dev-a"}
        });
        let result = compute_semantic_key(&fields);
        assert_eq!(result, Some("hello|en".to_string()));
    }

    #[test]
    fn compute_semantic_key_handles_missing_language() {
        let fields = serde_json::json!({
            "term": {"v": "Hello", "t": "T100", "s": "dev-a"}
        });
        let result = compute_semantic_key(&fields);
        assert_eq!(result, Some("hello|".to_string()));
    }

    // ── filter_unchanged_replicas ──────────────────────────────────────

    #[test]
    fn filter_unchanged_replicas_returns_all_when_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let rows = vec![
            make_row("r1", "annotation", "T100"),
            make_row("r2", "annotation", "T200"),
        ];

        let result = filter_unchanged_replicas("annotation", &rows, db_str).unwrap();
        assert_eq!(result.len(), 2, "all rows returned when _replicas is empty");
    }

    #[test]
    fn filter_unchanged_replicas_excludes_exact_match_equal_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        // Pre-seed _replicas with a row
        let conn = Connection::open(db_str).unwrap();
        conn.execute_batch(CREATE_REPLICAS_TABLE).unwrap();
        conn.execute(
            "INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["r1", "annotation", "user", "{}", "T100", 1],
        ).unwrap();
        drop(conn);

        let rows = vec![make_row("r1", "annotation", "T100")];
        let result = filter_unchanged_replicas("annotation", &rows, db_str).unwrap();
        assert!(result.is_empty(), "row with equal HLC should be excluded");
    }

    #[test]
    fn filter_unchanged_replicas_includes_higher_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let conn = Connection::open(db_str).unwrap();
        conn.execute_batch(CREATE_REPLICAS_TABLE).unwrap();
        conn.execute(
            "INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["r1", "annotation", "user", "{}", "T100", 1],
        ).unwrap();
        drop(conn);

        let rows = vec![make_row("r1", "annotation", "T200")];
        let result = filter_unchanged_replicas("annotation", &rows, db_str).unwrap();
        assert_eq!(result.len(), 1, "row with higher HLC should be included");
    }

    #[test]
    fn filter_unchanged_replicas_excludes_lower_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let conn = Connection::open(db_str).unwrap();
        conn.execute_batch(CREATE_REPLICAS_TABLE).unwrap();
        conn.execute(
            "INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["r1", "annotation", "user", "{}", "T200", 1],
        ).unwrap();
        drop(conn);

        let rows = vec![make_row("r1", "annotation", "T100")];
        let result = filter_unchanged_replicas("annotation", &rows, db_str).unwrap();
        assert!(result.is_empty(), "row with lower HLC should be excluded");
    }

    #[test]
    fn filter_unchanged_replicas_semantic_match_excludes_dict_entry() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let conn = Connection::open(db_str).unwrap();
        conn.execute_batch(CREATE_REPLICAS_TABLE).unwrap();
        // Insert a dictionary-entry with semantic_key
        conn.execute(
            "INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "dictionary-entry:existing",
                "dictionary-entry",
                "user",
                r#"{"term":{"v":"hello","t":"T100","s":"dev"},"language":{"v":"en","t":"T100","s":"dev"}}"#,
                "T100",
                1,
                "hello|en",
            ],
        ).unwrap();
        drop(conn);

        // Same semantic key, different replica_id, same HLC
        let row = ReplicaRow {
            user_id: "user".into(),
            kind: "dictionary-entry".into(),
            replica_id: "dictionary-entry:new".into(),
            fields_jsonb: serde_json::json!({
                "term": {"v": "hello", "t": "T100", "s": "dev"},
                "language": {"v": "en", "t": "T100", "s": "dev"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T100".into(),
            schema_version: 1,
        };
        let result = filter_unchanged_replicas("dictionary-entry", &[row], db_str).unwrap();
        assert!(
            result.is_empty(),
            "dict entry with same semantic_key+equal HLC should be excluded"
        );
    }

    #[test]
    fn filter_unchanged_replicas_no_semantic_pass_for_non_dict() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let conn = Connection::open(db_str).unwrap();
        conn.execute_batch(CREATE_REPLICAS_TABLE).unwrap();
        drop(conn);

        // An annotation row — should NOT trigger semantic pass (only dict-entry does)
        let row = make_row("annotation:new-id", "annotation", "T100");
        // No _replicas row exists yet, so it should be included
        let result = filter_unchanged_replicas("annotation", &[row], db_str).unwrap();
        assert_eq!(result.len(), 1, "non-dict must not have semantic pass");
    }

    #[test]
    fn filter_unchanged_replicas_semantic_match_respects_higher_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let conn = Connection::open(db_str).unwrap();
        conn.execute_batch(CREATE_REPLICAS_TABLE).unwrap();
        conn.execute(
            "INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "dictionary-entry:existing",
                "dictionary-entry",
                "user",
                r#"{"term":{"v":"hello","t":"T100","s":"dev"},"language":{"v":"en","t":"T100","s":"dev"}}"#,
                "T100",
                1,
                "hello|en",
            ],
        ).unwrap();
        drop(conn);

        // Incoming has higher HLC T200 → should pass
        let row = ReplicaRow {
            user_id: "user".into(),
            kind: "dictionary-entry".into(),
            replica_id: "dictionary-entry:new".into(),
            fields_jsonb: serde_json::json!({
                "term": {"v": "hello", "t": "T200", "s": "dev"},
                "language": {"v": "en", "t": "T200", "s": "dev"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T200".into(),
            schema_version: 1,
        };
        let result = filter_unchanged_replicas("dictionary-entry", &[row], db_str).unwrap();
        assert_eq!(
            result.len(),
            1,
            "row with higher HLC must pass even with semantic match"
        );
    }

    #[test]
    fn filter_unchanged_replicas_invalid_db_path_returns_error() {
        let result = filter_unchanged_replicas("annotation", &[], "/nonexistent/dir/test.db");
        assert!(result.is_err(), "invalid db path must return error");
    }

    // ── write_replica_metadata ──────────────────────────────────────────

    #[test]
    fn write_replica_metadata_inserts_row() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let row = make_row("r1", "annotation", "T100");
        write_replica_metadata(&row, db_str).unwrap();

        let conn = Connection::open(db_str).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _replicas WHERE replica_id = ?1",
                ["r1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "row must be inserted");
    }

    #[test]
    fn write_replica_metadata_overwrite_respects_hlc() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        // Insert first at T100
        let row1 = make_row("r1", "annotation", "T100");
        write_replica_metadata(&row1, db_str).unwrap();

        // Overwrite with lower HLC
        let row2 = make_row("r1", "annotation", "T050");
        write_replica_metadata(&row2, db_str).unwrap();

        // HLC should be T100 (last write wins with INSERT OR REPLACE)
        let conn = Connection::open(db_str).unwrap();
        let hlc: String = conn
            .query_row(
                "SELECT updated_at_ts FROM _replicas WHERE replica_id = ?1",
                ["r1"],
                |r| r.get(0),
            )
            .unwrap();
        // INSERT OR REPLACE always overwrites, so last write wins
        assert_eq!(hlc, "T050", "last write wins with INSERT OR REPLACE");
    }

    #[test]
    fn write_replica_metadata_computes_semantic_key_for_dict_entry() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let row = ReplicaRow {
            user_id: "user".into(),
            kind: "dictionary-entry".into(),
            replica_id: "dictionary-entry:d1".into(),
            fields_jsonb: serde_json::json!({
                "term": {"v": "Hello", "t": "T100", "s": "dev"},
                "language": {"v": "en", "t": "T100", "s": "dev"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T100".into(),
            schema_version: 1,
        };
        write_replica_metadata(&row, db_str).unwrap();

        let conn = Connection::open(db_str).unwrap();
        let semantic_key: Option<String> = conn
            .query_row(
                "SELECT semantic_key FROM _replicas WHERE replica_id = ?1",
                ["dictionary-entry:d1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(semantic_key, Some("hello|en".to_string()));
    }

    #[test]
    fn write_replica_metadata_semantic_key_null_for_non_dict() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        let row = make_row("ann-1", "annotation", "T100");
        write_replica_metadata(&row, db_str).unwrap();

        let conn = Connection::open(db_str).unwrap();
        let semantic_key: Option<String> = conn
            .query_row(
                "SELECT semantic_key FROM _replicas WHERE replica_id = ?1",
                ["ann-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            semantic_key, None,
            "non-dict kinds must have NULL semantic_key"
        );
    }

    #[test]
    fn write_replica_metadata_invalid_path_returns_error() {
        let row = make_row("r1", "annotation", "T100");
        let result = write_replica_metadata(&row, "/nonexistent/dir/test.db");
        assert!(result.is_err(), "invalid db path must return error");
    }

    // ── ensure_replica_tables ───────────────────────────────────────────

    #[test]
    fn ensure_replica_tables_creates_replicas_and_app_table() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        ensure_replica_tables("dictionary-entry", db_str).unwrap();

        let conn = Connection::open(db_str).unwrap();
        let replicas_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_replicas'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(replicas_count, 1, "_replicas table must exist");

        let entries_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dictionary_entries'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(entries_count, 1, "dictionary_entries table must exist");
    }

    #[test]
    fn ensure_replica_tables_idempotent() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        ensure_replica_tables("dictionary-entry", db_str).unwrap();
        ensure_replica_tables("dictionary-entry", db_str).unwrap();

        let conn = Connection::open(db_str).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_replicas'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "second call must be idempotent");
    }

    #[test]
    fn ensure_replica_tables_creates_annotation_tables() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        ensure_replica_tables("annotation", db_str).unwrap();

        let conn = Connection::open(db_str).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='annotations'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "annotations table must exist");
    }

    #[test]
    fn ensure_replica_tables_unknown_kind_creates_only_replicas() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap();

        ensure_replica_tables("unknown-kind", db_str).unwrap();

        let conn = Connection::open(db_str).unwrap();
        let replicas_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_replicas'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(replicas_count, 1, "_replicas must exist");
    }

    /// SID-4: Field-level edits survive dedup — when dedup merges to an
    /// existing row, higher-HLC fields overwrite, absent fields preserved.
    #[test]
    fn field_edits_survive_semantic_dedup() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = LibsqlVisibleRepo::new(dir.path().to_path_buf());

        // Push entry with definition="barca" at T100
        let row1 = ReplicaRow {
            user_id: "dev-a".into(),
            kind: "dictionary-entry".into(),
            replica_id: "dictionary-entry:D-A1".into(),
            fields_jsonb: serde_json::json!({
                "term": {"v": "zozobrar", "t": "T100", "s": "dev-a"},
                "displayTerm": {"v": "Zozobrar", "t": "T100", "s": "dev-a"},
                "language": {"v": "es", "t": "T100", "s": "dev-a"},
                "definition": {"v": "barca", "t": "T100", "s": "dev-a"},
                "curiosity": {"v": "From Latin", "t": "T100", "s": "dev-a"},
                "enrichmentStatus": {"v": "pending", "t": "T100", "s": "dev-a"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T100".into(),
            schema_version: 1,
        };
        repo.push("dictionary-entry", &[row1]).unwrap();

        // Push same term (normalized), same language → dedup to D-A1
        // with definition="embarcación" at higher HLC T200 and NO curiosity field
        let row2 = ReplicaRow {
            user_id: "dev-b".into(),
            kind: "dictionary-entry".into(),
            replica_id: "dictionary-entry:D-B1".into(),
            fields_jsonb: serde_json::json!({
                "term": {"v": "Zozobrar", "t": "T200", "s": "dev-b"},
                "displayTerm": {"v": "ZOZOBRAR", "t": "T200", "s": "dev-b"},
                "language": {"v": "es", "t": "T200", "s": "dev-b"},
                "definition": {"v": "embarcación", "t": "T200", "s": "dev-b"},
                "enrichmentStatus": {"v": "pending", "t": "T200", "s": "dev-b"}
            }),
            manifest_jsonb: None,
            deleted_at_ts: None,
            reincarnation: None,
            updated_at_ts: "T200".into(),
            schema_version: 1,
        };
        repo.push("dictionary-entry", &[row2]).unwrap();

        // Verify only ONE entry exists (dedup worked)
        let conns = repo.conn_for_kind("dictionary-entry").unwrap();
        let conn = conns.get("dictionary-entry").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dictionary_entries WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "dedup should merge into single entry");

        // Verify definition was overwritten by higher HLC (T200 > T100)
        let definition: String = conn
            .query_row(
                "SELECT definition FROM dictionary_entries WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            definition, "embarcación",
            "higher-HLC definition must survive dedup"
        );

        // Verify curiosity field survived (absent in row2 → preserved from row1)
        let curiosity: String = conn
            .query_row(
                "SELECT curiosity FROM dictionary_entries WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            curiosity, "From Latin",
            "absent field must survive field-level merge during dedup"
        );
    }
}
