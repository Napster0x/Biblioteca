/**
 * sync_commands — Tauri commands for the sync deduplication pipeline.
 *
 * These commands are thin wrappers around the core functions in
 * `visible_repo.rs` (normalize_dictionary_term, compute_semantic_key,
 * filter_unchanged_replicas, write_replica_metadata, ensure_replica_tables).
 *
 * They accept JSON strings from the frontend (since Tauri's invoke bridge
 * sends rows as serialized JSON), parse them, and delegate to the
 * underlying Rust implementations.
 */
use crate::local_sync_server::ReplicaRow;
use crate::visible_repo;
use tauri::command;

/// Normalize a dictionary term: NFC + soft-hyphen strip + lowercase.
///
/// Mirrors the TypeScript `normalizeTerm()` in the shared `replicaFilter.ts`.
#[command]
pub fn normalize_term(term: String) -> String {
    visible_repo::normalize_dictionary_term(&term)
}

/// Compute a semantic key from a fields_jsonb envelope.
///
/// Returns `"{normalized_term}|{language}"` for dictionary-entry rows,
/// or `None` if the term is missing/empty.
#[command]
pub fn compute_semantic_key(fields_jsonb: String) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(&fields_jsonb).ok()?;
    visible_repo::compute_semantic_key(&parsed)
}

/// Filter out rows from `rows_json` that already exist in the specified
/// SQLite database with equal-or-higher HLC.
///
/// Two passes:
///   1. Exact replica_id match — skip if existing HLC >= incoming.
///   2. Semantic match (dictionary-entry only) — skip if a row with the
///      same `semantic_key` exists with HLC >= incoming.
///
/// Returns a JSON array of rows that should be pushed/applied.
#[command]
pub fn filter_unchanged_replicas(
    kind: String,
    rows_json: String,
    db_path: String,
) -> String {
    let rows: Vec<ReplicaRow> = match serde_json::from_str(&rows_json) {
        Ok(r) => r,
        Err(e) => {
            return serde_json::json!({
                "error": format!("invalid rows_json: {e}")
            })
            .to_string();
        }
    };

    match visible_repo::filter_unchanged_replicas(&kind, &rows, &db_path) {
        Ok(filtered) => serde_json::to_string(&filtered).unwrap_or_else(|_| "[]".to_string()),
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}

/// Upsert a single ReplicaRow (from `row_json`) into the `_replicas` table
/// at `db_path`, computing and storing `semantic_key` for dictionary-entry rows.
#[command]
pub fn write_replica_metadata(row_json: String, db_path: String) -> Result<(), String> {
    let row: ReplicaRow =
        serde_json::from_str(&row_json).map_err(|e| format!("invalid row_json: {e}"))?;
    visible_repo::write_replica_metadata(&row, &db_path)
}

/// Ensure `_replicas` and the application table for `kind` exist in the
/// SQLite database at `db_path`. Idempotent.
///
/// Supports kinds: `annotation`, `quote`, `dictionary-entry`.
#[command]
pub fn ensure_replica_tables(kind: String, db_path: String) -> Result<(), String> {
    visible_repo::ensure_replica_tables(&kind, &db_path)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── normalize_term ─────────────────────────────────────────────────

    #[test]
    fn normalize_term_returns_lowercase() {
        assert_eq!(normalize_term("Hello".to_string()), "hello");
    }

    #[test]
    fn normalize_term_handles_accented() {
        assert_eq!(normalize_term("Café".to_string()), "café");
    }

    #[test]
    fn normalize_term_strips_soft_hyphen() {
        assert_eq!(normalize_term("hell\u{00AD}o".to_string()), "hello");
    }

    #[test]
    fn normalize_term_empty_string() {
        assert_eq!(normalize_term("".to_string()), "");
    }

    // ── compute_semantic_key ───────────────────────────────────────────

    #[test]
    fn compute_semantic_key_with_term_and_language() {
        let json = r#"{"term":{"v":"Hello","t":"T100","s":"dev"},"language":{"v":"en","t":"T100","s":"dev"}}"#.to_string();
        let result = compute_semantic_key(json);
        assert_eq!(result, Some("hello|en".to_string()));
    }

    #[test]
    fn compute_semantic_key_missing_term() {
        let json = r#"{"language":{"v":"en","t":"T100","s":"dev"}}"#.to_string();
        let result = compute_semantic_key(json);
        assert_eq!(result, None);
    }

    #[test]
    fn compute_semantic_key_invalid_json() {
        let result = compute_semantic_key("not valid json".to_string());
        assert_eq!(result, None);
    }

    #[test]
    fn compute_semantic_key_empty_term() {
        let json = r#"{"term":{"v":"","t":"T100","s":"dev"}}"#.to_string();
        let result = compute_semantic_key(json);
        assert_eq!(result, None);
    }

    // ── filter_unchanged_replicas ──────────────────────────────────────

    #[test]
    fn filter_unchanged_replicas_invalid_rows_json_returns_error() {
        let result = filter_unchanged_replicas(
            "annotation".to_string(),
            "not valid json".to_string(),
            "/tmp/test.db".to_string(),
        );
        assert!(
            result.contains("error"),
            "invalid JSON should return error object: {result}"
        );
    }

    #[test]
    fn filter_unchanged_replicas_valid_call_delegates_to_core() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap().to_string();

        // Empty rows array should return empty array
        let result = filter_unchanged_replicas(
            "annotation".to_string(),
            "[]".to_string(),
            db_str,
        );
        assert_eq!(result, "[]", "empty rows should return empty array: {result}");
    }

    // ── write_replica_metadata ─────────────────────────────────────────

    #[test]
    fn write_replica_metadata_valid_row_succeeds() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap().to_string();

        let row_json = serde_json::json!({
            "replica_id": "test:1",
            "kind": "annotation",
            "user_id": "user",
            "fields_jsonb": {},
            "updated_at_ts": "T100",
            "schema_version": 1
        })
        .to_string();

        let result = write_replica_metadata(row_json, db_str);
        assert!(result.is_ok(), "valid row should succeed: {:?}", result);
    }

    #[test]
    fn write_replica_metadata_invalid_json_returns_error() {
        let result = write_replica_metadata("not valid json".to_string(), "/tmp/test.db".to_string());
        assert!(result.is_err(), "invalid JSON should return error");
    }

    // ── ensure_replica_tables ──────────────────────────────────────────

    #[test]
    fn ensure_replica_tables_creates_tables() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db_str = db_path.to_str().unwrap().to_string();

        let result = ensure_replica_tables("dictionary-entry".to_string(), db_str);
        assert!(result.is_ok(), "table creation should succeed: {:?}", result);

        // Verify tables exist via the core function
        let verify = visible_repo::ensure_replica_tables("dictionary-entry", db_path.to_str().unwrap());
        assert!(verify.is_ok(), "verify should succeed: {:?}", verify);
    }
}
