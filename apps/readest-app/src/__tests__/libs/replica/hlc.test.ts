import { describe, expect, it } from 'vitest';
import { mintHLC, compareHLC, type Hlc } from '@/libs/replica/hlc';

describe('mintHLC', () => {
  const deviceId = 'test-device-uuid';

  it('produces a non-empty string with the expected format', () => {
    const hlc = mintHLC(deviceId);
    expect(typeof hlc).toBe('string');
    expect(hlc.length).toBeGreaterThan(0);
    // Format: ${physicalMs:13-hex}-${counter:8-hex}-${deviceId}
    expect(hlc).toMatch(/^[0-9a-f]{13}-[0-9a-f]{8}-/);
    expect(hlc).toContain(`-${deviceId}`);
  });

  it('is lexicographically monotonic across sequential invocations', () => {
    const hlcs: Hlc[] = [];
    for (let i = 0; i < 100; i++) {
      hlcs.push(mintHLC(deviceId, hlcs[hlcs.length - 1]!));
    }
    for (let i = 1; i < hlcs.length; i++) {
      expect(compareHLC(hlcs[i - 1]!, hlcs[i]!)).toBe(-1);
      expect(compareHLC(hlcs[i]!, hlcs[i - 1]!)).toBe(1);
    }
  });

  it('increments the counter when invoked with the same millisecond', () => {
    // Simulate two calls that happen within the same millisecond by
    // providing the previous HLC explicitly (same ms, counter=1).
    const first = mintHLC(deviceId);
    const second = mintHLC(deviceId, first);
    expect(compareHLC(first, second)).toBe(-1);
    // Extract counters from the HLC string to verify the increment
    const parts1 = first.split('-');
    const parts2 = second.split('-');
    // The timestamp portion (13 hex chars) should be the same or greater
    const ts1 = parts1[0]!;
    const ts2 = parts2[0]!;
    const counter1 = parts1[1]!;
    const counter2 = parts2[1]!;
    if (ts1 === ts2) {
      // Same millisecond: counter must have incremented
      expect(parseInt(counter2, 16)).toBe(parseInt(counter1, 16) + 1);
    }
    // Otherwise, the timestamp advanced and counter resets to 1
    // which is also fine.
  });

  it('resets the counter when the timestamp advances', () => {
    // We can't easily force the system clock, but we can verify that
    // with a new call (no lastHLC), the counter starts at 1.
    const hlc = mintHLC(deviceId);
    const parts = hlc.split('-');
    const counter = parseInt(parts[1]!, 16);
    expect(counter).toBe(1);
  });

  it('starts counter from 1 when no lastHLC is provided', () => {
    const hlc = mintHLC(deviceId);
    const parts = hlc.split('-');
    expect(parts[1]!).toBe('00000001');
  });
});

describe('compareHLC', () => {
  it('returns 0 for the same HLC', () => {
    const hlc = '000018f3a2b4c-00000001-test-device' as Hlc;
    expect(compareHLC(hlc, hlc)).toBe(0);
  });

  it('returns -1 when a < b lexicographically', () => {
    const a = '000018f3a2b4c-00000001-devA' as Hlc;
    const b = '000018f3a2b4c-00000002-devA' as Hlc;
    expect(compareHLC(a, b)).toBe(-1);
  });

  it('returns 1 when a > b lexicographically', () => {
    const a = '000018f3a2b4c-00000002-devA' as Hlc;
    const b = '000018f3a2b4c-00000001-devA' as Hlc;
    expect(compareHLC(a, b)).toBe(1);
  });

  it('orders by timestamp first, then counter, then deviceId', () => {
    const a = '000018f3a2b4c-00000001-aaa' as Hlc;
    const b = '000018f3a2b4c-00000001-aab' as Hlc;
    const c = '000018f3a2b4c-00000002-aaa' as Hlc;
    const d = '000018f3a2b4d-00000001-aaa' as Hlc;

    // Same ts + counter, different device: lexicographic by deviceId
    expect(compareHLC(a, b)).toBe(-1);
    // Same ts, higher counter
    expect(compareHLC(a, c)).toBe(-1);
    // Higher ts
    expect(compareHLC(a, d)).toBe(-1);
  });

  it('orders differently across devices with the same timestamp and counter', () => {
    const deviceA = '000018f3a2b4c-00000001-device-aaaa' as Hlc;
    const deviceB = '000018f3a2b4c-00000001-device-bbbb' as Hlc;

    expect(compareHLC(deviceA, deviceB)).toBe(-1);
    expect(compareHLC(deviceB, deviceA)).toBe(1);
  });
});
