/**
 * visible_repo — VisibleRepository trait and LibsqlVisibleRepo implementation.
 *
 * Connects the local sync server directly to the application .db files
 * (annotations.db, citas.db, dictionary.db) that the TypeScript services use.
 * Replaces the isolated JSON shadow files under local-sync/replicas/.
 *
 * ## Architecture
 *
 * - Trait `VisibleRepository`: `pull(kind, since?)`, `push(kind, rows)`, `health()`
 * - Struct `LibsqlVisibleRepo`: opens each .db via rusqlite, sets WAL mode + busy_timeout
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
}

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

/// Maps a replica kind to its database filename.
fn db_file_for_kind(kind: &str) -> &str {
    match kind {
        "annotation" => "annotations.db",
        "quote" => "citas.db",
        "dictionary-entry" => "dictionary.db",
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
        schema_version INTEGER NOT NULL DEFAULT 1
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
    fn conn_for_kind(&self, kind: &str) -> Result<std::sync::MutexGuard<'_, HashMap<String, Connection>>, String> {
        let mut conns = self
            .connections
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if !conns.contains_key(kind) {
            let db_file = db_file_for_kind(kind);
            let db_path = self.app_data_dir.join(db_file);
            let conn = Connection::open(&db_path)
                .map_err(|e| format!("open {db_path:?}: {e}"))?;
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
}

/// Extract the application-level ID from a replica_id by stripping the kind prefix.
/// "annotation:abc123" → "abc123", "dictionary-entry:dict-1" → "dict-1"
fn extract_item_id(replica_id: &str, kind: &str) -> String {
    let prefix = format!("{kind}:");
    replica_id.strip_prefix(&prefix).unwrap_or(replica_id).to_string()
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

/// Extract a string value from a field envelope inside fields_jsonb.
/// Field envelopes are: { "v": value, "t": "HLC", "s": "deviceId" }
fn field_str(fields: &serde_json::Value, key: &str) -> Option<String> {
    fields
        .get(key)
        .and_then(|env| env.get("v"))
        .and_then(|v| {
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
            // Ensure the annotations table exists (created by TS migrations normally)
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS annotations (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', \
                   style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow', \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .map_err(|e| format!("ensure annotations table: {e}"))?;

            tx.execute(
                "INSERT OR REPLACE INTO annotations \
                 (id, book_hash, book_title, book_author, cfi, section_href, page, \
                  text, note, style, color, created_at, updated_at, deleted_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    &item_id,
                    &field_str(fields, "bookHash"),
                    &field_str(fields, "bookTitle"),
                    &field_str(fields, "bookAuthor"),
                    &field_str(fields, "cfi"),
                    &field_str(fields, "sectionHref"),
                    &field_str(fields, "page")
                        .and_then(|s| s.parse::<i64>().ok()),
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
        "quote" => {
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS quotes (\
                   id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, \
                   cfi TEXT, section_href TEXT, page INTEGER, text TEXT, \
                   context_before TEXT, context_after TEXT, content_hash TEXT, \
                   created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
            )
            .map_err(|e| format!("ensure quotes table: {e}"))?;

            tx.execute(
                "INSERT OR REPLACE INTO quotes \
                 (id, book_hash, book_title, book_author, cfi, section_href, page, \
                  text, context_before, context_after, content_hash, \
                  created_at, updated_at, deleted_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    &item_id,
                    &field_str(fields, "bookHash"),
                    &field_str(fields, "bookTitle"),
                    &field_str(fields, "bookAuthor"),
                    &field_str(fields, "cfi"),
                    &field_str(fields, "sectionHref"),
                    &field_str(fields, "page")
                        .and_then(|s| s.parse::<i64>().ok()),
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

                tx.execute(
                    "INSERT OR REPLACE INTO dictionary_occurrences \
                     (id, entry_id, book_hash, book_title, book_author, cfi, \
                      section_href, page, selected_text, context_before, context_after, \
                      highlight_note_id, created_at, deleted_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    rusqlite::params![
                        &item_id,
                        &field_str(fields, "entryId"),
                        &field_str(fields, "bookHash"),
                        &field_str(fields, "bookTitle"),
                        &field_str(fields, "bookAuthor"),
                        &field_str(fields, "cfi"),
                        &field_str(fields, "sectionHref"),
                        &field_str(fields, "page")
                            .and_then(|s| s.parse::<i64>().ok()),
                        &field_str(fields, "selectedText"),
                        &field_str(fields, "contextBefore"),
                        &field_str(fields, "contextAfter"),
                        &field_str(fields, "highlightNoteId"),
                        &now_ms,
                        &deleted_ms,
                    ],
                )
                .map_err(|e| format!("upsert dictionary_occurrence: {e}"))?;
            } else {
                tx.execute_batch(
                    "CREATE TABLE IF NOT EXISTS dictionary_entries (\
                       id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, \
                       definition TEXT, enrichment_status TEXT DEFAULT 'pending', \
                       image_path TEXT, curiosity TEXT, \
                       created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);",
                )
                .map_err(|e| format!("ensure dictionary_entries: {e}"))?;

                tx.execute(
                    "INSERT OR REPLACE INTO dictionary_entries \
                     (id, term, display_term, language, definition, enrichment_status, \
                      image_path, curiosity, created_at, updated_at, deleted_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    rusqlite::params![
                        &item_id,
                        &field_str(fields, "term"),
                        &field_str(fields, "displayTerm"),
                        &field_str(fields, "language"),
                        &field_str(fields, "definition"),
                        &field_str(fields, "enrichmentStatus")
                            .unwrap_or_else(|| "pending".into()),
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

        let sql;
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>>;

        if let Some(since_val) = since {
            sql = "SELECT replica_id, kind, user_id, fields_jsonb, manifest_jsonb, \
                         deleted_at_ts, reincarnation, updated_at_ts, schema_version \
                   FROM _replicas WHERE kind = ?1 AND updated_at_ts > ?2 \
                   ORDER BY updated_at_ts";
            params = vec![
                Box::new(kind.to_string()),
                Box::new(since_val.to_string()),
            ];
        } else {
            sql = "SELECT replica_id, kind, user_id, fields_jsonb, manifest_jsonb, \
                         deleted_at_ts, reincarnation, updated_at_ts, schema_version \
                   FROM _replicas WHERE kind = ?1 \
                   ORDER BY updated_at_ts";
            params = vec![Box::new(kind.to_string())];
        }

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("prepare pull: {e}"))?;

        let row_iter = stmt
            .query_map(param_refs.as_slice(), |row| {
                // Column indices: 0=replica_id, 1=kind, 2=user_id, 3=fields_jsonb,
                // 4=manifest_jsonb, 5=deleted_at_ts, 6=reincarnation,
                // 7=updated_at_ts, 8=schema_version
                let fields_raw: String = row.get(3)?;
                let manifest_raw: Option<String> = row.get(4)?;
                Ok(ReplicaRow {
                    replica_id: row.get(0)?,
                    kind: row.get(1)?,
                    user_id: row.get(2)?,
                    fields_jsonb: serde_json::from_str(&fields_raw).unwrap_or_default(),
                    manifest_jsonb: manifest_raw
                        .and_then(|s| serde_json::from_str(&s).ok()),
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

    fn push(&self, kind: &str, rows: &[ReplicaRow]) -> Result<usize, String> {
        if rows.is_empty() {
            return Ok(0);
        }

        let mut conns = self.conn_for_kind(kind)?;
        let conn = conns
            .get_mut(kind)
            .ok_or_else(|| format!("no connection for kind {kind}"))?;

        let tx = conn
            .transaction()
            .map_err(|e| format!("begin tx: {e}"))?;

        let mut count = 0usize;
        for row in rows {
            // Check if replica already exists with higher/equal HLC
            let existing_hlc: Option<String> = tx
                .query_row(
                    "SELECT updated_at_ts FROM _replicas WHERE replica_id = ?1",
                    [&row.replica_id],
                    |r| r.get(0),
                )
                .ok();

            if let Some(ref existing) = existing_hlc {
                if row.updated_at_ts <= *existing {
                    // HLC not strictly higher → skip this row
                    continue;
                }
            }

            // Serialize fields_jsonb to string for storage
            let fields_str = row.fields_jsonb.to_string();
            let manifest_str = row
                .manifest_jsonb
                .as_ref()
                .map(|m| m.to_string());

            // Upsert into _replicas
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

            // Sync to application table
            sync_to_app_table(&tx, kind, row)?;

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
            assert_eq!(conns.len(), 1, "only one connection should exist for annotation");
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
                .query_row("SELECT text FROM annotations WHERE id = ?1", ["annot-2"], |r| {
                    r.get(0)
                })
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
        repo.push("quote", &[make_row("quote:qx", "quote", "T001")]).unwrap();

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
}
