#[cfg(target_os = "macos")]
#[macro_use]
extern crate cocoa;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "android")]
mod android;

use tauri::utils::config::BackgroundThrottlingPolicy;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

#[cfg(desktop)]
use tauri::{Listener, Url};
mod clip_url;
mod dir_scanner;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod discord_rpc;
mod local_sync_discovery;
mod local_sync_server;
#[cfg(target_os = "macos")]
mod macos;
mod sync_commands;
mod transfer_file;
mod visible_repo;
use local_sync_discovery::{find_local_ipv4, PeerInfo};
#[cfg(target_os = "windows")]
use tauri::webview::ScrollBarStyle;
use tauri::{command, Emitter, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "android")]
use tauri_plugin_native_bridge::register_select_directory_callback;
#[cfg(target_os = "android")]
use tauri_plugin_native_bridge::{NativeBridgeExt, OpenExternalUrlRequest};
#[cfg(not(target_os = "android"))]
use tauri_plugin_opener::OpenerExt;
use transfer_file::{download_file, upload_file};
use visible_repo::VisibleRepository;

// ── Local sync shared state ───────────────────────────────────────────────

/// Managed state for the local sync subsystem (USB peer-to-peer).
///
/// Holds the optional running HTTP server for USB-only local sync. Wrapped in
/// `Arc<Mutex<>>` so it can be accessed from Tauri commands.
#[derive(Default)]
pub struct LocalSyncState {
    pub server: Option<local_sync_server::SyncServer>,
    pub discovery: Option<local_sync_discovery::MdnsDiscovery>,
    pub discovered_peers: Vec<PeerInfo>,
    pub last_lifecycle: Option<LocalSyncEnsureOutcome>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalSyncEnsureOutcomeKind {
    Started,
    SkippedAlreadyRunning,
    FailedBind,
    FailedHealthCheck,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSyncEnsureOutcome {
    pub outcome: LocalSyncEnsureOutcomeKind,
    pub source: String,
    pub port: u16,
    pub health: local_sync_server::SyncServerHealth,
}

#[cfg(any(desktop, target_os = "ios"))]
fn allow_file_in_scopes(app: &AppHandle, files: Vec<PathBuf>) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    for file in &files {
        if let Err(e) = fs_scope.allow_file(file) {
            log::error!("Failed to allow file in fs_scope: {e}");
        } else {
            log::debug!("Allowed file in fs_scope: {file:?}");
        }
        if let Err(e) = asset_protocol_scope.allow_file(file) {
            log::error!("Failed to allow file in asset_protocol_scope: {e}");
        } else {
            log::debug!("Allowed file in asset_protocol_scope: {file:?}");
        }
    }
}

fn allow_dir_in_scopes(app: &AppHandle, dir: &PathBuf) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    if let Err(e) = fs_scope.allow_directory(dir, true) {
        log::error!("Failed to allow directory in fs_scope: {e}");
    } else {
        log::info!("Allowed directory in fs_scope: {dir:?}");
    }
    if let Err(e) = asset_protocol_scope.allow_directory(dir, true) {
        log::error!("Failed to allow directory in asset_protocol_scope: {e}");
    } else {
        log::info!("Allowed directory in asset_protocol_scope: {dir:?}");
    }
}

/// Frontend-callable shim around [`allow_file_in_scopes`] /
/// [`allow_dir_in_scopes`]. Used after dialog-based file/folder pickers
/// because the Tauri `dialog` plugin only auto-grants `fs_scope`, not
/// `asset_protocol_scope` — and our importer relies on the asset
/// protocol (`RemoteFile`) to read user-selected files. Without this,
/// importing a book from e.g. `~/Downloads/...` fails with
/// "asset protocol not configured to allow the path".
///
/// Granted scopes are persisted across app restarts thanks to
/// `tauri_plugin_persisted_scope`, so re-picking the same file isn't
/// required after the first allow call.
///
/// Security:
///
///   - On desktop, this command refuses to extend `asset_protocol_scope`
///     for any path that is not already allowed in `fs_scope`. The
///     `fs_scope` there is populated only by the Tauri `dialog` plugin
///     (when the user picks through the OS picker) or by
///     `tauri_plugin_persisted_scope` (which restores prior dialog
///     grants on startup). That gate constrains the command to
///     user-selected paths only — otherwise any frontend code
///     (including a future XSS via book content, OPDS HTML, dictionary
///     lookups, or a compromised dependency) could invoke it with an
///     arbitrary path like `/` or `~/.ssh` and gain persistent read
///     access to the entire user home directory via the asset
///     protocol.
///
///   - On iOS, the `fs_scope` gate is intentionally skipped: the iOS
///     directory/file picker (`UIDocumentPickerViewController`) does
///     not flow through Tauri's dialog plugin, and we keep the only
///     persistent record of user-authorised paths inside the
///     native-bridge plugin's security-scoped bookmark store
///     (`FolderBookmarkStore` in NativeBridgePlugin.swift). The
///     OS sandbox itself is the access-control boundary: the process
///     can only read paths for which it holds a security-scoped
///     resource (granted by the system picker, persisted via
///     bookmark). Widening Tauri's `fs_scope`/`asset_protocol_scope`
///     to those same paths cannot escalate access beyond what the OS
///     already grants — it just lets the fs / dir-scanner layers
///     route reads through the path the WebView gave them. The
///     frontend layer also keeps the list of folder roots in
///     `settings.externalLibraryFolders` and re-issues this call on
///     every launch, so the in-memory scope set stays in sync with
///     the user's persisted intent.
#[command]
fn allow_paths_in_scopes(_app: AppHandle, _paths: Vec<String>, _is_directory: bool) {
    #[cfg(desktop)]
    {
        let fs_scope = _app.fs_scope();
        for raw in _paths {
            if raw.is_empty() {
                continue;
            }
            let path = PathBuf::from(&raw);
            if !fs_scope.is_allowed(&path) {
                log::warn!("allow_paths_in_scopes refused (path not in fs_scope): {path:?}");
                continue;
            }
            if _is_directory {
                allow_dir_in_scopes(&_app, &path);
            } else {
                allow_file_in_scopes(&_app, vec![path]);
            }
        }
    }
    #[cfg(target_os = "ios")]
    {
        // The iOS picker hands us a security-scoped URL whose POSIX
        // path lives outside any of our static fs_scope globs (e.g.
        // File Provider Storage, iCloud Drive, third-party providers).
        // Without explicitly widening fs_scope/asset_protocol_scope
        // here, both `dir_scanner::read_dir` and the fs plugin's
        // `readDir` would reject the path even though the OS sandbox
        // already grants us access via the held security-scoped
        // resource. See the security comment above.
        for raw in _paths {
            if raw.is_empty() {
                continue;
            }
            let path = PathBuf::from(&raw);
            if _is_directory {
                allow_dir_in_scopes(&_app, &path);
            } else {
                allow_file_in_scopes(&_app, vec![path]);
            }
        }
    }
    #[cfg(target_os = "android")]
    {
        // Android picker already routes through register_select_directory_callback
        // for directories; files go through SAF / content-URIs and don't use
        // asset_protocol_scope. Nothing to do here.
    }
}

#[cfg(desktop)]
fn get_files_from_argv(argv: Vec<String>) -> Vec<PathBuf> {
    let mut files = Vec::new();
    // NOTICE: `args` may include URL protocol (`your-app-protocol://`)
    // or arguments (`--`) if your app supports them.
    // files may also be passed as `file://path/to/file`
    for (_, maybe_file) in argv.iter().enumerate().skip(1) {
        // skip flags like -f or --flag
        if maybe_file.starts_with("-") {
            continue;
        }
        // handle `file://` path urls and skip other urls
        if let Ok(url) = Url::parse(maybe_file) {
            if let Ok(path) = url.to_file_path() {
                files.push(path);
            } else {
                files.push(PathBuf::from(maybe_file))
            }
        } else {
            files.push(PathBuf::from(maybe_file))
        }
    }
    files
}

#[cfg(desktop)]
fn set_window_open_with_files(app: &AppHandle, files: Vec<PathBuf>) {
    let files = files
        .into_iter()
        .map(|f| {
            let file = f
                .to_string_lossy()
                .replace("\\", "\\\\")
                .replace("\"", "\\\"");
            format!("\"{file}\"",)
        })
        .collect::<Vec<_>>()
        .join(",");
    let window = app.get_webview_window("main").unwrap();
    let script = format!("window.OPEN_WITH_FILES = [{files}];");
    if let Err(e) = window.eval(&script) {
        eprintln!("Failed to set open files variable: {e}");
    }
}

#[tauri::command]
fn get_environment_variable(name: &str) -> String {
    std::env::var(String::from(name)).unwrap_or(String::from(""))
}

#[tauri::command]
fn get_executable_dir() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

// ── Local sync commands ───────────────────────────────────────────────────

const USB_ONLY_LOCAL_SYNC_COMMANDS: &[&str] = &[
    "start_local_sync_server",
    "stop_local_sync_server",
    "check_adb",
    "list_usb_devices",
    "list_usb_devices_detailed",
    "list_forward_rules",
    "setup_usb_tunnel",
];

/// Start the embedded HTTP server for peer-to-peer sync.
///
/// Listens on `127.0.0.1:{port}` and serves replicas from
/// `{app_data_dir}/local-sync/replicas/`. The device name shown in
/// `/health` responses is derived from the system hostname.
fn log_local_sync_lifecycle(report: &LocalSyncEnsureOutcome) {
    let event = match report.outcome {
        LocalSyncEnsureOutcomeKind::Started => "start",
        LocalSyncEnsureOutcomeKind::SkippedAlreadyRunning => "skip",
        LocalSyncEnsureOutcomeKind::FailedBind | LocalSyncEnsureOutcomeKind::FailedHealthCheck => {
            "failed"
        }
    };
    let message = format!(
        "[local-sync:lifecycle] {event} source={} port={} health={:?} detail={}",
        report.source, report.port, report.health.status, report.health.detail
    );
    match report.outcome {
        LocalSyncEnsureOutcomeKind::Started | LocalSyncEnsureOutcomeKind::SkippedAlreadyRunning => {
            log::info!("{message}");
        }
        LocalSyncEnsureOutcomeKind::FailedBind | LocalSyncEnsureOutcomeKind::FailedHealthCheck => {
            log::error!("{message}");
        }
    }
}

fn ensure_local_sync_server(
    state: &Arc<Mutex<LocalSyncState>>,
    port: u16,
    data_dir: PathBuf,
    device_name: String,
    visible_repo: Arc<dyn VisibleRepository>,
    source: &str,
) -> Result<LocalSyncEnsureOutcome, String> {
    let mut locked = state.lock().map_err(|e| e.to_string())?;
    if let Some(server) = locked.server.as_ref() {
        let health = server.health_status(std::time::Duration::from_secs(2));
        let outcome = if health.status == local_sync_server::SyncServerHealthStatus::Healthy {
            LocalSyncEnsureOutcomeKind::SkippedAlreadyRunning
        } else {
            LocalSyncEnsureOutcomeKind::FailedHealthCheck
        };
        let report = LocalSyncEnsureOutcome {
            outcome,
            source: source.to_string(),
            port: health.port,
            health,
        };
        log_local_sync_lifecycle(&report);
        locked.last_lifecycle = Some(report.clone());
        return Ok(report);
    }
    drop(locked);

    let replicas_dir = data_dir.join("local-sync").join("replicas");
    let mut server =
        match local_sync_server::SyncServer::start(port, replicas_dir, device_name, visible_repo) {
            Ok(server) => server,
            Err(detail) => {
                let report = LocalSyncEnsureOutcome {
                    outcome: LocalSyncEnsureOutcomeKind::FailedBind,
                    source: source.to_string(),
                    port,
                    health: local_sync_server::SyncServerHealth {
                        port,
                        status: local_sync_server::SyncServerHealthStatus::Unhealthy,
                        detail,
                    },
                };
                log_local_sync_lifecycle(&report);
                let mut locked = state.lock().map_err(|e| e.to_string())?;
                locked.last_lifecycle = Some(report.clone());
                return Ok(report);
            }
        };

    let health = server.health_status(std::time::Duration::from_secs(2));
    let outcome = if health.status == local_sync_server::SyncServerHealthStatus::Healthy {
        LocalSyncEnsureOutcomeKind::Started
    } else {
        LocalSyncEnsureOutcomeKind::FailedHealthCheck
    };
    let report = LocalSyncEnsureOutcome {
        outcome,
        source: source.to_string(),
        port: health.port,
        health,
    };
    log_local_sync_lifecycle(&report);

    let mut locked = state.lock().map_err(|e| e.to_string())?;
    if report.outcome == LocalSyncEnsureOutcomeKind::Started {
        locked.server = Some(server);
    } else {
        server.stop();
    }
    locked.last_lifecycle = Some(report.clone());
    Ok(report)
}

#[tauri::command]
fn start_local_sync_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<LocalSyncState>>>,
    port: u16,
) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let device_name = get_device_hostname();
    let visible_repo = Arc::new(visible_repo::LibsqlVisibleRepo::new(data_dir.clone()));
    let report = ensure_local_sync_server(
        state.inner(),
        port,
        data_dir,
        device_name,
        visible_repo,
        "command",
    )?;

    match report.outcome {
        LocalSyncEnsureOutcomeKind::Started => {
            Ok(format!("Server started on port {}", report.port))
        }
        LocalSyncEnsureOutcomeKind::SkippedAlreadyRunning => {
            Ok(format!("Server already running on port {}", report.port))
        }
        LocalSyncEnsureOutcomeKind::FailedBind | LocalSyncEnsureOutcomeKind::FailedHealthCheck => {
            Err(format!(
                "Server failed on port {}: {}",
                report.port, report.health.detail
            ))
        }
    }
}

/// Stop the embedded HTTP server gracefully.
#[tauri::command]
fn stop_local_sync_server(
    state: tauri::State<'_, Arc<Mutex<LocalSyncState>>>,
) -> Result<String, String> {
    let mut locked = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut server) = locked.server.take() {
        server.stop();
    }
    Ok("Server stopped".into())
}

/// Start mDNS discovery: register our service and browse for peers.
///
/// New peers are emitted to the frontend via the
/// `local-sync:peer-discovered` Tauri event.
#[tauri::command]
#[allow(dead_code)]
fn start_discovery(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<LocalSyncState>>>,
    port: u16,
    device_name: String,
) -> Result<String, String> {
    let version = env!("CARGO_PKG_VERSION").to_string();

    let hostname = get_device_hostname();

    let app_handle = app.clone();
    let sync_state = state.inner().clone();
    let emit_peer: Box<dyn Fn(PeerInfo) + Send + 'static> = Box::new(move |peer: PeerInfo| {
        let _ = app_handle.emit("local-sync:peer-discovered", &peer);
        if let Ok(mut locked) = sync_state.lock() {
            locked.discovered_peers.push(peer);
        }
    });

    let discovery = local_sync_discovery::MdnsDiscovery::start(
        port,
        device_name.clone(),
        version,
        hostname,
        emit_peer,
    )?;

    let mut locked = state.lock().map_err(|e| e.to_string())?;
    locked.discovery = Some(discovery);

    Ok(format!(
        "Discovery started for '{}' on port {port}",
        device_name
    ))
}

/// Stop mDNS discovery: unregister service and stop browsing.
#[tauri::command]
#[allow(dead_code)]
fn stop_discovery(
    state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<LocalSyncState>>>,
) -> Result<String, String> {
    let mut locked = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut discovery) = locked.discovery.take() {
        discovery.stop()?;
    }
    Ok("Discovery stopped".into())
}

/// Return the list of peers discovered since the last `start_discovery`.
#[tauri::command]
#[allow(dead_code)]
fn get_discovered_peers(
    state: tauri::State<'_, std::sync::Arc<std::sync::Mutex<LocalSyncState>>>,
) -> Result<Vec<PeerInfo>, String> {
    let locked = state.lock().map_err(|e| e.to_string())?;
    Ok(locked.discovered_peers.clone())
}

/// Return the best guess at this device's hostname.
///
/// Uses the OS `hostname` command as a fallback when the `hostname` crate
/// is not available. The result is trimmed and defaults to `"readest"` if
/// all methods fail.
pub(crate) fn get_device_hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "readest".to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
enum AdbDeviceState {
    Device,
    Unauthorized,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UsbDeviceStatus {
    serial: String,
    state: AdbDeviceState,
    model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
struct AdbForwardRule {
    serial: String,
    local: String,
    remote: String,
}

/// Parse the output of `adb devices` into a list of device serial numbers.
///
/// Input format (example):
/// ```text
/// List of devices attached
/// ABC123\tdevice
/// DEF456\tunauthorized
/// ```
///
/// Returns serial numbers of devices that are in `device` or `unauthorized`
/// state (both are potentially connectable). Filters out the header line
/// and empty lines. Empty output returns an empty vector.
fn parse_adb_devices(output: &str) -> Vec<String> {
    parse_adb_devices_detailed(output)
        .into_iter()
        .filter(|device| {
            matches!(
                device.state,
                AdbDeviceState::Device | AdbDeviceState::Unauthorized
            )
        })
        .map(|device| device.serial)
        .collect()
}

fn parse_adb_devices_detailed(output: &str) -> Vec<UsbDeviceStatus> {
    output
        .lines()
        .skip_while(|line| line.trim().starts_with("List of devices attached"))
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            let serial = parts.first()?;
            let state = match *parts.get(1)? {
                "device" => AdbDeviceState::Device,
                "unauthorized" => AdbDeviceState::Unauthorized,
                "offline" => AdbDeviceState::Offline,
                _ => return None,
            };
            let model = parts
                .iter()
                .find_map(|part| part.strip_prefix("model:"))
                .map(ToOwned::to_owned);

            Some(UsbDeviceStatus {
                serial: (*serial).to_string(),
                state,
                model,
            })
        })
        .collect()
}

fn parse_adb_forward_list(output: &str, serial: &str, sync_port: u16) -> Vec<AdbForwardRule> {
    let sync_endpoint = format!("tcp:{sync_port}");

    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() != 3 || parts[0] != serial {
                return None;
            }

            let local = parts[1];
            let remote = parts[2];
            if local == sync_endpoint && remote.starts_with("tcp:") {
                Some(AdbForwardRule {
                    serial: parts[0].to_string(),
                    local: local.to_string(),
                    remote: remote.to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

fn build_list_forward_rules_args(serial: &str) -> Vec<String> {
    vec![
        "-s".into(),
        serial.into(),
        "forward".into(),
        "--list".into(),
    ]
}

fn build_setup_usb_tunnel_args(serial: &str, port: u16) -> Vec<String> {
    let endpoint = format!("tcp:{port}");
    vec![
        "-s".into(),
        serial.into(),
        "forward".into(),
        endpoint.clone(),
        endpoint,
    ]
}

/// Resolve the `adb` binary path, checking common locations.
fn resolve_adb() -> Option<String> {
    let candidates = [
        "adb",
        "/opt/android-sdk/platform-tools/adb",
        "/usr/bin/adb",
        "/usr/local/bin/adb",
    ];
    // Also check ANDROID_HOME and ANDROID_SDK_ROOT env vars
    if let Ok(home) = std::env::var("ANDROID_HOME") {
        let p = std::path::Path::new(&home).join("platform-tools/adb");
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    if let Ok(root) = std::env::var("ANDROID_SDK_ROOT") {
        let p = std::path::Path::new(&root).join("platform-tools/adb");
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    // Fallback: if "adb" is in PATH
    if std::path::Path::new("adb").exists() {
        // Try via PATH: just running it may work
        return Some("adb".to_string());
    }
    None
}

fn adb_cmd() -> std::process::Command {
    let adb = resolve_adb().unwrap_or_else(|| "adb".to_string());
    std::process::Command::new(adb)
}

#[tauri::command]
fn check_adb() -> Result<(), String> {
    let adb = resolve_adb().ok_or_else(|| "adb not found".to_string())?;
    let output = std::process::Command::new(&adb)
        .arg("version")
        .output()
        .map_err(|e| format!("Failed to run adb: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("adb version failed: {}", stderr.trim()))
    }
}

/// Return a list of ADB-connected device serials.
///
/// Runs `adb devices`, parses the output, and returns the serial numbers
/// of devices in `device` or `unauthorized` state. Returns an empty vector
/// if `adb` is not installed or no devices are connected.
#[tauri::command]
fn list_usb_devices() -> Vec<String> {
    match adb_cmd().args(["devices", "-l"]).output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            parse_adb_devices(&stdout)
        }
        Err(e) => {
            log::warn!("[local-sync] adb command failed: {e}");
            Vec::new()
        }
    }
}

#[tauri::command]
fn list_usb_devices_detailed() -> Vec<UsbDeviceStatus> {
    match adb_cmd().args(["devices", "-l"]).output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            parse_adb_devices_detailed(&stdout)
        }
        Err(e) => {
            log::warn!("[local-sync] adb command failed: {e}");
            Vec::new()
        }
    }
}

#[tauri::command]
fn list_forward_rules(serial: String, sync_port: u16) -> Result<Vec<AdbForwardRule>, String> {
    let output = adb_cmd()
        .args(build_list_forward_rules_args(&serial))
        .output()
        .map_err(|e| format!("Failed to run adb: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("adb forward --list failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_adb_forward_list(&stdout, &serial, sync_port))
}

/// Set up an ADB port forward tunnel for USB local sync.
///
/// Runs `adb -s {serial} forward tcp:{port} tcp:{port}` so the desktop
/// can reach a connected Android device's sync server on `localhost:{port}`.
#[tauri::command]
fn setup_usb_tunnel(serial: String, port: u16) -> Result<String, String> {
    let args = build_setup_usb_tunnel_args(&serial, port);
    let output = adb_cmd()
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run adb: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("adb forward failed: {}", stderr.trim()));
    }

    Ok(format!("Tunnel set up for {} on port {}", serial, port))
}

/// Return this device's primary non-loopback IPv4 address.
///
/// Falls back to "127.0.0.1" if no non-loopback interface is found
/// (e.g. in containers or CI without network).
#[tauri::command]
#[allow(dead_code)]
fn get_local_ip() -> String {
    find_local_ipv4().unwrap_or_else(|| "127.0.0.1".to_string())
}

// ── End local sync commands ───────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
#[allow(dead_code)]
struct SingleInstancePayload {
    args: Vec<String>,
    cwd: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tracing", log::LevelFilter::Warn)
                .level_for("tantivy", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            download_file,
            upload_file,
            get_environment_variable,
            get_executable_dir,
            allow_paths_in_scopes,
            dir_scanner::read_dir,
            start_local_sync_server,
            stop_local_sync_server,
            check_adb,
            list_usb_devices,
            list_usb_devices_detailed,
            list_forward_rules,
            setup_usb_tunnel,
            // Sync dedup commands (PR #1 — harness-code-path-unification)
            sync_commands::normalize_term,
            sync_commands::compute_semantic_key,
            sync_commands::filter_unchanged_replicas,
            sync_commands::write_replica_metadata,
            sync_commands::ensure_replica_tables,
            #[cfg(target_os = "macos")]
            macos::safari_auth::auth_with_safari,
            #[cfg(target_os = "macos")]
            macos::apple_auth::start_apple_sign_in,
            #[cfg(target_os = "macos")]
            macos::traffic_light::set_traffic_lights,
            #[cfg(target_os = "macos")]
            macos::system_dictionary::show_lookup_popover,
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            discord_rpc::update_book_presence,
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            discord_rpc::clear_book_presence,
            clip_url::clip_url,
        ])
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_device_info::init())
        .plugin(tauri_plugin_turso::init())
        .plugin(tauri_plugin_native_bridge::init())
        .plugin(tauri_plugin_native_tts::init())
        .plugin(tauri_plugin_webview_upgrade::init());

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_single_instance::Builder::new()
            .callback(move |app, argv, cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
                let files = get_files_from_argv(argv.clone());
                if !files.is_empty() {
                    allow_file_in_scopes(app, files.clone());
                }
                app.emit("single-instance", SingleInstancePayload { args: argv, cwd })
                    .unwrap();
            })
            .dbus_id("io.github.Napster0x.biblioteca".to_owned())
            .build(),
    );

    let builder = builder.plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(macos::traffic_light::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(macos::safari_auth::init());

    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_sign_in_with_apple::init());

    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        .setup(|#[allow(unused_variables)] app| {
            // When running with the webdriver feature (E2E/integration tests),
            // grant all default permissions to remote URLs (http://127.0.0.1:*)
            // so that Vitest browser-mode tests can call plugin commands.
            #[cfg(feature = "webdriver")]
            {
                use tauri::Manager;
                app.add_capability(include_str!("../capabilities-extra/webdriver.json"))?;
            }
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                use std::sync::{Arc, Mutex};
                let discord_client = Arc::new(Mutex::new(discord_rpc::DiscordRpcClient::new()));
                app.manage(discord_client);
            }

            {
                use std::sync::{Arc, Mutex};
                let sync_state = Arc::new(Mutex::new(LocalSyncState::default()));
                app.manage(sync_state);
            }

            #[cfg(desktop)]
            {
                let files = get_files_from_argv(std::env::args().collect());
                if !files.is_empty() {
                    let app_handle = app.handle().clone();
                    allow_file_in_scopes(&app_handle, files.clone());
                    app.listen("window-ready", move |_| {
                        println!("Window is ready, proceeding to handle files.");
                        set_window_open_with_files(&app_handle, files.clone());
                    });
                }
            }

            #[cfg(desktop)]
            {
                allow_dir_in_scopes(app.handle(), &PathBuf::from(get_executable_dir()));
            }

            #[cfg(target_os = "android")]
            register_select_directory_callback(app.handle(), move |app, path| {
                allow_dir_in_scopes(app, path);
            });

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_cli::init())?;
            }

            // Check for e-ink device on Android before building the window
            #[cfg(target_os = "android")]
            let is_eink = android::is_eink_device();
            #[cfg(not(target_os = "android"))]
            let is_eink = false;

            #[cfg(desktop)]
            let cli_access = true;
            #[cfg(not(desktop))]
            let cli_access = false;

            #[cfg(target_os = "linux")]
            let is_appimage = std::env::var("APPIMAGE").is_ok()
                || std::env::current_exe()
                    .map(|path| path.to_string_lossy().contains("/tmp/.mount_"))
                    .unwrap_or(false);
            #[cfg(not(target_os = "linux"))]
            let is_appimage = false;

            #[cfg(desktop)]
            let updater_disabled = std::env::var("READEST_DISABLE_UPDATER").is_ok();
            #[cfg(not(desktop))]
            let updater_disabled = false;

            let init_script = format!(
                r#"
                    if ({is_eink}) window.__READEST_IS_EINK = true;
                    if ({cli_access}) window.__READEST_CLI_ACCESS = true;
                    if ({is_appimage}) window.__READEST_IS_APPIMAGE = true;
                    if ({updater_disabled}) window.__READEST_UPDATER_DISABLED = true;
                    window.addEventListener('DOMContentLoaded', function() {{
                        document.documentElement.classList.add('edge-to-edge');
                        const isTauriLocal = window.location.protocol === 'tauri:' ||
                                            window.location.protocol === 'about:' ||
                                            window.location.hostname === 'tauri.localhost';
                        const needsSafeArea = !isTauriLocal;
                        if (needsSafeArea && !document.getElementById('safe-area-style')) {{
                            const style = document.createElement('style');
                            style.id = 'safe-area-style';
                            style.textContent = `
                                body {{
                                    padding-top: env(safe-area-inset-top) !important;
                                    padding-bottom: env(safe-area-inset-bottom) !important;
                                    padding-left: env(safe-area-inset-left) !important;
                                    padding-right: env(safe-area-inset-right) !important;
                                }}
                            `;
                            document.head.appendChild(style);
                        }}
                    }});
                "#,
                is_eink = is_eink,
                cli_access = cli_access,
                is_appimage = is_appimage,
                updater_disabled = updater_disabled
            );

            let app_handle = app.handle().clone();
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .background_throttling(BackgroundThrottlingPolicy::Disabled)
                .background_color(if is_eink {
                    tauri::window::Color(255, 255, 255, 255)
                } else {
                    tauri::window::Color(50, 49, 48, 255)
                })
                .initialization_script(&init_script)
                .on_navigation(move |url| {
                    if url.scheme() == "alipays" || url.scheme() == "alipay" {
                        let url_str = url.as_str().to_string();
                        #[cfg(target_os = "android")]
                        {
                            let handle = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                match handle
                                    .native_bridge()
                                    .open_external_url(OpenExternalUrlRequest { url: url_str })
                                {
                                    Ok(result) => println!("Result: {:?}", result),
                                    Err(e) => eprintln!("Error: {:?}", e),
                                }
                            });
                        }
                        #[cfg(not(target_os = "android"))]
                        {
                            let _ = app_handle.opener().open_url(url_str, None::<&str>);
                        }
                        return false;
                    }
                    true
                });

            #[cfg(target_os = "macos")]
            let win_builder = win_builder.inner_size(1280.0, 800.0).resizable(true);
            #[cfg(all(not(target_os = "macos"), desktop))]
            let win_builder = win_builder.inner_size(800.0, 600.0).resizable(true);

            #[cfg(target_os = "macos")]
            let win_builder = win_builder
                .decorations(true)
                .title_bar_style(TitleBarStyle::Overlay)
                .title("");

            #[cfg(all(not(target_os = "macos"), desktop))]
            let win_builder = {
                let mut builder = win_builder
                    .decorations(false)
                    .visible(false)
                    .shadow(true)
                    .title("Readest");

                #[cfg(target_os = "windows")]
                {
                    builder = builder
                        .transparent(false)
                        .scroll_bar_style(ScrollBarStyle::FluentOverlay);
                }
                #[cfg(target_os = "linux")]
                {
                    builder = builder
                        .transparent(true)
                        .background_color(tauri::window::Color(0, 0, 0, 0));
                }

                builder
            };

            #[cfg(not(target_os = "macos"))]
            {
                win_builder.build().unwrap();
            }
            // let win = win_builder.build().unwrap();
            // win.open_devtools();

            #[cfg(target_os = "macos")]
            {
                let window = win_builder.build().unwrap();
                // On macOS, closing a window (via Cmd+W or the red traffic light) should
                // not quit the app — only Cmd+Q should. Hide the window instead so the
                // app keeps running in the dock, and restore it when the user reopens
                // the app from the dock.
                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            #[cfg(target_os = "macos")]
            macos::menu::setup_macos_menu(app.handle())?;

            app.handle().emit("window-ready", ()).unwrap();

            // Auto-start sync server on Android if toggle is enabled in settings.
            #[cfg(target_os = "android")]
            {
                let settings_path = app
                    .path()
                    .app_data_dir()
                    .unwrap_or_default()
                    .join("Readest")
                    .join("settings.json");
                log::info!("[local-sync:lifecycle] auto-start settings={}", settings_path.display());
                match std::fs::read_to_string(&settings_path) {
                    Ok(contents) => {
                        log::debug!(
                            "[local-sync:lifecycle] auto-start settings read bytes={}",
                            contents.len()
                        );
                        match serde_json::from_str::<serde_json::Value>(&contents) {
                            Ok(settings) => {
                                let enabled = settings
                                    .get("localSync")
                                    .and_then(|v| v.get("enabled"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                log::info!(
                                    "[local-sync:lifecycle] auto-start localSync.enabled={enabled}"
                                );
                                if enabled {
                                    let port = settings
                                        .get("localSync")
                                        .and_then(|v| v.get("port"))
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(7878) as u16;
                                    let state = app
                                        .state::<Arc<Mutex<LocalSyncState>>>();
                                    let data_dir = app.path().app_data_dir().unwrap_or_default();
                                    let device_name = get_device_hostname();
                                    let visible_repo = Arc::new(
                                        visible_repo::LibsqlVisibleRepo::new(data_dir.clone()),
                                    );
                                    if let Err(e) = ensure_local_sync_server(
                                        state.inner(),
                                        port,
                                        data_dir,
                                        device_name,
                                        visible_repo,
                                        "auto-start",
                                    ) {
                                        log::error!(
                                            "[local-sync:lifecycle] failed source=auto-start port={port} error={e}"
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                log::error!("[local-sync:lifecycle] auto-start json parse error: {e}");
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("[local-sync:lifecycle] auto-start cannot read settings: {e}");
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(
            #[allow(unused_variables)]
            |app_handle, event| {
                #[cfg(target_os = "macos")]
                match event {
                    tauri::RunEvent::Opened { urls } => {
                        let files = urls
                            .into_iter()
                            .filter_map(|url| url.to_file_path().ok())
                            .collect::<Vec<_>>();

                        let app_handler_clone = app_handle.clone();
                        allow_file_in_scopes(app_handle, files.clone());
                        app_handle.listen("window-ready", move |_| {
                            println!("Window is ready, proceeding to handle files.");
                            set_window_open_with_files(&app_handler_clone, files.clone());
                        });
                    }
                    // When the user reopens the app from the dock after closing all
                    // windows, re-show the main window instead of leaving the dock
                    // icon inert.
                    tauri::RunEvent::Reopen {
                        has_visible_windows: false,
                        ..
                    } => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                    _ => {}
                }
            },
        );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::visible_repo::VisibleRepository;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    struct MockVisibleRepo {
        data: Mutex<HashMap<String, Vec<local_sync_server::ReplicaRow>>>,
    }

    impl MockVisibleRepo {
        fn new() -> Self {
            Self {
                data: Mutex::new(HashMap::new()),
            }
        }
    }

    impl VisibleRepository for MockVisibleRepo {
        fn pull(
            &self,
            kind: &str,
            _since: Option<&str>,
        ) -> Result<Vec<local_sync_server::ReplicaRow>, String> {
            let data = self.data.lock().map_err(|e| e.to_string())?;
            Ok(data.get(kind).cloned().unwrap_or_default())
        }

        fn push(
            &self,
            kind: &str,
            rows: &[local_sync_server::ReplicaRow],
        ) -> Result<usize, String> {
            let mut data = self.data.lock().map_err(|e| e.to_string())?;
            data.entry(kind.to_string())
                .or_default()
                .extend(rows.iter().cloned());
            Ok(rows.len())
        }

        fn health(&self) -> bool {
            true
        }
    }

    fn make_mock_adapter() -> Arc<dyn VisibleRepository> {
        Arc::new(MockVisibleRepo::new())
    }

    fn find_free_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    }

    #[test]
    fn parse_adb_devices_empty_output() {
        let result = parse_adb_devices("List of devices attached\n");
        assert!(result.is_empty());
    }

    #[test]
    fn parse_adb_devices_single_device() {
        let output = "List of devices attached\nABC123\tdevice\n";
        let result = parse_adb_devices(output);
        assert_eq!(result, vec!["ABC123"]);
    }

    #[test]
    fn parse_adb_devices_multiple_devices() {
        let output =
            "List of devices attached\nABC123\tdevice\nDEF456\tdevice\nGHI789\tunauthorized\n";
        let result = parse_adb_devices(output);
        assert_eq!(result, vec!["ABC123", "DEF456", "GHI789"]);
    }

    #[test]
    fn parse_adb_devices_filters_offline() {
        let output = "List of devices attached\nABC123\tdevice\nOFF999\toffline\nDEF456\tdevice\n";
        let result = parse_adb_devices(output);
        assert_eq!(result, vec!["ABC123", "DEF456"]);
    }

    #[test]
    fn parse_adb_devices_handles_trailing_newlines() {
        let output = "List of devices attached\n\nABC123\tdevice\n\n";
        let result = parse_adb_devices(output);
        assert_eq!(result, vec!["ABC123"]);
    }

    #[test]
    fn parse_adb_devices_no_devices_header_only() {
        let output = "List of devices attached\n";
        let result = parse_adb_devices(output);
        assert!(result.is_empty());
    }

    #[test]
    fn parse_adb_devices_detailed_preserves_device_unauthorized_and_offline_states() {
        let output = "List of devices attached\nABC123\tdevice product:foo model:Pixel_8 device:husky\nDEF456\tunauthorized usb:1-2\nGHI789\toffline transport_id:4\n";

        let result = parse_adb_devices_detailed(output);

        assert_eq!(
            result,
            vec![
                UsbDeviceStatus {
                    serial: "ABC123".into(),
                    state: AdbDeviceState::Device,
                    model: Some("Pixel_8".into()),
                },
                UsbDeviceStatus {
                    serial: "DEF456".into(),
                    state: AdbDeviceState::Unauthorized,
                    model: None,
                },
                UsbDeviceStatus {
                    serial: "GHI789".into(),
                    state: AdbDeviceState::Offline,
                    model: None,
                },
            ]
        );
    }

    #[test]
    fn parse_adb_forward_list_filters_serial_and_tcp_sync_port() {
        let output = "ABC123 tcp:7878 tcp:7878\nABC123 tcp:3000 tcp:3000\nDEF456 tcp:7878 tcp:7878\nABC123 localabstract:webview_devtools remoteabstract:webview_devtools\n";

        let result = parse_adb_forward_list(output, "ABC123", 7878);

        assert_eq!(
            result,
            vec![AdbForwardRule {
                serial: "ABC123".into(),
                local: "tcp:7878".into(),
                remote: "tcp:7878".into(),
            }]
        );
    }

    #[test]
    fn list_forward_rules_args_are_serial_scoped_and_non_destructive() {
        let args = build_list_forward_rules_args("ABC123");

        assert_eq!(args, vec!["-s", "ABC123", "forward", "--list"]);
        assert!(!args.windows(2).any(|w| w == ["forward", "--remove-all"]));
        assert!(!args.windows(2).any(|w| w == ["reverse", "--remove-all"]));
        assert!(!args.windows(3).any(|w| w == ["shell", "am", "force-stop"]));
    }

    #[test]
    fn setup_usb_tunnel_args_are_serial_scoped_and_never_global_destructive() {
        let args = build_setup_usb_tunnel_args("ABC123", 7878);

        assert_eq!(
            args,
            vec!["-s", "ABC123", "forward", "tcp:7878", "tcp:7878"]
        );
        assert!(!args.windows(2).any(|w| w == ["forward", "--remove-all"]));
        assert!(!args.windows(2).any(|w| w == ["reverse", "--remove-all"]));
        assert!(!args.windows(3).any(|w| w == ["shell", "am", "force-stop"]));
        assert!(!args
            .iter()
            .any(|arg| matches!(arg.as_str(), "kill" | "install" | "uninstall")));
    }

    #[test]
    fn usb_only_local_sync_command_set_excludes_mdns_discovery() {
        assert!(USB_ONLY_LOCAL_SYNC_COMMANDS.contains(&"start_local_sync_server"));
        assert!(USB_ONLY_LOCAL_SYNC_COMMANDS.contains(&"setup_usb_tunnel"));
        assert!(USB_ONLY_LOCAL_SYNC_COMMANDS.contains(&"list_forward_rules"));
        assert!(!USB_ONLY_LOCAL_SYNC_COMMANDS.contains(&"get_local_ip"));
        assert!(!USB_ONLY_LOCAL_SYNC_COMMANDS.contains(&"start_discovery"));
        assert!(!USB_ONLY_LOCAL_SYNC_COMMANDS.contains(&"stop_discovery"));
        assert!(!USB_ONLY_LOCAL_SYNC_COMMANDS.contains(&"get_discovered_peers"));
    }

    #[test]
    fn ensure_local_sync_server_starts_once_then_skips_with_health_evidence() {
        let dir = tempfile::TempDir::new().unwrap();
        let state = Arc::new(Mutex::new(LocalSyncState::default()));
        let port = find_free_port();

        let started = ensure_local_sync_server(
            &state,
            port,
            dir.path().to_path_buf(),
            "ensure-test".into(),
            make_mock_adapter(),
            "command",
        )
        .unwrap();
        let skipped = ensure_local_sync_server(
            &state,
            port,
            dir.path().to_path_buf(),
            "ensure-test".into(),
            make_mock_adapter(),
            "auto-start",
        )
        .unwrap();

        if let Some(mut server) = state.lock().unwrap().server.take() {
            server.stop();
        }

        assert_eq!(started.outcome, LocalSyncEnsureOutcomeKind::Started);
        assert_eq!(started.port, port);
        assert_eq!(
            started.health.status,
            local_sync_server::SyncServerHealthStatus::Healthy
        );
        assert_eq!(
            skipped.outcome,
            LocalSyncEnsureOutcomeKind::SkippedAlreadyRunning
        );
        assert_eq!(skipped.port, port);
        assert_eq!(skipped.source, "auto-start");
        assert_eq!(
            skipped.health.status,
            local_sync_server::SyncServerHealthStatus::Healthy
        );
    }

    #[test]
    fn ensure_local_sync_server_reports_stale_existing_server_without_rebinding() {
        let dir = tempfile::TempDir::new().unwrap();
        let state = Arc::new(Mutex::new(LocalSyncState::default()));
        let port = find_free_port();
        let replicas_dir = dir.path().join("local-sync").join("replicas");
        let mut stale_server = local_sync_server::SyncServer::start(
            port,
            replicas_dir,
            "stale-test".into(),
            make_mock_adapter(),
        )
        .unwrap();
        stale_server.stop();
        state.lock().unwrap().server = Some(stale_server);

        let failed = ensure_local_sync_server(
            &state,
            port,
            dir.path().to_path_buf(),
            "stale-test".into(),
            make_mock_adapter(),
            "auto-start",
        )
        .unwrap();

        assert_eq!(
            failed.outcome,
            LocalSyncEnsureOutcomeKind::FailedHealthCheck
        );
        assert_eq!(failed.port, port);
        assert_eq!(
            failed.health.status,
            local_sync_server::SyncServerHealthStatus::Unhealthy
        );
        assert!(
            failed.health.detail.contains("Server not listening")
                || failed.health.detail.contains("Connection refused")
                || failed.health.detail.contains("Connection reset"),
            "unexpected stale health detail: {}",
            failed.health.detail
        );
    }
}
