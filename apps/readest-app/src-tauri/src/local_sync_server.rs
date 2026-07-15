/**
 * local_sync_server — embedded HTTP server for USB local sync.
 *
 * Serves and accepts ReplicaRow JSON arrays so the desktop peer can
 * pull and push CRDT data via ADB forward tunnel (USB-only).
 *
 * ## Endpoints
 *
 *   GET  /health                        → { status: "ok", deviceName }
 *   GET  /replicas/:kind                 → ReplicaRow[] filtered by kind + ?since=HLC
 *   PUT  /replicas/:kind                 → merges incoming rows by replica_id (HLC wins)
 *   POST /__dev/reset                    → guarded dev harness runtime state clear
 *   GET  /dictionary-images/:entryId     → binary PNG (404 if absent)
 *   PUT  /dictionary-images/:entryId     → write raw PNG body to disk
 *
 * ## Architecture
 *
 * USB-only: binds to 127.0.0.1 and is reachable via `adb forward`.
 * Replica state is persisted directly in the visible SQLite databases
 * ({app_data_dir}/annotations.db, citas.db, dictionary.db) via
 * the VisibleRepository adapter — not in JSON shadow files. The
 * TypeScript services read the same .db files, so transferred data
 * appears immediately in the UI.
 *
 * Dictionary images are stored as PNG files in {app_data_dir}/Dictionaries/.
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

use crate::visible_repo::VisibleRepository;

const LOCAL_SYNC_BIND_HOST: &str = "127.0.0.1";
const DEV_RESET_PATH: &str = "/__dev/reset";
const DEV_RESET_HEADER: &str = "X-Biblioteca-Dev-Sync-Harness";
const DEV_RESET_TOKEN: &str = "DELETE_DEV_SYNC_STATE";

fn build_server_bind_addr(port: u16) -> String {
    format!("{LOCAL_SYNC_BIND_HOST}:{port}")
}

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
    #[serde(rename = "serverVersion")]
    server_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
    #[serde(rename = "startedAt")]
    started_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplicaRepositoryMode {
    JsonShadow,
    VisibleAdapter,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceOfTruthGate {
    Unblocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceOfTruthDiagnostic {
    pub kind: String,
    pub repository: ReplicaRepositoryMode,
    pub visible_repository_ready: bool,
    pub gate: SourceOfTruthGate,
    pub detail: String,
}

pub fn source_of_truth_diagnostic(kind: &str) -> SourceOfTruthDiagnostic {
    SourceOfTruthDiagnostic {
        kind: kind.to_string(),
        repository: ReplicaRepositoryMode::VisibleAdapter,
        visible_repository_ready: true, // visible-repository-adapter now active
        gate: SourceOfTruthGate::Unblocked, // visible-repository-adapter integrated
        detail: format!(
            "{kind} GET/PUT now writes to visible {db} via the VisibleRepository adapter;\
             the adapter syncs replicas to the application tables used by the UI.",
            db = match kind {
                "annotation" => "annotations.db",
                "quote" => "citas.db",
                "dictionary-entry" => "dictionary.db",
                _ => "unknown.db",
            }
        ),
    }
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncServerHealthStatus {
    Healthy,
    Unhealthy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncServerHealth {
    pub port: u16,
    pub status: SyncServerHealthStatus,
    pub detail: String,
}

impl SyncServer {
    /// Start the server listening on `127.0.0.1:{port}` for USB/ADB forward.
    ///
    /// `replicas_dir` is the directory where per-kind JSON files are stored
    /// (created if missing). `device_name` is returned in `/health` responses.
    pub fn start(
        port: u16,
        replicas_dir: PathBuf,
        device_name: String,
        visible_repo: Arc<dyn VisibleRepository>,
    ) -> Result<Self, String> {
        fs::create_dir_all(&replicas_dir)
            .map_err(|e| format!("Cannot create replicas dir: {e}"))?;

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = Arc::clone(&running);

        let server = Server::http(build_server_bind_addr(port))
            .map_err(|e| format!("Port {port} is in use or unavailable: {e}"))?;

        let handle = thread::spawn(move || {
            while running_clone.load(Ordering::Relaxed) {
                match server.recv_timeout(Duration::from_millis(500)) {
                    Ok(Some(req)) => {
                        // Catch panics from request handling to prevent
                        // the server thread from crashing the whole app.
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            handle_request(req, &replicas_dir, &device_name, &visible_repo);
                        }));
                        if let Err(panic) = result {
                            let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                                s.to_string()
                            } else if let Some(s) = panic.downcast_ref::<String>() {
                                s.to_string()
                            } else {
                                "unknown panic".to_string()
                            };
                            log::error!("[local-sync] Panic in request handler: {msg}");
                        }
                    }
                    Ok(None) => { /* timeout — check running flag */ }
                    Err(e) => {
                        log::error!(
                            "[local-sync] recv_timeout error: {e}. Server thread restarting..."
                        );
                        // Don't break — retry after a short sleep.
                        // The listener socket may be recoverable.
                        std::thread::sleep(Duration::from_secs(1));
                        if !running_clone.load(Ordering::Relaxed) {
                            break;
                        }
                    }
                }
            }
            log::info!("[local-sync] Server thread exiting.");
        });

        Ok(SyncServer {
            running,
            handle: Some(handle),
            port,
        })
    }

    /// Verify the server is actually listening (blocking health check).
    pub fn verify_health(&self, timeout: Duration) -> Result<(), String> {
        use std::io::{Read, Write};
        use std::net::TcpStream;
        let addr = format!("127.0.0.1:{}", self.port);
        let mut stream = TcpStream::connect_timeout(
            &addr.parse().map_err(|e| format!("invalid address: {e}"))?,
            timeout,
        )
        .map_err(|e| format!("Server not listening on {addr}: {e}"))?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|e| format!("set_read_timeout: {e}"))?;
        write!(stream, "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n")
            .map_err(|e| format!("health write: {e}"))?;
        let mut buf = [0u8; 256];
        let n = stream
            .read(&mut buf)
            .map_err(|e| format!("health read: {e}"))?;
        if n == 0 {
            return Err("Server accepted connection but sent no data".to_string());
        }
        let response = String::from_utf8_lossy(&buf[..n]);
        if response.contains("200") || response.contains("ok") {
            Ok(())
        } else {
            Err(format!("Unexpected health response: {:.100}", response))
        }
    }

    pub fn health_status(&self, timeout: Duration) -> SyncServerHealth {
        match self.verify_health(timeout) {
            Ok(()) => SyncServerHealth {
                port: self.port,
                status: SyncServerHealthStatus::Healthy,
                detail: "ok".to_string(),
            },
            Err(detail) => SyncServerHealth {
                port: self.port,
                status: SyncServerHealthStatus::Unhealthy,
                detail,
            },
        }
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
    BooksIndex,
    BooksDelete,
    BooksManifest,
    BookAsset { hash: String, asset: BookAsset },
    DevReset,
    NotFound,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BookAsset {
    File,
    Cover,
    Config,
    Nav,
}

impl BookAsset {
    fn from_route(segment: &str) -> Option<Self> {
        match segment {
            "file" | "book" => Some(Self::File),
            "cover" | "cover.png" => Some(Self::Cover),
            "config" | "config.json" => Some(Self::Config),
            "nav" | "nav.json" => Some(Self::Nav),
            _ => None,
        }
    }

    fn manifest_name(self) -> &'static str {
        match self {
            Self::File => "book",
            Self::Cover => "cover.png",
            Self::Config => "config.json",
            Self::Nav => "nav.json",
        }
    }

    fn fixed_filename(self) -> Option<&'static str> {
        match self {
            Self::File => None,
            Self::Cover => Some("cover.png"),
            Self::Config => Some("config.json"),
            Self::Nav => Some("nav.json"),
        }
    }

    fn content_type(self) -> &'static str {
        match self {
            Self::File => "application/octet-stream",
            Self::Cover => "image/png",
            Self::Config | Self::Nav => "application/json",
        }
    }

    fn required(self) -> bool {
        matches!(self, Self::File)
    }
}

fn parse_route(url: &str) -> Route {
    let path = url.split('?').next().unwrap_or(url);

    if path == "/health" {
        return Route::Health;
    }

    if path == DEV_RESET_PATH {
        return Route::DevReset;
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

    if path == "/books/index" || path == "/books/library" {
        return Route::BooksIndex;
    }

    if path == "/books/delete" {
        return Route::BooksDelete;
    }

    if path == "/books/manifest" {
        return Route::BooksManifest;
    }

    if let Some(rest) = path.strip_prefix("/books/assets/") {
        let parts: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
        if parts.len() == 2 && is_safe_book_hash(parts[0]) {
            if let Some(asset) = BookAsset::from_route(parts[1]) {
                return Route::BookAsset {
                    hash: parts[0].to_string(),
                    asset,
                };
            }
        }
    }

    if let Some(rest) = path.strip_prefix("/books/") {
        let parts: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
        if parts.len() == 2 && is_safe_book_hash(parts[0]) {
            if let Some(asset) = BookAsset::from_route(parts[1]) {
                return Route::BookAsset {
                    hash: parts[0].to_string(),
                    asset,
                };
            }
        }
    }

    Route::NotFound
}

fn is_safe_book_hash(hash: &str) -> bool {
    !hash.is_empty()
        && !hash.contains("..")
        && hash
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
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

fn handle_request(
    req: Request,
    replicas_dir: &Path,
    device_name: &str,
    visible_repo: &Arc<dyn VisibleRepository>,
) {
    let url = req.url().to_string();
    let method = req.method();

    match (method, parse_route(&url)) {
        (&Method::Options, _) => respond_options(req),
        (&Method::Get, Route::Health) => serve_health(req, device_name),
        (&Method::Get, Route::Replicas(kind)) => {
            let since = get_query_param(&url, "since");
            serve_get_replicas(req, visible_repo, &kind, since.as_deref());
        }
        (&Method::Put, Route::Replicas(kind)) => {
            serve_put_replicas(req, visible_repo, &kind);
        }
        (&Method::Post, Route::DevReset) => serve_dev_reset(req, visible_repo),
        (&Method::Get, Route::DictionaryImages(entry_id)) => {
            serve_get_dictionary_image(req, replicas_dir, &entry_id);
        }
        (&Method::Put, Route::DictionaryImages(entry_id)) => {
            serve_put_dictionary_image(req, replicas_dir, &entry_id);
        }
        (&Method::Get, Route::BooksIndex) => serve_get_books_index(req, replicas_dir),
        (&Method::Put, Route::BooksIndex) => serve_put_books_index(req, replicas_dir),
        (&Method::Put, Route::BooksDelete) => serve_put_books_delete(req, replicas_dir),
        (&Method::Get, Route::BooksManifest) => serve_get_books_manifest(req, replicas_dir),
        (&Method::Get, Route::BookAsset { hash, asset }) => {
            serve_get_book_asset(req, replicas_dir, &hash, asset);
        }
        (&Method::Put, Route::BookAsset { hash, asset }) => {
            serve_put_book_asset(req, replicas_dir, &hash, asset);
        }
        _ => {
            respond_404(req);
        }
    }
}

fn respond_options(req: Request) {
    let resp = Response::empty(StatusCode(204))
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS").unwrap(),
        )
        .with_header(
            Header::from_bytes(
                "Access-Control-Allow-Headers",
                "Content-Type, X-Biblioteca-Dev-Sync-Harness",
            )
            .unwrap(),
        )
        .with_header(Header::from_bytes("Access-Control-Max-Age", "600").unwrap());
    let _ = req.respond(resp);
}

fn respond_404(req: Request) {
    let resp = Response::from_string("Not Found")
        .with_status_code(StatusCode(404))
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS").unwrap(),
        )
        .with_header(
            Header::from_bytes(
                "Access-Control-Allow-Headers",
                "Content-Type, X-Biblioteca-Dev-Sync-Harness",
            )
            .unwrap(),
        );
    let _ = req.respond(resp);
}

// ── Handlers ──────────────────────────────────────────────────────────────

fn serve_health(req: Request, device_name: &str) {
    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".into());
    let body = HealthResponse {
        status: "ok".into(),
        device_name: device_name.into(),
        server_version: env!("CARGO_PKG_VERSION").into(),
        commit: option_env!("GIT_HASH").map(|s| s.into()),
        started_at,
    };
    let json = serde_json::to_string(&body).unwrap_or_else(|_| r#"{"status":"error"}"#.into());
    let resp = Response::from_string(json)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS").unwrap(),
        )
        .with_header(
            Header::from_bytes(
                "Access-Control-Allow-Headers",
                "Content-Type, X-Biblioteca-Dev-Sync-Harness",
            )
            .unwrap(),
        );
    let _ = req.respond(resp);
}

fn serve_get_replicas(
    req: Request,
    visible_repo: &Arc<dyn VisibleRepository>,
    kind: &str,
    since: Option<&str>,
) {
    let pull_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        visible_repo.pull(kind, since)
    }));

    match pull_result {
        Err(panic) => respond_json_status(
            req,
            &json_error(&format!("replica pull panic: {}", panic_message(panic))),
            StatusCode(500),
        ),
        Ok(Ok(rows)) => {
            let json = serde_json::to_string(&rows).unwrap_or_else(|_| "[]".into());
            respond_json(req, &json);
        }
        Ok(Err(e)) => {
            respond_json_status(req, &json_error(&e), StatusCode(500));
        }
    }
}

fn panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = panic.downcast_ref::<String>() {
        s.to_string()
    } else {
        "unknown panic".to_string()
    }
}

fn serve_put_replicas(mut req: Request, visible_repo: &Arc<dyn VisibleRepository>, kind: &str) {
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

    let push_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        visible_repo.push(kind, &incoming)
    }));

    match push_result {
        Err(panic) => respond_json_status(
            req,
            &json_error(&format!("replica push panic: {}", panic_message(panic))),
            StatusCode(500),
        ),
        Ok(rows) => match rows {
            Ok(count) => respond_json_status(req, &json_merge_result(count), StatusCode(200)),
            Err(e) => respond_json_status(req, &json_error(&e), StatusCode(500)),
        },
    }
}

fn serve_dev_reset(req: Request, visible_repo: &Arc<dyn VisibleRepository>) {
    if !has_dev_reset_guard(&req) {
        return respond_json_status(req, &json_error("dev reset guard missing"), StatusCode(403));
    }

    match visible_repo.clear_dev_state() {
        Ok(cleared) => respond_json_status(req, &json_dev_reset_result(cleared), StatusCode(200)),
        Err(e) => respond_json_status(req, &json_error(&e), StatusCode(500)),
    }
}

fn has_dev_reset_guard(req: &Request) -> bool {
    req.headers().iter().any(|header| {
        header.field.equiv(DEV_RESET_HEADER) && header.value.as_str() == DEV_RESET_TOKEN
    })
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

fn app_data_dir_from_replicas_dir(replicas_dir: &Path) -> PathBuf {
    if replicas_dir.file_name().and_then(|name| name.to_str()) == Some("replicas") {
        if let Some(local_sync_dir) = replicas_dir.parent() {
            if local_sync_dir.file_name().and_then(|name| name.to_str()) == Some("local-sync") {
                if let Some(app_data_dir) = local_sync_dir.parent() {
                    return app_data_dir.to_path_buf();
                }
            }
        }
    }

    replicas_dir.to_path_buf()
}

fn books_dir_from_replicas_dir(replicas_dir: &Path) -> PathBuf {
    app_data_dir_from_replicas_dir(replicas_dir)
        .join("Readest")
        .join("Books")
}

fn books_index_path(books_dir: &Path) -> PathBuf {
    books_dir.join("library.json")
}

fn load_books_index(books_dir: &Path) -> Result<Vec<serde_json::Value>, String> {
    let path = books_index_path(books_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("read books index: {e}"))?;
    let mut books: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("parse books index: {e}"))?;
    for book in &mut books {
        sanitize_book_metadata(book);
    }
    Ok(books)
}

fn sanitize_book_metadata(book: &mut serde_json::Value) {
    if let Some(object) = book.as_object_mut() {
        object.remove("filePath");
        object.remove("coverImageUrl");
    }
}

fn book_is_tombstone(book: &serde_json::Value) -> bool {
    book.get("deletedAt")
        .and_then(|value| value.as_u64())
        .is_some()
}

#[derive(Debug, Deserialize)]
struct BooksDeleteRequest {
    hash: String,
    #[serde(rename = "deletedAt")]
    deleted_at: Option<u64>,
}

fn current_unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn tombstone_book(book: &mut serde_json::Value, hash: &str, deleted_at: u64) {
    if !book.is_object() {
        *book = serde_json::json!({});
    }

    if let Some(object) = book.as_object_mut() {
        object.insert(
            "hash".to_string(),
            serde_json::Value::String(hash.to_string()),
        );
        object.insert("deletedAt".to_string(), serde_json::json!(deleted_at));
        object.insert("updatedAt".to_string(), serde_json::json!(deleted_at));
        object.insert("downloadedAt".to_string(), serde_json::Value::Null);
    }
    sanitize_book_metadata(book);
}

fn book_live_reimport_is_newer_than_tombstone(
    incoming: &serde_json::Value,
    existing_tombstone: &serde_json::Value,
) -> bool {
    match (
        incoming.get("createdAt").and_then(|value| value.as_u64()),
        existing_tombstone
            .get("deletedAt")
            .and_then(|value| value.as_u64()),
    ) {
        (Some(created_at), Some(deleted_at)) => created_at > deleted_at,
        _ => false,
    }
}

fn safe_book_filename(name: &str) -> Option<&str> {
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        return None;
    }

    Some(name)
}

fn book_filename_from_index(books_dir: &Path, hash: &str) -> Option<String> {
    let books = load_books_index(books_dir).ok()?;
    books.into_iter().find_map(|book| {
        if book.get("hash").and_then(|value| value.as_str()) != Some(hash) {
            return None;
        }

        for key in ["fileName", "filename", "name"] {
            if let Some(name) = book.get(key).and_then(|value| value.as_str()) {
                if let Some(safe) = safe_book_filename(name) {
                    return Some(safe.to_string());
                }
            }
        }

        None
    })
}

fn book_file_fallback(books_dir: &Path, hash: &str) -> Option<String> {
    let book_dir = books_dir.join(hash);
    let entries = fs::read_dir(book_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name != "cover.png" && name != "config.json" && name != "nav.json" {
            return Some(name.to_string());
        }
    }
    None
}

fn filename_from_library_format(books_dir: &Path, hash: &str) -> Option<String> {
    let books = load_books_index(books_dir).ok()?;
    let book = books
        .into_iter()
        .find(|b| b.get("hash").and_then(|v| v.as_str()) == Some(hash))?;

    let title = book
        .get("sourceTitle")
        .or_else(|| book.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("book");

    let format = book
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("EPUB");

    let ext = match format.to_lowercase().as_str() {
        "pdf" => "pdf",
        _ => "epub",
    };

    let safe_title: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let safe_title = safe_title.trim_matches('_');
    if safe_title.is_empty() {
        return Some(format!("book.{ext}"));
    }
    Some(format!("{safe_title}.{ext}"))
}

fn book_asset_path(books_dir: &Path, hash: &str, asset: BookAsset) -> Result<PathBuf, String> {
    if !is_safe_book_hash(hash) {
        return Err("invalid book hash".to_string());
    }

    let filename = match asset.fixed_filename() {
        Some(name) => name.to_string(),
        None => book_filename_from_index(books_dir, hash)
            .or_else(|| filename_from_library_format(books_dir, hash))
            .or_else(|| book_file_fallback(books_dir, hash))
            .unwrap_or_else(|| "book.epub".to_string()),
    };

    let filename =
        safe_book_filename(&filename).ok_or_else(|| "invalid book asset filename".to_string())?;
    Ok(books_dir.join(hash).join(filename))
}

fn read_book_asset(books_dir: &Path, hash: &str, asset: BookAsset) -> Result<Vec<u8>, String> {
    let path = book_asset_path(books_dir, hash, asset)?;
    fs::read(path).map_err(|e| format!("read book asset: {e}"))
}

fn write_book_asset(
    books_dir: &Path,
    hash: &str,
    asset: BookAsset,
    bytes: &[u8],
) -> Result<(), String> {
    let path = book_asset_path(books_dir, hash, asset)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir book asset: {e}"))?;
    }
    fs::write(path, bytes).map_err(|e| format!("write book asset: {e}"))
}

fn build_books_manifest(books_dir: &Path) -> Result<serde_json::Value, String> {
    let books = load_books_index(books_dir)?;
    let manifest_books: Vec<serde_json::Value> = books
        .into_iter()
        .filter_map(|book| {
            let hash = book.get("hash")?.as_str()?.to_string();
            if !is_safe_book_hash(&hash) {
                return None;
            }

            let assets = [
                BookAsset::File,
                BookAsset::Cover,
                BookAsset::Config,
                BookAsset::Nav,
            ]
            .into_iter()
            .map(|asset| {
                let path = book_asset_path(books_dir, &hash, asset).ok();
                let size = path
                    .as_ref()
                    .and_then(|path| fs::metadata(path).ok())
                    .map(|metadata| metadata.len());
                serde_json::json!({
                    "name": asset.manifest_name(),
                    "required": asset.required(),
                    "size": size,
                })
            })
            .collect::<Vec<_>>();

            // Skip books whose required assets are missing on disk and omit
            // tombstones from the active asset manifest. Tombstone evidence is
            // still available to peers through /books/index.
            let is_tombstone = book.get("deletedAt").and_then(|v| v.as_u64()).is_some();
            if is_tombstone {
                return None;
            }

            let has_all_required = assets.iter().all(|asset| {
                !asset["required"].as_bool().unwrap_or(false) || asset["size"].as_u64().is_some()
            });
            if !has_all_required {
                return None;
            }

            Some(serde_json::json!({
                "book": book,
                "hash": hash,
                "assets": assets,
            }))
        })
        .collect();

    Ok(serde_json::json!({ "books": manifest_books }))
}

// ── Response helpers ──────────────────────────────────────────────────────

fn respond_json(req: Request, json: &str) {
    let resp = Response::from_string(json)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
    let _ = req.respond(resp);
}

fn respond_json_status(req: Request, json: &str, status: StatusCode) {
    let resp = Response::from_string(json)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, PUT, OPTIONS").unwrap(),
        )
        .with_header(Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap());
    let _ = req.respond(resp);
}

fn json_error(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}

fn json_merge_result(count: usize) -> String {
    serde_json::json!({ "merged": count }).to_string()
}

fn json_dev_reset_result(cleared: usize) -> String {
    serde_json::json!({ "ok": true, "cleared": { "rows": cleared } }).to_string()
}

// ── Image validation helpers ──────────────────────────────────────────────

const PNG_HEADER: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

/// Reject entry IDs that could escape the images directory.
/// Allows alphanumeric, hyphens, underscores, dots — but never `..`, `/`, `\`.
fn is_safe_entry_id(id: &str) -> bool {
    !id.is_empty()
        && id != ".."
        && !id.contains('/')
        && !id.contains('\\')
        && id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Check whether `bytes` starts with the PNG magic signature.
fn is_png(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes[..8] == PNG_HEADER
}

// ── Dictionary image I/O ──────────────────────────────────────────────────

/// Resolve the dictionary-images directory relative to the replicas dir.
fn images_dir(replicas_dir: &Path) -> PathBuf {
    app_data_dir_from_replicas_dir(replicas_dir)
        .join("Readest")
        .join("Dictionaries")
        .join("entries")
}

/// Write raw binary bytes to `{images_dir}/{entry_id}/image.png`.
fn save_dictionary_image(images_dir: &Path, entry_id: &str, bytes: &[u8]) -> Result<(), String> {
    let entry_dir = images_dir.join(entry_id);
    fs::create_dir_all(&entry_dir).map_err(|e| format!("mkdir dict image: {e}"))?;
    let file_path = entry_dir.join("image.png");
    fs::write(&file_path, bytes).map_err(|e| format!("write image: {e}"))
}

/// Read image bytes from `{images_dir}/{entry_id}/image.png`.
fn read_dictionary_image(images_dir: &Path, entry_id: &str) -> Result<Vec<u8>, String> {
    let file_path = images_dir.join(entry_id).join("image.png");
    fs::read(&file_path).map_err(|e| format!("read image: {e}"))
}

// ── Dictionary image handlers ──────────────────────────────────────────────

fn serve_get_dictionary_image(req: Request, replicas_dir: &Path, entry_id: &str) {
    if !is_safe_entry_id(entry_id) {
        return respond_404(req);
    }

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
    if !is_safe_entry_id(entry_id) {
        let _ = req.respond(
            Response::from_string("{\"error\":\"invalid entry id\"}")
                .with_status_code(StatusCode(400)),
        );
        return;
    }

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

    // Validate PNG magic bytes
    if !is_png(&body) {
        let _ = req.respond(
            Response::from_string("{\"error\":\"not a valid PNG image\"}")
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

// ── Book handlers ─────────────────────────────────────────────────────────

fn serve_get_books_index(req: Request, replicas_dir: &Path) {
    let books_dir = books_dir_from_replicas_dir(replicas_dir);
    match load_books_index(&books_dir) {
        Ok(books) => {
            let json = serde_json::to_string(&books).unwrap_or_else(|_| "[]".to_string());
            respond_json(req, &json);
        }
        Err(e) => respond_json_status(req, &json_error(&e), StatusCode(500)),
    }
}

fn serve_put_books_index(mut req: Request, replicas_dir: &Path) {
    let books_dir = books_dir_from_replicas_dir(replicas_dir);
    let mut body = String::new();
    if let Err(e) = req.as_reader().read_to_string(&mut body) {
        return respond_json_status(
            req,
            &json_error(&format!("Body read failed: {e}")),
            StatusCode(400),
        );
    }

    let incoming: Vec<serde_json::Value> = if body.trim().is_empty() {
        Vec::new()
    } else {
        match serde_json::from_str(&body) {
            Ok(books) => books,
            Err(e) => {
                return respond_json_status(
                    req,
                    &json_error(&format!("Invalid JSON: {e}")),
                    StatusCode(400),
                );
            }
        }
    };

    if let Err(e) = fs::create_dir_all(&books_dir) {
        return respond_json_status(
            req,
            &json_error(&format!("mkdir books: {e}")),
            StatusCode(500),
        );
    }

    // Merge incoming into existing library by hash — do not overwrite unrelated books.
    let mut merged = load_books_index(&books_dir).unwrap_or_default();
    let mut idx_by_hash: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    for (i, book) in merged.iter().enumerate() {
        if let Some(hash) = book.get("hash").and_then(|v| v.as_str()) {
            idx_by_hash.insert(hash.to_string(), i);
        }
    }

    for mut book in incoming {
        sanitize_book_metadata(&mut book);
        if let Some(hash) = book.get("hash").and_then(|v| v.as_str()) {
            if let Some(&idx) = idx_by_hash.get(hash) {
                let existing_is_tombstone = book_is_tombstone(&merged[idx]);
                let incoming_is_tombstone = book_is_tombstone(&book);
                if existing_is_tombstone
                    && !incoming_is_tombstone
                    && !book_live_reimport_is_newer_than_tombstone(&book, &merged[idx])
                {
                    continue;
                }
                merged[idx] = book;
            } else {
                idx_by_hash.insert(hash.to_string(), merged.len());
                merged.push(book);
            }
        }
    }

    let json = match serde_json::to_string_pretty(&merged) {
        Ok(json) => json,
        Err(e) => {
            return respond_json_status(
                req,
                &json_error(&format!("serialize: {e}")),
                StatusCode(500),
            )
        }
    };

    match fs::write(books_index_path(&books_dir), json) {
        Ok(()) => respond_json_status(
            req,
            &serde_json::json!({ "merged": merged.len() }).to_string(),
            StatusCode(200),
        ),
        Err(e) => respond_json_status(
            req,
            &json_error(&format!("write books index: {e}")),
            StatusCode(500),
        ),
    }
}

fn serve_put_books_delete(mut req: Request, replicas_dir: &Path) {
    let books_dir = books_dir_from_replicas_dir(replicas_dir);
    let mut body = String::new();
    if let Err(e) = req.as_reader().read_to_string(&mut body) {
        return respond_json_status(
            req,
            &json_error(&format!("Body read failed: {e}")),
            StatusCode(400),
        );
    }

    let delete_request: BooksDeleteRequest = match serde_json::from_str(&body) {
        Ok(request) => request,
        Err(e) => {
            return respond_json_status(
                req,
                &json_error(&format!("Invalid JSON: {e}")),
                StatusCode(400),
            );
        }
    };

    if !is_safe_book_hash(&delete_request.hash) {
        return respond_json_status(req, &json_error("invalid book hash"), StatusCode(400));
    }

    if let Err(e) = fs::create_dir_all(&books_dir) {
        return respond_json_status(
            req,
            &json_error(&format!("mkdir books: {e}")),
            StatusCode(500),
        );
    }

    let deleted_at = delete_request
        .deleted_at
        .unwrap_or_else(current_unix_millis);
    let mut books = load_books_index(&books_dir).unwrap_or_default();
    let mut action = "not-found-tombstone-created";

    if let Some(book) = books.iter_mut().find(|book| {
        book.get("hash").and_then(|value| value.as_str()) == Some(delete_request.hash.as_str())
    }) {
        tombstone_book(book, &delete_request.hash, deleted_at);
        action = "tombstoned";
    } else {
        let mut tombstone = serde_json::json!({});
        tombstone_book(&mut tombstone, &delete_request.hash, deleted_at);
        books.push(tombstone);
    }

    let json = match serde_json::to_string_pretty(&books) {
        Ok(json) => json,
        Err(e) => {
            return respond_json_status(
                req,
                &json_error(&format!("serialize: {e}")),
                StatusCode(500),
            )
        }
    };

    match fs::write(books_index_path(&books_dir), json) {
        Ok(()) => respond_json_status(
            req,
            &serde_json::json!({
                "deleted": true,
                "hash": delete_request.hash,
                "action": action,
            })
            .to_string(),
            StatusCode(200),
        ),
        Err(e) => respond_json_status(
            req,
            &json_error(&format!("write books index: {e}")),
            StatusCode(500),
        ),
    }
}

fn serve_get_books_manifest(req: Request, replicas_dir: &Path) {
    let books_dir = books_dir_from_replicas_dir(replicas_dir);
    match build_books_manifest(&books_dir) {
        Ok(manifest) => respond_json(req, &manifest.to_string()),
        Err(e) => respond_json_status(req, &json_error(&e), StatusCode(500)),
    }
}

fn serve_get_book_asset(req: Request, replicas_dir: &Path, hash: &str, asset: BookAsset) {
    let books_dir = books_dir_from_replicas_dir(replicas_dir);
    match read_book_asset(&books_dir, hash, asset) {
        Ok(bytes) => {
            let resp = Response::from_data(bytes)
                .with_header(Header::from_bytes("Content-Type", asset.content_type()).unwrap())
                .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
                .with_header(
                    Header::from_bytes("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
                        .unwrap(),
                )
                .with_header(
                    Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap(),
                );
            let _ = req.respond(resp);
        }
        Err(_) => respond_404(req),
    }
}

fn serve_put_book_asset(mut req: Request, replicas_dir: &Path, hash: &str, asset: BookAsset) {
    let books_dir = books_dir_from_replicas_dir(replicas_dir);
    let mut body = Vec::new();
    if let Err(e) = req.as_reader().read_to_end(&mut body) {
        return respond_json_status(
            req,
            &json_error(&format!("Body read failed: {e}")),
            StatusCode(400),
        );
    }

    match write_book_asset(&books_dir, hash, asset, &body) {
        Ok(()) => respond_json_status(
            req,
            &serde_json::json!({ "uploaded": true }).to_string(),
            StatusCode(200),
        ),
        Err(e) => respond_json_status(req, &json_error(&e), StatusCode(400)),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::visible_repo::VisibleRepository;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::Mutex;
    use std::time::Duration;

    /// In-memory mock of VisibleRepository for tests.
    /// Stores rows in per-kind Vec<ReplicaRow> behind a Mutex.
    struct MockVisibleRepo {
        data: Mutex<HashMap<String, Vec<ReplicaRow>>>,
    }

    impl MockVisibleRepo {
        fn new() -> Self {
            Self {
                data: Mutex::new(HashMap::new()),
            }
        }
    }

    impl VisibleRepository for MockVisibleRepo {
        fn pull(&self, kind: &str, since: Option<&str>) -> Result<Vec<ReplicaRow>, String> {
            let data = self.data.lock().map_err(|e| e.to_string())?;
            let rows = data.get(kind).cloned().unwrap_or_default();
            if let Some(since_val) = since {
                Ok(rows
                    .into_iter()
                    .filter(|r| r.kind == kind && r.updated_at_ts.as_str() > since_val)
                    .collect())
            } else {
                Ok(rows.into_iter().filter(|r| r.kind == kind).collect())
            }
        }

        fn push(&self, kind: &str, rows: &[ReplicaRow]) -> Result<usize, String> {
            let mut data = self.data.lock().map_err(|e| e.to_string())?;
            let existing = data.entry(kind.to_string()).or_default();

            let mut idx_map: HashMap<String, usize> = HashMap::new();
            for (i, row) in existing.iter().enumerate() {
                idx_map.insert(row.replica_id.clone(), i);
            }

            let mut count = 0;
            for row in rows {
                if let Some(&idx) = idx_map.get(&row.replica_id) {
                    if row.updated_at_ts > existing[idx].updated_at_ts {
                        existing[idx] = row.clone();
                    }
                } else {
                    idx_map.insert(row.replica_id.clone(), existing.len());
                    existing.push(row.clone());
                }
                count += 1;
            }

            Ok(count)
        }

        fn health(&self) -> bool {
            true
        }
    }

    fn make_mock_adapter() -> Arc<dyn VisibleRepository> {
        Arc::new(MockVisibleRepo::new())
    }

    struct PanickingVisibleRepo {
        panic_on_pull: bool,
        panic_on_push: bool,
    }

    impl VisibleRepository for PanickingVisibleRepo {
        fn pull(&self, _kind: &str, _since: Option<&str>) -> Result<Vec<ReplicaRow>, String> {
            if self.panic_on_pull {
                panic!("test pull panic");
            }
            Ok(vec![])
        }

        fn push(&self, _kind: &str, _rows: &[ReplicaRow]) -> Result<usize, String> {
            if self.panic_on_push {
                panic!("test push panic");
            }
            Ok(0)
        }

        fn health(&self) -> bool {
            true
        }
    }

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

    // ── Source-of-truth gate ───────────────────────────────────────────

    #[test]
    fn source_of_truth_diagnostic_marks_supported_kinds_with_adapter_active() {
        for kind in ["annotation", "quote", "dictionary-entry"] {
            let diagnostic = source_of_truth_diagnostic(kind);

            assert_eq!(diagnostic.kind, kind);
            assert_eq!(diagnostic.repository, ReplicaRepositoryMode::VisibleAdapter);
            assert!(
                diagnostic.visible_repository_ready,
                "adapter should be ready for {kind}"
            );
            assert_eq!(diagnostic.gate, SourceOfTruthGate::Unblocked);
            assert!(
                diagnostic.detail.contains(".db"),
                "diagnostic must name the visible .db file for {kind}: {}",
                diagnostic.detail
            );
        }
    }

    #[test]
    fn server_replicas_path_resolves_to_isolated_json_file_not_visible_db() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("local-sync").join("replicas");

        let annotation_path = replicas_file_path(&replicas_dir, "annotation");
        let quote_path = replicas_file_path(&replicas_dir, "quote");
        let dictionary_path = replicas_file_path(&replicas_dir, "dictionary-entry");

        assert_eq!(
            annotation_path,
            replicas_dir.join("annotation.json"),
            "annotation GET/PUT currently targets JSON shadow, not annotations.db"
        );
        assert_eq!(
            quote_path,
            replicas_dir.join("quote.json"),
            "quote GET/PUT currently targets JSON shadow, not citas.db"
        );
        assert_eq!(
            dictionary_path,
            replicas_dir.join("dictionary-entry.json"),
            "dictionary GET/PUT currently targets JSON shadow, not dictionary.db"
        );
    }

    #[test]
    fn merge_writes_json_shadow_and_leaves_visible_database_files_absent() {
        let dir = tempfile::TempDir::new().unwrap();
        let app_data_dir = dir.path();
        let replicas_dir = app_data_dir.join("local-sync").join("replicas");
        fs::create_dir_all(&replicas_dir).unwrap();
        let annotation_json = replicas_file_path(&replicas_dir, "annotation");

        merge_and_save(
            &annotation_json,
            vec![make_row("annotation:visible-gate", "annotation", "T9")],
        )
        .unwrap();

        assert!(
            annotation_json.exists(),
            "server PUT persists to JSON shadow under local-sync/replicas"
        );
        assert!(
            !app_data_dir.join("annotations.db").exists(),
            "server PUT does not touch the visible AnotacionesService database"
        );
        assert!(
            !app_data_dir.join("citas.db").exists(),
            "server PUT does not touch the visible CitasService database"
        );
        assert!(
            !app_data_dir.join("dictionary.db").exists(),
            "server PUT does not touch the visible DictionaryService database"
        );
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

    // ── Entry ID safety ───────────────────────────────────────────────

    #[test]
    fn is_safe_entry_id_rejects_dot_dot() {
        assert!(!is_safe_entry_id(".."));
        assert!(!is_safe_entry_id("../etc"));
        assert!(!is_safe_entry_id("entry/.."));
    }

    #[test]
    fn is_safe_entry_id_allows_consecutive_dots() {
        // Consecutive dots inside a filename are NOT path traversal
        assert!(is_safe_entry_id("a..b"));
        assert!(is_safe_entry_id("entry...v1"));
    }

    #[test]
    fn is_safe_entry_id_rejects_slash() {
        assert!(!is_safe_entry_id("a/b"));
        assert!(!is_safe_entry_id("entry/id"));
    }

    #[test]
    fn is_safe_entry_id_allows_normal_ids() {
        assert!(is_safe_entry_id("entry-123"));
        assert!(is_safe_entry_id("abc123"));
        assert!(is_safe_entry_id("my.entry"));
    }

    #[test]
    fn is_safe_entry_id_rejects_backslash() {
        assert!(!is_safe_entry_id("a\\b"));
    }

    #[test]
    fn is_safe_entry_id_rejects_empty() {
        assert!(!is_safe_entry_id(""));
    }

    // ── PNG validation ─────────────────────────────────────────────────

    #[test]
    fn is_png_validates_magic_bytes() {
        let png = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13];
        assert!(is_png(&png));
    }

    #[test]
    fn is_png_rejects_non_png_bytes() {
        let not_png: Vec<u8> = b"not a png file".to_vec();
        assert!(!is_png(&not_png));
    }

    #[test]
    fn is_png_rejects_short_bytes() {
        let short: Vec<u8> = vec![0, 1, 2];
        assert!(!is_png(&short));
    }

    #[test]
    fn is_png_rejects_empty() {
        assert!(!is_png(&[]));
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

    // ── Book routes ───────────────────────────────────────────────────

    #[test]
    fn route_books_accepts_index_manifest_and_safe_assets() {
        assert!(matches!(parse_route("/books/index"), Route::BooksIndex));
        assert!(matches!(
            parse_route("/books/manifest"),
            Route::BooksManifest
        ));
        assert!(matches!(
            parse_route("/books/book-hash-123/file"),
            Route::BookAsset { hash, asset } if hash == "book-hash-123" && asset == BookAsset::File
        ));
        assert!(matches!(
            parse_route("/books/book_hash_123/cover"),
            Route::BookAsset { hash, asset } if hash == "book_hash_123" && asset == BookAsset::Cover
        ));
        assert!(matches!(
            parse_route("/books/book.hash.123/config"),
            Route::BookAsset { hash, asset } if hash == "book.hash.123" && asset == BookAsset::Config
        ));
        assert!(matches!(
            parse_route("/books/book.hash.123/nav"),
            Route::BookAsset { hash, asset } if hash == "book.hash.123" && asset == BookAsset::Nav
        ));
    }

    #[test]
    fn route_books_accepts_delete_contract() {
        assert!(matches!(parse_route("/books/delete"), Route::BooksDelete));
        assert!(matches!(
            parse_route("/books/delete?source=harness"),
            Route::BooksDelete
        ));
    }

    #[test]
    fn route_books_rejects_path_traversal_and_unknown_assets() {
        assert!(matches!(parse_route("/books/../file"), Route::NotFound));
        assert!(matches!(
            parse_route("/books/book/../../config"),
            Route::NotFound
        ));
        assert!(matches!(
            parse_route("/books/book/%2e%2e/config"),
            Route::NotFound
        ));
        assert!(matches!(
            parse_route("/books/book/not-allowed"),
            Route::NotFound
        ));
        assert!(matches!(parse_route("/books//file"), Route::NotFound));
    }

    #[test]
    fn books_manifest_lists_library_books_and_required_optional_assets() {
        let dir = tempfile::TempDir::new().unwrap();
        let books_dir = dir.path().join("Readest").join("Books");
        let hash = "book-hash-1";
        let book_dir = books_dir.join(hash);
        fs::create_dir_all(&book_dir).unwrap();
        fs::write(
            books_dir.join("library.json"),
            r#"[{"hash":"book-hash-1","title":"Test Book","fileName":"test.epub","filePath":"/sender/test.epub","coverImageUrl":"blob:sender"}]"#,
        )
        .unwrap();
        fs::write(book_dir.join("test.epub"), b"epub bytes").unwrap();
        fs::write(book_dir.join("cover.png"), b"cover bytes").unwrap();
        fs::write(book_dir.join("config.json"), b"{}").unwrap();

        let manifest = build_books_manifest(&books_dir).unwrap();

        assert_eq!(manifest["books"].as_array().unwrap().len(), 1);
        let book = &manifest["books"][0];
        assert_eq!(book["hash"], hash);
        assert_eq!(book["book"]["title"], "Test Book");
        assert!(book["book"].get("filePath").is_none());
        assert!(book["book"].get("coverImageUrl").is_none());
        let assets = book["assets"].as_array().unwrap();
        assert!(assets
            .iter()
            .any(|asset| asset["name"] == "book" && asset["required"] == true));
        assert!(assets
            .iter()
            .any(|asset| asset["name"] == "cover.png" && asset["required"] == false));
        assert!(assets
            .iter()
            .any(|asset| asset["name"] == "config.json" && asset["required"] == false));
        assert!(assets
            .iter()
            .any(|asset| asset["name"] == "nav.json" && asset["required"] == false));
    }

    #[test]
    fn book_asset_roundtrip_and_optional_nav_absence() {
        let dir = tempfile::TempDir::new().unwrap();
        let books_dir = dir.path().join("Readest").join("Books");
        let hash = "roundtrip-book";

        write_book_asset(&books_dir, hash, BookAsset::File, b"epub bytes").unwrap();
        write_book_asset(&books_dir, hash, BookAsset::Cover, b"cover bytes").unwrap();
        write_book_asset(&books_dir, hash, BookAsset::Config, br#"{"theme":"dark"}"#).unwrap();

        assert_eq!(
            read_book_asset(&books_dir, hash, BookAsset::File).unwrap(),
            b"epub bytes"
        );
        assert_eq!(
            read_book_asset(&books_dir, hash, BookAsset::Cover).unwrap(),
            b"cover bytes"
        );
        assert_eq!(
            read_book_asset(&books_dir, hash, BookAsset::Config).unwrap(),
            br#"{"theme":"dark"}"#
        );
        assert!(read_book_asset(&books_dir, hash, BookAsset::Nav).is_err());
    }

    #[test]
    fn book_asset_paths_stay_under_books_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        let books_dir = dir.path().join("Readest").join("Books");

        assert!(book_asset_path(&books_dir, "safe-hash", BookAsset::File).is_ok());
        assert!(book_asset_path(&books_dir, "../escape", BookAsset::File).is_err());
        assert!(book_asset_path(&books_dir, "safe/escape", BookAsset::Cover).is_err());
        assert!(book_asset_path(&books_dir, "%2e%2e", BookAsset::Config).is_err());
    }

    #[test]
    fn dictionary_image_write_and_read() {
        let dir = tempfile::TempDir::new().unwrap();
        let images_dir = dir.path().join("dictionary-images");

        let entry_id = "entry-abc";
        let bytes: Vec<u8> = vec![137, 80, 78, 71, 13, 10, 26, 10]; // PNG header

        // Write (PUT)
        save_dictionary_image(&images_dir, entry_id, &bytes).unwrap();

        // Verify file exists at {images_dir}/{entry_id}/image.png
        let file_path = images_dir.join(entry_id).join("image.png");
        assert!(file_path.exists());

        // Read (GET)
        let read = read_dictionary_image(&images_dir, entry_id).unwrap();
        assert_eq!(read, bytes);
    }

    #[test]
    fn dictionary_image_not_found() {
        let dir = tempfile::TempDir::new().unwrap();
        let images_dir = dir.path().join("dictionary-images");

        let result = read_dictionary_image(&images_dir, "nonexistent");
        assert!(result.is_err());
    }

    // ── Health JSON shape ──────────────────────────────────────────────

    #[test]
    fn health_json_shape() {
        let resp = HealthResponse {
            status: "ok".into(),
            device_name: "test-device".into(),
            server_version: env!("CARGO_PKG_VERSION").into(),
            commit: option_env!("GIT_HASH").map(|s| s.into()),
            started_at: "1234567890".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["status"], "ok");
        assert_eq!(v["deviceName"], "test-device");
        assert_eq!(v["serverVersion"], env!("CARGO_PKG_VERSION"));
        assert_eq!(v["startedAt"], "1234567890");
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
    fn server_bind_address_is_loopback_for_usb_forward_only() {
        let addr = build_server_bind_addr(7878);

        assert_eq!(addr, "127.0.0.1:7878");
        assert!(!addr.starts_with("0.0.0.0:"));
    }

    #[test]
    fn lifecycle_health_report_exposes_port_and_healthy_status() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "lifecycle-health".into(),
            make_mock_adapter(),
        )
        .unwrap();

        let health = server.health_status(Duration::from_secs(1));
        server.stop();

        assert_eq!(health.port, port);
        assert_eq!(health.status, SyncServerHealthStatus::Healthy);
        assert_eq!(health.detail, "ok");
    }

    #[test]
    fn lifecycle_health_report_exposes_stale_listener_failure() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "lifecycle-stale".into(),
            make_mock_adapter(),
        )
        .unwrap();
        server.stop();

        let health = server.health_status(Duration::from_millis(100));

        assert_eq!(health.port, port);
        assert_eq!(health.status, SyncServerHealthStatus::Unhealthy);
        assert!(
            health.detail.contains("Server not listening")
                || health.detail.contains("Connection refused")
                || health.detail.contains("Connection reset"),
            "unexpected stale health detail: {}",
            health.detail
        );
    }

    #[test]
    fn integration_health_endpoint() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir.clone(),
            "test-device".into(),
            make_mock_adapter(),
        )
        .unwrap();

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
    fn integration_health_includes_version_and_started_at() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir.clone(),
            "version-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

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
        assert!(
            json["serverVersion"].is_string(),
            "serverVersion must be present"
        );
        assert!(!json["serverVersion"].as_str().unwrap_or("").is_empty());
        assert!(json["startedAt"].is_string(), "startedAt must be present");
        let started = json["startedAt"].as_str().unwrap();
        assert!(
            started.parse::<u64>().is_ok(),
            "startedAt must be a unix timestamp"
        );
    }

    #[test]
    fn integration_put_and_get_replicas() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir.clone(),
            "integration-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

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
    fn integration_options_preflight_allows_replica_put() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server =
            SyncServer::start(port, replicas_dir, "cors-test".into(), make_mock_adapter()).unwrap();

        let (status, body) = http_request(
            "127.0.0.1",
            port,
            "OPTIONS /replicas/quote HTTP/1.0\r\nHost: localhost\r\nOrigin: http://localhost:3000\r\nAccess-Control-Request-Method: PUT\r\nAccess-Control-Request-Headers: content-type\r\n\r\n",
        );

        server.stop();

        assert_eq!(status, 204);
        assert!(body.contains("Access-Control-Allow-Origin: *"));
        assert!(body.contains("Access-Control-Allow-Methods: GET, PUT, POST, OPTIONS"));
        assert!(body.contains("Access-Control-Allow-Headers: Content-Type"));
    }

    #[test]
    fn integration_options_preflight_allows_books_delete_put() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("local-sync").join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "books-cors-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

        let (status, body) = http_request(
            "127.0.0.1",
            port,
            "OPTIONS /books/delete HTTP/1.0\r\nHost: localhost\r\nOrigin: http://localhost:3000\r\nAccess-Control-Request-Method: PUT\r\nAccess-Control-Request-Headers: content-type\r\n\r\n",
        );

        server.stop();

        assert_eq!(status, 204);
        assert!(body.contains("Access-Control-Allow-Origin: *"));
        assert!(body.contains("Access-Control-Allow-Methods: GET, PUT, POST, OPTIONS"));
        assert!(body.contains("Access-Control-Allow-Headers: Content-Type"));
    }

    #[test]
    fn integration_books_index_manifest_and_binary_asset_roundtrip() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("local-sync").join("replicas");
        let port = find_free_port();

        let mut server =
            SyncServer::start(port, replicas_dir, "books-test".into(), make_mock_adapter())
                .unwrap();

        let library = r#"[{"hash":"book-hash-1","title":"Test Book","fileName":"test.epub","filePath":"/sender/test.epub"}]"#;
        let put_index = format!(
            "PUT /books/index HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            library.len(),
            library
        );
        let (put_index_status, _) = http_request("127.0.0.1", port, &put_index);
        assert_eq!(put_index_status, 200);

        let book_bytes = b"epub bytes";
        let put_file = format!(
            "PUT /books/book-hash-1/file HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\n\r\n",
            book_bytes.len()
        );
        let put_file_bytes: Vec<u8> = put_file
            .as_bytes()
            .iter()
            .chain(book_bytes)
            .copied()
            .collect();
        let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
        stream.write_all(&put_file_bytes).unwrap();
        let mut put_file_response = String::new();
        stream.read_to_string(&mut put_file_response).unwrap();
        assert!(
            put_file_response.starts_with("HTTP/1.1 200")
                || put_file_response.starts_with("HTTP/1.0 200")
        );

        let (manifest_status, manifest_body) = http_request(
            "127.0.0.1",
            port,
            "GET /books/manifest HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );
        assert_eq!(manifest_status, 200);
        let manifest_json: serde_json::Value =
            serde_json::from_str(manifest_body.lines().last().unwrap_or("{}")).unwrap();
        assert_eq!(manifest_json["books"][0]["hash"], "book-hash-1");

        let (get_file_status, get_file_raw) = http_request_raw(
            "127.0.0.1",
            port,
            "GET /books/book-hash-1/file HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(get_file_status, 200);
        let header_end = get_file_raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .unwrap();
        assert_eq!(&get_file_raw[header_end + 4..], book_bytes);
    }

    #[test]
    fn integration_books_delete_tombstones_existing_book_and_preserves_semantic_data() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("local-sync").join("replicas");
        let books_dir = dir.path().join("Readest").join("Books");
        let book_dir = books_dir.join("book-hash-1");
        fs::create_dir_all(&book_dir).unwrap();
        fs::write(dir.path().join("annotations.db"), b"annotation data").unwrap();
        fs::write(dir.path().join("citas.db"), b"quote data").unwrap();
        fs::write(dir.path().join("dictionary.db"), b"dictionary data").unwrap();
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "books-delete-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

        let library = r#"[{"hash":"book-hash-1","title":"Test Book","fileName":"test.epub","updatedAt":100,"downloadedAt":100,"filePath":"/sender/test.epub"}]"#;
        let put_index = format!(
            "PUT /books/index HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            library.len(),
            library
        );
        let (put_status, _) = http_request("127.0.0.1", port, &put_index);
        assert_eq!(put_status, 200);
        fs::write(book_dir.join("test.epub"), b"epub bytes").unwrap();

        let delete_body = r#"{"hash":"book-hash-1","deletedAt":250}"#;
        let delete_request = format!(
            "PUT /books/delete HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            delete_body.len(),
            delete_body
        );
        let (delete_status, delete_response) = http_request("127.0.0.1", port, &delete_request);
        assert_eq!(delete_status, 200);
        let delete_json: serde_json::Value =
            serde_json::from_str(delete_response.lines().last().unwrap_or("{}")).unwrap();
        assert_eq!(delete_json["deleted"], true);
        assert_eq!(delete_json["hash"], "book-hash-1");
        assert_eq!(delete_json["action"], "tombstoned");

        let (index_status, index_body) = http_request(
            "127.0.0.1",
            port,
            "GET /books/index HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );
        assert_eq!(index_status, 200);
        let returned: Vec<serde_json::Value> =
            serde_json::from_str(index_body.lines().last().unwrap_or("[]")).unwrap();
        assert_eq!(returned.len(), 1);
        assert_eq!(returned[0]["hash"], "book-hash-1");
        assert_eq!(returned[0]["deletedAt"], 250);
        assert_eq!(returned[0]["updatedAt"], 250);
        assert!(returned[0]["downloadedAt"].is_null());
        assert!(returned[0].get("filePath").is_none());

        let (manifest_status, manifest_body) = http_request(
            "127.0.0.1",
            port,
            "GET /books/manifest HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );
        server.stop();

        assert_eq!(manifest_status, 200);
        let manifest_json: serde_json::Value =
            serde_json::from_str(manifest_body.lines().last().unwrap_or("{}")).unwrap();
        assert_eq!(manifest_json["books"].as_array().unwrap().len(), 0);
        assert_eq!(
            fs::read(dir.path().join("annotations.db")).unwrap(),
            b"annotation data"
        );
        assert_eq!(
            fs::read(dir.path().join("citas.db")).unwrap(),
            b"quote data"
        );
        assert_eq!(
            fs::read(dir.path().join("dictionary.db")).unwrap(),
            b"dictionary data"
        );
    }

    #[test]
    fn integration_books_delete_is_idempotent_for_missing_book() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("local-sync").join("replicas");
        fs::write(dir.path().join("annotations.db"), b"annotation data").unwrap();
        fs::write(dir.path().join("citas.db"), b"quote data").unwrap();
        fs::write(dir.path().join("dictionary.db"), b"dictionary data").unwrap();
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "books-delete-missing-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

        let delete_body = r#"{"hash":"missing-book","deletedAt":300}"#;
        let delete_request = format!(
            "PUT /books/delete HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            delete_body.len(),
            delete_body
        );
        let (delete_status, delete_response) = http_request("127.0.0.1", port, &delete_request);
        server.stop();

        assert_eq!(delete_status, 200);
        let delete_json: serde_json::Value =
            serde_json::from_str(delete_response.lines().last().unwrap_or("{}")).unwrap();
        assert_eq!(delete_json["deleted"], true);
        assert_eq!(delete_json["hash"], "missing-book");
        assert_eq!(delete_json["action"], "not-found-tombstone-created");
        assert_eq!(
            fs::read(dir.path().join("annotations.db")).unwrap(),
            b"annotation data"
        );
        assert_eq!(
            fs::read(dir.path().join("citas.db")).unwrap(),
            b"quote data"
        );
        assert_eq!(
            fs::read(dir.path().join("dictionary.db")).unwrap(),
            b"dictionary data"
        );
    }

    #[test]
    fn integration_books_index_keeps_tombstone_when_live_row_is_pushed_after_delete() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("local-sync").join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "books-tombstone-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

        let tombstone = r#"[{"hash":"book-hash-1","title":"Test Book","fileName":"test.epub","updatedAt":100,"deletedAt":101,"downloadedAt":null}]"#;
        let put_tombstone = format!(
            "PUT /books/index HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            tombstone.len(),
            tombstone
        );
        let (put_tombstone_status, _) = http_request("127.0.0.1", port, &put_tombstone);
        assert_eq!(put_tombstone_status, 200);

        let stale_live = r#"[{"hash":"book-hash-1","title":"Test Book","fileName":"test.epub","updatedAt":200,"deletedAt":null}]"#;
        let put_live = format!(
            "PUT /books/index HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            stale_live.len(),
            stale_live
        );
        let (put_live_status, _) = http_request("127.0.0.1", port, &put_live);
        assert_eq!(put_live_status, 200);

        let (get_status, get_body) = http_request(
            "127.0.0.1",
            port,
            "GET /books/index HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(get_status, 200);
        let returned: Vec<serde_json::Value> =
            serde_json::from_str(get_body.lines().last().unwrap_or("[]")).unwrap();
        assert_eq!(returned[0]["hash"], "book-hash-1");
        assert_eq!(returned[0]["deletedAt"], 101);
    }

    #[test]
    fn integration_books_index_allows_live_reimport_newer_than_tombstone() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("local-sync").join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "books-reimport-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

        let tombstone = r#"[{"hash":"book-hash-1","title":"Test Book","fileName":"test.epub","createdAt":1,"updatedAt":100,"deletedAt":101,"downloadedAt":null}]"#;
        let put_tombstone = format!(
            "PUT /books/index HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            tombstone.len(),
            tombstone
        );
        let (put_tombstone_status, _) = http_request("127.0.0.1", port, &put_tombstone);
        assert_eq!(put_tombstone_status, 200);

        let reimported_live = r#"[{"hash":"book-hash-1","title":"Test Book","fileName":"test.epub","createdAt":200,"updatedAt":201,"deletedAt":null}]"#;
        let put_live = format!(
            "PUT /books/index HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            reimported_live.len(),
            reimported_live
        );
        let (put_live_status, _) = http_request("127.0.0.1", port, &put_live);
        assert_eq!(put_live_status, 200);

        let (get_status, get_body) = http_request(
            "127.0.0.1",
            port,
            "GET /books/index HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(get_status, 200);
        let returned: Vec<serde_json::Value> =
            serde_json::from_str(get_body.lines().last().unwrap_or("[]")).unwrap();
        assert_eq!(returned[0]["hash"], "book-hash-1");
        assert_eq!(returned[0]["createdAt"], 200);
        assert!(returned[0]["deletedAt"].is_null());
    }

    #[test]
    fn integration_pull_panic_returns_http_500_instead_of_empty_reply() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "panic-test".into(),
            Arc::new(PanickingVisibleRepo {
                panic_on_pull: true,
                panic_on_push: false,
            }),
        )
        .unwrap();

        let (status, body) = http_request(
            "127.0.0.1",
            port,
            "GET /replicas/annotation HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(status, 500);
        assert!(body.contains("replica pull panic"));
        assert!(body.contains("test pull panic"));
    }

    #[test]
    fn integration_push_panic_returns_http_500_instead_of_empty_reply() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir,
            "panic-test".into(),
            Arc::new(PanickingVisibleRepo {
                panic_on_pull: false,
                panic_on_push: true,
            }),
        )
        .unwrap();

        let rows = vec![make_row("r-panic", "annotation", "T10")];
        let put_body = serde_json::to_string(&rows).unwrap();
        let put_request = format!(
            "PUT /replicas/annotation HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            put_body.len(),
            put_body
        );
        let (status, body) = http_request("127.0.0.1", port, &put_request);

        server.stop();

        assert_eq!(status, 500);
        assert!(body.contains("replica push panic"));
        assert!(body.contains("test push panic"));
    }

    #[test]
    fn integration_since_cursor_filtering() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir.clone(),
            "cursor-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

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

        let mut server = SyncServer::start(
            port,
            replicas_dir.clone(),
            "img-test".into(),
            make_mock_adapter(),
        )
        .unwrap();

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

        let mut server = SyncServer::start(
            port,
            replicas_dir.clone(),
            "img-404".into(),
            make_mock_adapter(),
        )
        .unwrap();

        let (status, _) = http_request(
            "127.0.0.1",
            port,
            "GET /dictionary-images/nonexistent-entry HTTP/1.0\r\nHost: localhost\r\n\r\n",
        );

        server.stop();

        assert_eq!(status, 404);
    }

    #[test]
    fn integration_dictionary_image_rejects_non_png_put() {
        let dir = tempfile::TempDir::new().unwrap();
        let replicas_dir = dir.path().join("replicas");
        let port = find_free_port();

        let mut server = SyncServer::start(
            port,
            replicas_dir.clone(),
            "img-nonpng".into(),
            make_mock_adapter(),
        )
        .unwrap();

        // PUT non-PNG bytes (plain text, not a valid image)
        let non_png_body = b"this is not a png image";
        let put_request = format!(
            "PUT /dictionary-images/entry-nonpng HTTP/1.0\r\nHost: localhost\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            non_png_body.len()
        );
        let put_request_bytes: Vec<u8> = put_request
            .as_bytes()
            .iter()
            .chain(non_png_body)
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

        server.stop();

        assert_eq!(
            put_status, 400,
            "non-PNG upload should be rejected with 400"
        );
    }
}
