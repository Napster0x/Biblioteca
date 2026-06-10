/**
 * local_sync_discovery — mDNS service registration and browsing.
 *
 * Registers this device as `_readest-sync._tcp.local.` on the configured
 * TCP port and simultaneously browses for other instances. Discovered
 * peers are reported via a caller-supplied callback, which the Tauri
 * command wires to the `local-sync:peer-discovered` event.
 *
 * TXT records carry `device_name` and `version` so peers can show
 * human-friendly labels in the UI.
 */

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// mDNS service type for Readest local sync.
const SERVICE_TYPE: &str = "_readest-sync._tcp.local.";

// ── Models ────────────────────────────────────────────────────────────────

/// Information about a discovered LAN peer.
/// Mirrors the TypeScript `PeerInfo` interface (src/types/settings.ts:94).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub host: String,
    pub port: u16,
    #[serde(rename = "deviceName")]
    pub device_name: String,
    pub version: String,
}

// ── Discovery ─────────────────────────────────────────────────────────────

/// Manages mDNS service registration and browsing.
///
/// On `start()`: registers our service + spawns a browse thread.
/// On `stop()`: unregisters the service, shuts down the daemon,
/// and joins the browse thread.
pub struct MdnsDiscovery {
    daemon: ServiceDaemon,
    handle: Option<JoinHandle<()>>,
    fullname: String,
}

impl MdnsDiscovery {
    /// Start mDNS discovery.
    ///
    /// Registers `_readest-sync._tcp` on `port` and begins browsing for
    /// other instances of the same service type. Each new peer is reported
    /// via `emit_peer`. Already-seen peers (by full service name) are
    /// deduplicated automatically.
    ///
    /// `device_name` and `version` are advertised as TXT records so peers
    /// can display them in their UI.
    pub fn start(
        port: u16,
        device_name: String,
        version: String,
        emit_peer: Box<dyn Fn(PeerInfo) + Send + 'static>,
    ) -> Result<Self, String> {
        let daemon =
            ServiceDaemon::new().map_err(|e| format!("mDNS daemon: {e}"))?;

        // ── Find a non-loopback IPv4 address to advertise ─────────────
        let ip = find_local_ipv4().unwrap_or_else(|| {
            log::warn!("[local-sync] No non-loopback IPv4 found, using 0.0.0.0");
            "0.0.0.0".to_string()
        });

        // ── Build and register our service ────────────────────────────
        let instance_name = sanitize_instance_name(&device_name);
        let host_name = format!("{}.local.", ip);
        let txt_props = vec![
            ("device_name", device_name.as_str()),
            ("version", version.as_str()),
        ];

        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_name,
            &ip,
            port,
            &txt_props[..],
        )
        .map_err(|e| format!("ServiceInfo: {e}"))?;

        let fullname = service_info.get_fullname().to_string();

        daemon
            .register(service_info)
            .map_err(|e| format!("mDNS register: {e}"))?;

        // ── Browse for peers ──────────────────────────────────────────
        let receiver = daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("mDNS browse: {e}"))?;

        // Track seen services so we only emit each peer once.
        let seen: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

        let own_fullname = fullname.clone();

        let handle = thread::spawn(move || {
            // Poll with timeout so we can detect daemon shutdown.
            while let Ok(event) = receiver.recv_timeout(Duration::from_secs(1)) {
                if let ServiceEvent::ServiceResolved(info) = event {
                    let key = info.get_fullname().to_string();

                    // Deduplicate
                    {
                        let mut locked = seen.lock().unwrap();
                        if !locked.insert(key.clone()) {
                            continue;
                        }
                    }

                    // Skip our own service
                    if key == own_fullname {
                        continue;
                    }

                    let host = info
                        .get_addresses_v4()
                        .iter()
                        .next()
                        .map(|a| a.to_string())
                        .unwrap_or_else(|| "unknown".into());

                    let props = info.get_properties();
                    let peer_device_name = props
                        .get("device_name")
                        .map(|v| v.val_str().to_string())
                        .unwrap_or_else(|| "unknown".into());
                    let peer_version = props
                        .get("version")
                        .map(|v| v.val_str().to_string())
                        .unwrap_or_else(|| "0.0.0".into());

                    let peer = PeerInfo {
                        host,
                        port: info.get_port(),
                        device_name: peer_device_name,
                        version: peer_version,
                    };

                    emit_peer(peer);
                }
            }
        });

        Ok(MdnsDiscovery {
            daemon,
            handle: Some(handle),
            fullname,
        })
    }

    /// Stop discovery: unregister service, shutdown daemon, join thread.
    pub fn stop(&mut self) -> Result<(), String> {
        self.daemon
            .unregister(&self.fullname)
            .map_err(|e| format!("mDNS unregister: {e}"))?;

        self.daemon
            .shutdown()
            .map_err(|e| format!("mDNS shutdown: {e}"))?;

        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }

        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/// Find the first non-loopback IPv4 address on this machine.
fn find_local_ipv4() -> Option<String> {
    let ifaces = if_addrs::get_if_addrs().ok()?;

    ifaces
        .iter()
        .find(|i| !i.is_loopback())
        .and_then(|i| match i.ip() {
            std::net::IpAddr::V4(addr) if !addr.is_loopback() => {
                // Prefer non-link-local addresses
                if !addr.is_link_local() {
                    Some(addr.to_string())
                } else {
                    // Link-local is better than nothing
                    Some(addr.to_string())
                }
            }
            _ => None,
        })
}

/// Sanitize a device name for use as an mDNS instance name.
///
/// RFC 6763 allows instance names (the first label) to contain UTF-8,
/// but spaces and certain characters should be replaced for robustness.
fn sanitize_instance_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        match c {
            ' ' | '\t' | '\r' | '\n' => out.push('-'),
            c if c.is_ascii_alphanumeric() || c == '-' || c == '_' => out.push(c),
            // Drop non-ASCII chars for instance name simplicity
            _ => {}
        }
    }
    if out.is_empty() || out.trim_matches('-').is_empty() {
        "readest".to_string()
    } else {
        out
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_keeps_alphanumeric() {
        assert_eq!(sanitize_instance_name("MyDevice"), "MyDevice");
    }

    #[test]
    fn sanitize_replaces_spaces() {
        assert_eq!(
            sanitize_instance_name("My Device 2"),
            "My-Device-2"
        );
    }

    #[test]
    fn sanitize_drops_emoji() {
        assert_eq!(sanitize_instance_name("test🎉"), "test");
    }

    #[test]
    fn sanitize_empty_uses_default() {
        assert_eq!(sanitize_instance_name(""), "readest");
        assert_eq!(sanitize_instance_name("   "), "readest");
    }

    #[test]
    fn peer_info_serializes_camel_case() {
        let peer = PeerInfo {
            host: "192.168.1.5".into(),
            port: 7878,
            device_name: "Living Room".into(),
            version: "1.0.0".into(),
        };
        let json = serde_json::to_value(&peer).unwrap();
        assert_eq!(json["host"], "192.168.1.5");
        assert_eq!(json["port"], 7878);
        assert_eq!(json["deviceName"], "Living Room");
        assert_eq!(json["version"], "1.0.0");
    }

    #[test]
    fn find_local_ipv4_returns_valid_ip() {
        let ip = find_local_ipv4();
        if let Some(addr_str) = ip {
            let parsed: std::net::Ipv4Addr = addr_str.parse().unwrap();
            assert!(!parsed.is_loopback());
            assert!(!parsed.is_unspecified());
        }
        // In CI without network, this may return None — that's ok.
    }
}
