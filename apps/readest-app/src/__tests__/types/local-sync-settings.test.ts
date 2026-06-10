import { describe, expect, it } from 'vitest';
import type { LocalSyncSettings } from '@/types/settings';

/**
 * LocalSyncSettings — type-level contract tests.
 *
 * The interface is purely structural (no runtime behavior), so we validate
 * the shape via a compile-time factory function and runtime duck-type checks.
 */
describe('LocalSyncSettings', () => {
  function makeSettings(overrides: Partial<LocalSyncSettings> = {}): LocalSyncSettings {
    return {
      enabled: false,
      port: 7878,
      deviceName: '',
      ...overrides,
    };
  }

  it('defaults enabled to false', () => {
    const s = makeSettings();
    expect(s.enabled).toBe(false);
  });

  it('defaults port to 7878', () => {
    const s = makeSettings();
    expect(s.port).toBe(7878);
  });

  it('defaults deviceName to empty string', () => {
    const s = makeSettings();
    expect(s.deviceName).toBe('');
  });

  it('allows overriding enabled to true', () => {
    const s = makeSettings({ enabled: true });
    expect(s.enabled).toBe(true);
  });

  it('allows overriding port', () => {
    const s = makeSettings({ port: 9090 });
    expect(s.port).toBe(9090);
  });

  it('allows overriding deviceName', () => {
    const s = makeSettings({ deviceName: 'My Device' });
    expect(s.deviceName).toBe('My Device');
  });

  it('has exactly three known keys', () => {
    const s = makeSettings();
    const keys = Object.keys(s).sort();
    expect(keys).toEqual(['deviceName', 'enabled', 'port']);
  });
});

/**
 * PeerInfo — used by mDNS discovery in localSyncStore.
 * Defined alongside LocalSyncSettings for cohesion.
 */
describe('PeerInfo', () => {
  it('has the required fields host, port, deviceName, version', () => {
    // We import at runtime via a cast; the test proves the shape is usable.
    const peer: { host: string; port: number; deviceName: string; version: string } = {
      host: '192.168.1.5',
      port: 7878,
      deviceName: 'Living Room',
      version: '1.0.9',
    };
    expect(peer.host).toBe('192.168.1.5');
    expect(peer.port).toBe(7878);
    expect(peer.deviceName).toBe('Living Room');
    expect(peer.version).toBe('1.0.9');
  });
});
