/**
 * USB HTTP SyncTransport — syncs CRDT replica data via an ADB reverse
 * tunnel to a device connected over USB.
 *
 * The ADB tunnel maps the remote device's sync port to localhost, so the
 * transport connects to `http://localhost:{port}/replicas/{kind}` — the
 * same HTTP endpoints served by the Rust tiny_http server on the device.
 *
 * ADB utility functions (`setupUsbTunnel`, `listUsbDevices`) are exported
 * as separate helpers. They degrade gracefully when `adb` is not installed
 * or the runtime lacks shell access (e.g. pure browser environment).
 *
 * All HTTP requests carry a 5-second timeout via AbortController.
 */
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';
import type { SyncTransport } from '@/services/sync/SyncTransport';

// ---------------------------------------------------------------------------
// Shared helpers (mirrors WiFiHttpTransport)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 5000;

function createTimeoutController(): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return { controller, clear: () => clearTimeout(timeout) };
}

function filterReplicaRows(data: unknown): ReplicaRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is ReplicaRow =>
      typeof row === 'object' && row !== null && (row as ReplicaRow).schema_version === 1,
  );
}

// ---------------------------------------------------------------------------
// USBHttpTransport
// ---------------------------------------------------------------------------

export class USBHttpTransport implements SyncTransport {
  readonly kind = 'usb' as const;

  constructor(private readonly port: number) {}

  // -------------------------------------------------------------------------
  // Pull
  // -------------------------------------------------------------------------

  async pull(kind: SyncCategory, since?: Hlc): Promise<ReplicaRow[]> {
    let url = `http://localhost:${this.port}/replicas/${encodeURIComponent(kind)}`;
    if (since) {
      url += `?since=${encodeURIComponent(since)}`;
    }

    try {
      const { controller, clear } = createTimeoutController();
      const res = await fetch(url, { signal: controller.signal });
      clear();

      if (!res.ok) return [];

      const data: unknown = await res.json();
      return filterReplicaRows(data);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Push
  // -------------------------------------------------------------------------

  async push(kind: SyncCategory, rows: ReplicaRow[]): Promise<void> {
    if (rows.length === 0) return;

    const url = `http://localhost:${this.port}/replicas/${encodeURIComponent(kind)}`;

    try {
      const { controller, clear } = createTimeoutController();
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
        signal: controller.signal,
      });
      clear();
    } catch {
      // Best-effort push.
    }
  }

  // -------------------------------------------------------------------------
  // Reachability
  // -------------------------------------------------------------------------

  async isReachable(): Promise<boolean> {
    try {
      const { controller, clear } = createTimeoutController();
      const res = await fetch(`http://localhost:${this.port}/health`, {
        signal: controller.signal,
      });
      clear();
      return res.ok;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Dictionary image binary sync
  // -------------------------------------------------------------------------

  async pullDictionaryImage(entryId: string): Promise<ArrayBuffer | null> {
    const url = `http://localhost:${this.port}/dictionary-images/${encodeURIComponent(entryId)}`;

    try {
      const { controller, clear } = createTimeoutController();
      const res = await fetch(url, { signal: controller.signal });
      clear();

      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }

  async pushDictionaryImage(
    entryId: string,
    imageBytes: ArrayBuffer,
  ): Promise<{ uploaded: boolean }> {
    const url = `http://localhost:${this.port}/dictionary-images/${encodeURIComponent(entryId)}`;

    try {
      const { controller, clear } = createTimeoutController();
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: imageBytes,
        signal: controller.signal,
      });
      clear();

      return { uploaded: res.ok };
    } catch {
      return { uploaded: false };
    }
  }
}

// ---------------------------------------------------------------------------
// ADB utility functions
// ---------------------------------------------------------------------------

/**
 * Set up a reverse ADB tunnel so the remote device's sync port is forwarded
 * to localhost.
 *
 * Executes `adb -s {deviceSerial} reverse tcp:{port} tcp:{port}`.
 * Returns `{ success: true }` when the command succeeds, or
 * `{ success: false, error }` when adb is not available or the command
 * fails.
 */
export async function setupUsbTunnel(
  deviceSerial: string,
  port: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
      const cmd = `adb -s ${deviceSerial} reverse tcp:${port} tcp:${port}`;
      exec(cmd, (error) => {
        if (error) {
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch {
    return { success: false, error: 'adb not available in this runtime' };
  }
}

/**
 * List serial numbers of Android devices connected via ADB.
 *
 * Runs `adb devices` and parses the output, skipping the "List of devices
 * attached" header and filtering to non-empty serials.
 *
 * Returns an empty array when `adb` is not installed or when no devices
 * are connected — the caller should never crash on a missing ADB.
 */
export async function listUsbDevices(): Promise<string[]> {
  try {
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
      exec('adb devices', (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const lines = stdout.split('\n').slice(1); // Skip header
        const devices = lines
          .map((line) => line.split('\t')[0]!.trim())
          .filter((serial) => serial.length > 0);
        resolve(devices);
      });
    });
  } catch {
    return [];
  }
}
