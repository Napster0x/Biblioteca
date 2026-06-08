/**
 * Hybrid Logical Clock (HLC) generator and comparator.
 *
 * HLC format: `${physicalMs:13-hex}-${counter:8-hex}-${deviceId}`
 *
 * Lexicographic string comparison of HLCs matches temporal order because
 * each component is fixed-width zero-padded hex, so string sort equals
 * logical-time sort.
 */

import type { Hlc } from '@/types/replica';

/**
 * Hexadecimal representation of a number with exactly `width` digits,
 * zero-padded on the left.
 */
function toHexPadded(value: number, width: number): string {
  return value.toString(16).padStart(width, '0');
}

/**
 * Parse the timestamp (milliseconds) from an HLC string.
 * Returns 0 if parsing fails.
 */
function parseTimestamp(hlc: Hlc): number {
  const tsStr = hlc.substring(0, 13);
  return parseInt(tsStr, 16);
}

/**
 * Parse the counter from an HLC string.
 * Returns 0 if parsing fails.
 */
function parseCounter(hlc: Hlc): number {
  const counterStart = 14; // after 13-hex + '-'
  const counterStr = hlc.substring(counterStart, counterStart + 8);
  return parseInt(counterStr, 16);
}

/**
 * Mint a new HLC timestamp.
 *
 * If `lastHLC` is provided and has the same wall-clock millisecond as the
 * current call, the logical counter is incremented by 1. Otherwise, the
 * counter resets to 1.
 *
 * @param deviceId - Stable per-device identifier (uuidv4).
 * @param lastHLC  - The last HLC minted by this device (optional).
 * @returns A new HLC string with the branded Hlc type.
 */
export function mintHLC(deviceId: string, lastHLC?: Hlc): Hlc {
  const nowMs = Date.now();
  const hexMs = toHexPadded(nowMs, 13);

  let counter: number;
  if (lastHLC) {
    const lastMs = parseTimestamp(lastHLC);
    if (lastMs === nowMs) {
      counter = parseCounter(lastHLC) + 1;
    } else {
      counter = 1;
    }
  } else {
    counter = 1;
  }

  const hexCounter = toHexPadded(counter, 8);
  return `${hexMs}-${hexCounter}-${deviceId}` as Hlc;
}

/**
 * Compare two HLC strings lexicographically.
 *
 * Because each component (timestamp, counter, deviceId) is fixed-width and
 * left-padded, string comparison matches temporal ordering.
 *
 * @returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareHLC(a: Hlc, b: Hlc): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export type { Hlc };
