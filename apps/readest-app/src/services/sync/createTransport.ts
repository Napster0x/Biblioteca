/**
 * Transport factory — constructs SyncTransport instances based on type
 * and configuration.
 *
 * Returns a concrete SyncTransport:
 *   - 'webdav' → WebDAVTransport (cloud sync via WebDAV)
 *   - 'wifi'   → WiFiHttpTransport (LAN peer via HTTP)
 *   - 'usb'    → USBHttpTransport (localhost via ADB tunnel)
 *
 * Throws for unknown transport types.
 */
import type { SyncTransport } from '@/services/sync/SyncTransport';
import type { WebDAVConfig } from '@/services/webdav/WebDAVClient';
import { WebDAVTransport } from '@/services/sync/WebDAVTransport';
import { WiFiHttpTransport } from '@/services/sync/WiFiHttpTransport';
import { USBHttpTransport } from '@/services/sync/USBHttpTransport';

// ---------------------------------------------------------------------------
// Config shapes
// ---------------------------------------------------------------------------

export interface WebDAVTransportConfig {
  config: WebDAVConfig;
  rootPath?: string;
}

export interface WiFiTransportConfig {
  host: string;
  port: number;
}

export interface USBTransportConfig {
  port: number;
}

export type TransportConfig = WebDAVTransportConfig | WiFiTransportConfig | USBTransportConfig;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTransport(type: 'webdav', config: WebDAVTransportConfig): SyncTransport;
export function createTransport(type: 'wifi', config: WiFiTransportConfig): SyncTransport;
export function createTransport(type: 'usb', config: USBTransportConfig): SyncTransport;
export function createTransport(
  type: 'webdav' | 'wifi' | 'usb',
  config: TransportConfig,
): SyncTransport {
  switch (type) {
    case 'webdav': {
      const { config: wdConfig, rootPath } = config as WebDAVTransportConfig;
      return new WebDAVTransport(wdConfig, rootPath ?? '/');
    }
    case 'wifi': {
      const { host, port } = config as WiFiTransportConfig;
      return new WiFiHttpTransport(host, port);
    }
    case 'usb': {
      const { port } = config as USBTransportConfig;
      return new USBHttpTransport(port);
    }
    default:
      throw new Error(`Unknown transport type: ${type}`);
  }
}
