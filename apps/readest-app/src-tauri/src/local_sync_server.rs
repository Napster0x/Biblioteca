/**
 * local_sync_server — embedded HTTP server for peer-to-peer local sync.
 *
 * Serves and accepts ReplicaRow JSON arrays so WiFi/USB peers can pull
 * and push CRDT data without an intermediate cloud service.
 *
 * ## Endpoints
 *
 *   GET  /health                        → { status: "ok", deviceName }
 *   GET  /replicas/:kind                 → ReplicaRow[] filtered by kind + ?since=HLC
 *   PUT  /replicas/:kind                 → merges incoming rows by replica_id (HLC wins)
 *   GET  /dictionary-images/:entryId     → binary PNG (404 if absent)
 *   PUT  /dictionary-images/:entryId     → write raw PNG body to disk
 *
 * ## Architecture
 *
 * The server runs on a dedicated `std::thread` with a 500ms request
 * timeout so the shutdown flag is checked regularly. Replica state is
 * persisted as per-kind JSON files in `{data_dir}/local-sync/replicas/`.
 * The TypeScript side bridges the turso database ↔ JSON files in Phase 4.
 */
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

// ── Models ────────────────────────────────────────────────────────────────

/// Mirror of the TypeScript `ReplicaRow` interface (src/types/replica.ts).
/// All HLC fields are strings because HLCs are lexicographically comparable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicaRow {
    pub user_id: String,
    pub kind: String,
    pub replica_id: String,
    #[serde(default)]
    pub fields_jsonb: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_jsonb: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ts: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reincarnation: Option<String>,
    pub updated_at_ts: String,
    pub schema_version: u32,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    #[serde(rename = "deviceName")]
    device_name: String,
}

// ── Server ────────────────────────────────────────────────────────────────

/// A background HTTP server for local peer-to-peer sync.
///
/// Spawned on a dedicated thread. Stopped gracefully via the internal
/// `AtomicBool` flag, checked every 500ms between requests.
pub struct SyncServer {
    running: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    port: u16,
}

impl SyncServer {
    /// Start the server listening on `0.0.0.0:{port}`.
    ///
    /// `replicas_dir` is the directory where per-kind JSON files are stored
    /// (created if missing). `device_name` is returned in `/health` responses.
    pub fn start(port: u16, replicas_dir: PathBuf, device_name: String) -> Result<Self, String> {
        fs::create_dir_all(&replicas_dir)
            .map_err(|e| format!("Cannot create replicas dir: {e}"))?;

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = Arc::clone(&running);

        let server = Server::http(format!("0.0.0.0:{port}"))
            .map_err(|e| format!("Port {port} is in use or unavailable: {e}"))?;

        let handle = thread::spawn(move || {
            while running_clone.load(Ordering::Relaxed) {
                match server.recv_timeout(Duration::from_millis(500)) {
                    Ok(Some(req)) => {
                        // Catch panics from request handling to prevent
                        // the server thread from crashing the whole app.
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            handle_request(req, &replicas_dir, &device_name);
                        }));
                    }
                    Ok(None) => { /* timeout — check running flag */ }
                    Err(_) => break,
                }
            }
        });

        Ok(SyncServer {
            running,
            handle: Some(handle),
            port,
        })
    }

    /// Signal shutdown and wait for the server thread to exit.
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }

    #[allow(dead_code)]
    pub fn port(&self) -> u16 {
        self.port
    }
}

// ── Routing ───────────────────────────────────────────────────────────────

enum Route {
    Health,
    Replicas(String),
    DictionaryImages(String),
    NotFound,
}

fn parse_route(url: &str) -> Route {
    let path = url.split('?').next().unwrap_or(url);

    if path == "/health" {
        return Route::Health;
    }

    if let Some(rest) = path.strip_prefix("/replicas/") {
        let kind = rest.trim_end_matches('/');
        let kind = kind.strip_suffix(".json").unwrap_or(kind);
        if !kind.is_empty()
            && kind
                .chars()
                .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        {
            return Route::Replicas(kind.to_string());
        }
    }

    if let Some(rest) = path.strip_prefix("/dictionary-images/") {
        let entry_id = rest.trim_end_matches('/');
        if !entry_id.is_empty() {
            return Route::DictionaryImages(entry_id.to_string());
        }
    }

    Route::NotFound
}

fn get_query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    for param in query.split('&') {
        let mut kv = param.splitn(2, '=');
        if kv.next()? == key {
            return Some(percent_decode(kv.next().unwrap_or("")));
        }
    }
    None
}

/// Minimal percent-decode (only needed for `since` HLC values in practice).
fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next().unwrap_or(b'0');
            let lo = chars.next().unwrap_or(b'0');
            if let Ok(decoded) = u8::from_str_radix(&String::from_utf8_lossy(&[hi, lo]), 16) {
                out.push(decoded as char);
            }
        } else if b == b'+' {
            out.push(' ');
        } else {
            out.push(b as char);
        }
    }
    out
}

// ── Request dispatch ──────────────────────────────────────────────────────

fn handle_request(req: Request, replicas_dir: &Path, device_name: &str) {
    let url = req.url().to_string();
    let method = req.method();

    match (method, parse_route(&url)) {
        (&Method::Get, Route::Health) => serve_health(req, device_name),
        (&Method::Get, Route::Replicas(kind)) => {
            let since = get_query_param(&url, "since");
            serve_get_replicas(req, replicas_dir, &kind, since.as_deref());
        }
        (&Method::Put, Route::Replicas(kind)) => {
            serve_put_replicas(req, replicas_dir, &kind);
        }
        (&Method::Get, Route::DictionaryImages(entry_id)) => {
            serve_get_dictionary_image(req, replicas_dir, &entry_id);
        }
        (&Method::Put, Route::DictionaryImages(entry_id)) => {
            serve_put_dictionary_image(req, replicas_dir, &entry_id);
        }
        _ => {
            respond_404(req);
        }
    }
}

fn respond_404(req: Request) {
    let _ = req.respond(Response::from_string("Not Found").with_status_code(StatusCode(404)));
}

// ── Handlers ──────────────────────────────────────────────────────────────

fn serve_health(req: Request, device_name: &str) {
    let body = HealthResponse {
        status: "ok".into(),
        device_name: device_name.into(),
    };
    let json = serde_json::to_string(&body).unwrap_or_else(|_| r#"{"status":"error"}"#.into());
    let resp = Response::from_string(json)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    let _ = req.respond(resp);
}

fn serve_get_replicas(req: Request, dir: &Path, kind: &str, since: Option<&str>) {
    let file_path = replicas_file_path(dir, kind);

    let all_rows: Vec<ReplicaRow> = match load_replicas(&file_path) {
        Ok(rows) => rows,
        Err(_) => {
            // File missing or malformed → empty array (not an error).
            return respond_json(req, "[]");
        }
    };

    // Filter by kind and optional HLC cursor (lexicographic comparison).
    let filtered: Vec<&ReplicaRow> = if let Some(since_val) = since {
        all_rows
            .iter()
            .filter(|r| r.kind == kind && r.updated_at_ts.as_str() > since_val)
            .collect()
    } else {
        all_rows.iter().filter(|r| r.kind == kind).collect()
    };

    let json = serde_json::to_string(&filtered).unwrap_or_else(|_| "[]".into());
    respond_json(req, &json);
}

fn serve_put_replicas(mut req: Request, dir: &Path, kind: &str) {
    let mut body = String::new();
    if let Err(e) = req.as_reader().read_to_string(&mut body) {
        return respond_json_status(
            req,
            &json_error(&format!("Body read failed: {e}")),
            StatusCode(400),
        );
    }

    if body.trim().is_empty() {
        return respond_json_status(req, &json_merge_result(0), StatusCode(200));
    }

    let incoming: Vec<ReplicaRow> = match serde_json::from_str(&body) {
        Ok(rows) => rows,
        Err(e) => {
            return respond_json_status(
                req,
                &json_error(&format!("Invalid JSON: {e}")),
                StatusCode(400),
            );
        }
    };

    let file_path = replicas_file_path(dir, kind);
    match merge_and_save(&file_path, incoming) {
        Ok(count) => respond_json_status(req, &json_merge_result(count), StatusCode(200)),
        Err(e) => respond_json_status(req, &json_error(&e), StatusCode(500)),
    }
}

// ── File I/O ──────────────────────────────────────────────────────────────

fn replicas_file_path(dir: &Path, kind: &str) -> PathBuf {
    dir.join(format!("{kind}.json"))
}

fn load_replicas(path: &Path) -> Result<Vec<ReplicaRow>, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let rows: Vec<ReplicaRow> = serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?;
    Ok(rows)
}

fn merge_and_save(path: &Path, incoming: Vec<ReplicaRow>) -> Result<usize, String> {
    let mut existing: Vec<ReplicaRow> = if path.exists() {
        load_replicas(path).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Index existing rows by replica_id for O(1) lookup
    let mut idx_map: HashMap<String, usize> = HashMap::new();
    for (i, row) in existing.iter().enumerate() {
        idx_map.insert(row.replica_id.clone(), i);
    }

    let mut merged_count = 0;
    for row in incoming {
        if let Some(&idx) = idx_map.get(&row.replica_id) {
            // Replace only if the incoming row has a strictly higher HLC
            if row.updated_at_ts > existing[idx].updated_at_ts {
                existing[idx] = row;
            }
        } else {
            // New replica_id → append
            idx_map.insert(row.replica_id.clone(), existing.len());
            existing.push(row);
        }
        merged_count += 1;
    }

    let json = serde_json::to_string_pretty(&existing).map_err(|e| format!("serialize: {e}"))?;
    fs::write(path, &json).map_err(|e| format!("write: {e}"))?;

    Ok(merged_count)
}

// ── Response helpers ──────────────────────────────────────────────────────

fn respond_json(req: Request, json: &str) {
    let resp = Response::from_string(json)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    let _ = req.respond(resp);
}

fn respond_json_status(req: Request, json: &str, status: StatusCode) {
    let resp = Response::from_string(json)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    let _ = req.respond(resp);
}

fn json_error(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn json_merge_result(count: usize) -> String {
    serde_json::json!({ "merged": count }).to_string()
}

// ── Dictionary image I/O ──────────────────────────────────────────────────

/// Resolve the dictionary-images directory relative to the replicas dir.
fn images_dir(replicas_dir: &Path) -> PathBuf {
    replicas_dir.join("dictionary-images")
}

/// Write raw binary bytes to `{images_dir}/{entry_id}.png`.
fn save_dictionary_image(images_dir: &Path, entry_id: &str, bytes: &[u8]) -> Result<(), String> {
    let file_path = images_dir.join(format!("{entry_id}.png"));
    fs::write(&file_path, bytes).map_err(|e| format!("write image: {e}"))
}

/// Read image bytes from `{images_dir}/{entry_id}.png`.
fn read_dictionary_image(images_dir: &Path, entry_id: &str) -> Result<Vec<u8>, String> {
    let file_path = images_dir.join(format!("{entry_id}.png"));
    fs::read(&file_path).map_err(|e| format!("read image: {e}"))
}

// ── Dictionary image handlers ──────────────────────────────────────────────

fn serve_get_dictionary_image(req: Request, replicas_dir: &Path, entry_id: &str) {
    let dir = images_dir(replicas_dir);

    match read_dictionary_image(&dir, entry_id) {
        Ok(bytes) => {
            let resp = Response::from_data(bytes)
                .with_header(Header::from_bytes("Content-Type", "image/png").unwrap());
            let _ = req.respond(resp);
        }
        Err(_) => {
            respond_404(req);
        }
    }
}

fn serve_put_dictionary_image(mut req: Request, replicas_dir: &Path, entry_id: &str) {
    let dir = images_dir(replicas_dir);

    // Ensure the images directory exists
    if let Err(e) = fs::create_dir_all(&dir) {
        let _ = req.respond(
            Response::from_string(format!("{{\"error\":\"mkdir: {e}\"}}"))
                .with_status_code(StatusCode(500)),
        );
        return;
    }

    let mut body = Vec::new();
    if let Err(e) = req.as_reader().read_to_end(&mut body) {
        let _ = req.respond(
            Response::from_string(format!("{{\"error\":\"Body read failed: {e}\"}}"))
                .with_status_code(StatusCode(400)),
        );
        return;
    }

    match save_dictionary_image(&dir, entry_id, &body) {
        Ok(()) => {
            let resp = Response::from_string("{\"uploaded\":true}")
                .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            let _ = req.respond(resp);
        }
        Err(e) => {
            let _ = req.respond(
                Response::from_string(format!("{{\"error\":\"{e}\"}}"))
                    .with_status_code(StatusCode(500)),
            );
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::time::Duration;

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

    // ── Route parsing ──────────────────────────────────────────────────

    #[test]
    fn route_health() {
        assert!(matches!(parse_route("/health"), Route::Health));
        // Trailing slash is NOT /health
        assert!(matches!(parse_route("/health/"), Route::NotFound));
    }

    #[test]
    fn route_replicas_kind() {
        assert!(matches!(
            parse_route("/replicas/annotation"),
            Route::Replicas(k) if k == "annotation"
        ));
        assert!(matches!(
            parse_route("/replicas/annotation.json"),
            Route::Replicas(k) if k == "annotation"
        ));
        assert!(matches!(
            parse_route("/replicas/dictionary-entry"),
            Route::Replicas(k) if k == "dictionary-entry"
        ));
    }

    #[test]
    fn route_replicas_with_query() {
        assert!(matches!(
            parse_route("/replicas/annotation.json?since=abc123"),
            Route::Replicas(k) if k == "annotation"
        ));
    }

    #[test]
    fn route_not_found() {
        assert!(matches!(parse_route("/"), Route::NotFound));
        assert!(matches!(parse_route("/replicas/"), Route::NotFound));
        assert!(matches!(parse_route("/unknown"), Route::NotFound));
    }

    // ── Query param ────────────────────────────────────────────────────

    #[test]
    fn query_since() {
        assert_eq!(
            get_query_param("/replicas/annotation.json?since=T1", "since"),
            Some("T1".into())
        );
    }

    #[test]
    fn query_missing() {
        assert_eq!(get_query_param("/replicas/annotation.json", "since"), None);
    }

    #[test]
    fn query_multiple_params() {
        assert_eq!(
            get_query_param("/replicas/annotation.json?since=T1&other=x", "since"),
            Some("T1".into())
        );
    }

    #[test]
    fn percent_decode_basic() {
        assert_eq!(percent_decode("hello%20world"), "hello world");
        assert_eq!(percent_decode("no%2Fchange"), "no/change");
        assert_eq!(percent_decode("plain"), "plain");
    }

    // ── Replica I/O ────────────────────────────────────────────────────

    #[test]
    fn load_empty_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("annotation.json");
        fs::write(&path, "[]").unwrap();
        let rows = load_replicas(&path).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn load_with_rows() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("annotation.json");
        let rows = vec![make_row("r1", "annotation", "T1")];
        fs::write(&path, serde_json::to_string(&rows).unwrap()).unwrap();
        let loaded = load_replicas(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].replica_id, "r1");
    }

    // ── Merge logic ────────────────────────────────────────────────────

    #[test]
    fn merge_new_rows_append() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("annotation.json");
        fs::write(&path, "[]").unwrap();

        let incoming = vec![make_row("r1", "annotation", "T1")];
        let merged = merge_and_save(&path, incoming).unwrap();
        assert_eq!(merged, 1);

        let saved = load_replicas(&path).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].replica_id, "r1");
    }

    #[test]
    fn merge_newer_hlc_replaces() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("annotation.json");

        let existing = vec![make_row("r1", "annotation", "T1")];
        fs::write(&path, serde_json::to_string(&existing).unwrap()).unwrap();

        let incoming = vec![
            make_row("r1", "annotation", "T3"),
            make_row("r2", "annotation", "T2"),
        ];
        let merged = merge_and_save(&path, incoming).unwrap();
        assert_eq!(merged, 2);

        let saved = load_replicas(&path).unwrap();
        assert_eq!(saved.len(), 2);
        let r1 = saved.iter().find(|r| r.replica_id == "r1").unwrap();
        assert_eq!(r1.updated_at_ts, "T3");
        let r2 = saved.iter().find(|r| r.replica_id == "r2").unwrap();
        assert_eq!(r2.updated_at_ts, "T2");
    }

    #[test]
    fn merge_older_hlc_ignored() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("annotation.json");

        let existing = vec![make_row("r1", "annotation", "T5")];
        fs::write(&path, serde_json::to_string(&existing).unwrap()).unwrap();

        let incoming = vec![make_row("r1", "annotation", "T1")];
        merge_and_save(&path, incoming).unwrap();

        let saved = load_replicas(&path).unwrap();
        assert_eq!(saved.len(), 1);
        // Must keep T5 because incoming T1 is older
        assert_eq!(saved[0].updated_at_ts, "T5");
    }

    #[test]
    fn merge_same_hlc_keeps_existing() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("annotation.json");

        let row = make_row("r1", "annotation", "T2");
        let existing = vec![row.clone()];
        fs::write(&path, serde_json::to_string(&existing).unwrap()).unwrap();

        // Incoming has the same HLC — keep existing (no-op)
        let incoming = vec![make_row("r1", "annotation", "T2")];
        merge_and_save(&path, incoming).unwrap();

        let saved = load_replicas(&path).unwrap();
        assert_eq!(saved.len(), 1);
    }

    #[test]
    fn merge_missing_file_creates() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");

        let incoming = vec![make_row("r1", "annotation", "T1")];
        merge_and_save(&path, incoming).unwrap();

        // File was created
        assert!(path.exists());
        let saved = load_replicas(&path).unwrap();
        assert_eq!(saved.len(), 1);
    }

    // ── Dictionary image routes ───────────────────────────────────────

    #[test]
    fn route_dictionary_images_get() {
        assert!(matches!(
            parse_route("/dictionary-images/some-entry-id"),
            Route::DictionaryImages(id) if id == "some-entry-id"
        ));
        assert!(matches!(
            parse_route("/dictionary-images/entry-123"),
            Route::DictionaryImages(id) if id == "entry-123"
        ));
    }

    #[test]
    fn route_dictionary_images_with_query() {
        // Query params should be ignored for dictionary image routes
        assert!(matches!(
            parse_route("/dictionary-images/entry-1?v=2"),
            Route::DictionaryImages(id) if id == "entry-1"
        ));
    }

    #[test]
    fn route_dictionary_images_empty_id_not_found() {
        assert!(matches!(
            parse_route("/dictionary-images/"),
            Route::NotFound
        ));
    }

    #[test]
    fn dictionary_image_write_and_read() {
        let dir = tempfile::TempDir::new().unwrap();
        let images_dir = dir.path().join("dictionary-images");
        fs::create_dir_all(&images_dir).unwrap();

        let entry_id = "entry-abc";
        let bytes: Vec<u8> = vec![137, 80, 78, 71, 13, 10, 26, 10]; // PNG header

        // Write (PUT)
        save_dictionary_image(&images_dir, entry_id, &bytes).unwrap();

        // Verify file exists
        let file_path = images_dir.join(format!("{entry_id}.png"));
        assert!(file_path.exists());

        // Read (GET)
        let read = read_dictionary_image(&images_dir, entry_id).unwrap();
        assert_eq!(read, bytes);
    }

    #[test]
    fn dictionary_image_not_found() {
        let dir = tempfile::TempDir::new().unwrap();
        let images_dir = dir.path().join("dictionary-images");
        fs::create_dir_all(&images_dir).unwrap();

        let result = read_dictionary_image(&images_dir, "nonexistent");
        assert!(result.is_err());
    }

    // ── Health JSON shape ──────────────────────────────────────────────

    #[test]
    fn health_json_shape() {
        let resp = HealthResponse {
            status: "ok".into(),
            device_name: "test-device".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["status"], "ok");
        assert_eq!(v["deviceName"], "test-device");
    }

    // ── Integration test: start server → HTTP requests → stop ──────────

    /// Find a free TCP port by binding to port 0 and reading the assigned port.
    fn find_free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    }

    /// Send a raw HTTP request over a TcpStream and read the full response.
    fn http_request(host: &str, port: u16, request: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(format!("{host}:{port}")).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream.write_all(request.as_bytes()).unwrap();

        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();

        // Parse status code from first line: "HTTP/1.0 200 OK"
        let status_line = response.lines().next().unwrap_or("");
        let parts: Vec<&str> = status_line.split_whitespace().collect();
        let status: u16 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

        (status, response)
    }

    /// Like `http_request` but reads raw bytes for binary response bodies.
    fn http_request_raw(host: &str, port: u16, request: &str) -> (u16, Vec<u8>) {
        let mut stream = TcpStream::connect(format!("{host}:{port}")).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream.write_all(request.as_bytes()).unwrap();

        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();

        // Parse status code from first line
        let response_str = String::from_utf8_lossy(&response);
        let status_line = response_str.lines().next().unwrap_or("");
        let parts: Vec<&str> = status_line.split_whitespace().collect();
        let status: u16 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

        (status, response)
    }

    #[test]
    fn integration_health_endpoint() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server =
            SyncServer::start(port, replicas_dir.clone(), "test-device".into()).unwrap();

        let (status, body) = http_request(
            "127.0.0.1",
            port,
            "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );
        server.stop();

        assert_eq!(status, 200);
        let json: serde_json::Value =
            serde_json::from_str(body.lines().last().unwrap_or("{}")).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["deviceName"], "test-device");
    }

    #[test]
    fn integration_put_and_get_replicas() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server =
            SyncServer::start(port, replicas_dir.clone(), "integration-test".into()).unwrap();

        // PUT two rows
        let rows = vec![
            make_row("r-int-1", "annotation", "T10"),
            make_row("r-int-2", "annotation", "T20"),
        ];
        let put_body = serde_json::to_string(&rows).unwrap();
        let put_request = format!(
            "PUT /replicas/annotation HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            put_body.len(),
            put_body
        );
        let (put_status, _) = http_request("127.0.0.1", port, &put_request);
        assert_eq!(put_status, 200);

        // GET the rows back
        let (get_status, get_body) = http_request(
            "127.0.0.1",
            port,
            "GET /replicas/annotation HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(get_status, 200);
        let returned: Vec<serde_json::Value> =
            serde_json::from_str(get_body.lines().last().unwrap_or("[]")).unwrap();
        assert_eq!(returned.len(), 2);
        let ids: Vec<&str> = returned
            .iter()
            .map(|r| r["replica_id"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&"r-int-1"));
        assert!(ids.contains(&"r-int-2"));
    }

    #[test]
    fn integration_since_cursor_filtering() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server =
            SyncServer::start(port, replicas_dir.clone(), "cursor-test".into()).unwrap();

        // PUT rows with different HLCs
        let rows = vec![
            make_row("r-1", "annotation", "T100"),
            make_row("r-2", "annotation", "T200"),
            make_row("r-3", "annotation", "T300"),
        ];
        let put_body = serde_json::to_string(&rows).unwrap();
        let put_request = format!(
            "PUT /replicas/annotation HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            put_body.len(),
            put_body
        );
        http_request("127.0.0.1", port, &put_request);

        // GET with ?since=T100 — should only return T200 and T300
        let (get_status, get_body) = http_request(
            "127.0.0.1",
            port,
            "GET /replicas/annotation?since=T100 HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(get_status, 200);
        let returned: Vec<serde_json::Value> =
            serde_json::from_str(get_body.lines().last().unwrap_or("[]")).unwrap();
        assert_eq!(returned.len(), 2);
        let hlcs: Vec<&str> = returned
            .iter()
            .map(|r| r["updated_at_ts"].as_str().unwrap())
            .collect();
        assert!(hlcs.contains(&"T200"));
        assert!(hlcs.contains(&"T300"));
    }

    #[test]
    fn integration_dictionary_image_roundtrip() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(port, replicas_dir.clone(), "img-test".into()).unwrap();

        // PUT an image (raw bytes with HTTP headers)
        let png_bytes: Vec<u8> = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13];
        let put_request = format!(
            "PUT /dictionary-images/roundtrip-entry HTTP/1.0\r\nHost: localhost\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            png_bytes.len()
        );
        let put_request_bytes: Vec<u8> = put_request
            .as_bytes()
            .iter()
            .chain(&png_bytes)
            .copied()
            .collect();

        let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream.write_all(&put_request_bytes).unwrap();
        let mut put_response = Vec::new();
        stream.read_to_end(&mut put_response).unwrap();
        let put_resp_str = String::from_utf8_lossy(&put_response);
        let put_status: u16 = put_resp_str
            .lines()
            .next()
            .unwrap_or("")
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        assert_eq!(put_status, 200);
        assert!(put_resp_str.contains(r#""uploaded":true"#));

        // GET the image back using raw bytes to handle binary body
        let (get_status, get_raw) = http_request_raw(
            "127.0.0.1",
            port,
            "GET /dictionary-images/roundtrip-entry HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(get_status, 200);
        // Find the header/body delimiter and extract the body bytes
        let header_end = get_raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let body_bytes = &get_raw[header_end + 4..];
        assert_eq!(body_bytes, png_bytes.as_slice());
    }

    #[test]
    fn integration_dictionary_image_404() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(port, replicas_dir.clone(), "img-404".into()).unwrap();

        let (status, _) = http_request(
            "127.0.0.1",
            port,
            "GET /dictionary-images/nonexistent-entry HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(status, 404);
    }
}
