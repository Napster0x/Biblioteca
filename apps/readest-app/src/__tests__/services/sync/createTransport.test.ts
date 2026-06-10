import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import type { WebDAVConfig } from '@/services/webdav/WebDAVClient';

// ---------------------------------------------------------------------------
// Mock WebDAVTransport
// ---------------------------------------------------------------------------

const mockWebDAVConstructor = vi.fn();
vi.mock('@/services/sync/WebDAVTransport', () => ({
  WebDAVTransport: vi.fn(function (this: { kind: string }, config: unknown, rootPath: unknown) {
    mockWebDAVConstructor(config, rootPath);
    this.kind = 'webdav';
  }),
}));

// ---------------------------------------------------------------------------
// Mock WiFiHttpTransport
// ---------------------------------------------------------------------------

const mockWifiConstructor = vi.fn();
vi.mock('@/services/sync/WiFiHttpTransport', () => ({
  WiFiHttpTransport: vi.fn(function (this: { kind: string }, host: string, port: number) {
    mockWifiConstructor(host, port);
    this.kind = 'wifi';
  }),
}));

// ---------------------------------------------------------------------------
// Mock USBHttpTransport
// ---------------------------------------------------------------------------

const mockUsbConstructor = vi.fn();
vi.mock('@/services/sync/USBHttpTransport', () => ({
  USBHttpTransport: vi.fn(function (this: { kind: string }, port: number) {
    mockUsbConstructor(port);
    this.kind = 'usb';
  }),
}));

// Must import after mocks are set up
const { createTransport } = await import('@/services/sync/createTransport');

// ---------------------------------------------------------------------------
// Test configs
// ---------------------------------------------------------------------------

const WEBDAV_CONFIG: WebDAVConfig = {
  serverUrl: 'https://dav.example.com',
  username: 'user',
  password: 'pass',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // WebDAV
  // -------------------------------------------------------------------------

  describe("type: 'webdav'", () => {
    it('returns a transport with kind "webdav"', () => {
      const t = createTransport('webdav', { config: WEBDAV_CONFIG, rootPath: '/books' });
      expect(t.kind).toBe('webdav');
    });

    it('constructs WebDAVTransport with config and rootPath', () => {
      createTransport('webdav', { config: WEBDAV_CONFIG, rootPath: '/books' });

      expect(mockWebDAVConstructor).toHaveBeenCalledWith(WEBDAV_CONFIG, '/books');
    });

    it('defaults rootPath to "/" when not provided', () => {
      createTransport('webdav', { config: WEBDAV_CONFIG });

      expect(mockWebDAVConstructor).toHaveBeenCalledWith(WEBDAV_CONFIG, '/');
    });
  });

  // -------------------------------------------------------------------------
  // WiFi
  // -------------------------------------------------------------------------

  describe("type: 'wifi'", () => {
    it('returns a transport with kind "wifi"', () => {
      const t = createTransport('wifi', { host: '192.168.1.10', port: 7878 });
      expect(t.kind).toBe('wifi');
    });

    it('constructs WiFiHttpTransport with host and port', () => {
      createTransport('wifi', { host: '10.0.0.5', port: 9090 });

      expect(mockWifiConstructor).toHaveBeenCalledWith('10.0.0.5', 9090);
    });

    it('accepts hostname values', () => {
      createTransport('wifi', { host: 'living-room.local', port: 7878 });

      expect(mockWifiConstructor).toHaveBeenCalledWith('living-room.local', 7878);
    });
  });

  // -------------------------------------------------------------------------
  // USB
  // -------------------------------------------------------------------------

  describe("type: 'usb'", () => {
    it('returns a transport with kind "usb"', () => {
      const t = createTransport('usb', { port: 7878 });
      expect(t.kind).toBe('usb');
    });

    it('constructs USBHttpTransport with port', () => {
      createTransport('usb', { port: 9999 });

      expect(mockUsbConstructor).toHaveBeenCalledWith(9999);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid
  // -------------------------------------------------------------------------

  describe('invalid type', () => {
    it('throws an error for unknown transport types', () => {
      expect(() =>
        createTransport('something-else' as 'webdav', {} as Parameters<typeof createTransport>[1]),
      ).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Return type
  // -------------------------------------------------------------------------

  describe('return type', () => {
    it('returns objects that satisfy SyncTransport interface', () => {
      const webdav: SyncTransport = createTransport('webdav', { config: WEBDAV_CONFIG });
      expect(webdav.kind).toBe('webdav');

      const wifi: SyncTransport = createTransport('wifi', { host: 'localhost', port: 7878 });
      expect(wifi.kind).toBe('wifi');

      const usb: SyncTransport = createTransport('usb', { port: 7878 });
      expect(usb.kind).toBe('usb');
    });
  });
});
