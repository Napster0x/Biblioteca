/**
 * USB HTTP SyncTransport — syncs CRDT replica data via an ADB forward
 * tunnel to a device connected over USB.
 *
 * The ADB forward maps the remote Android sync port to desktop localhost, so the
 * transport connects to `http://localhost:{port}/replicas/{kind}` — the
 * same HTTP endpoints served by the Rust tiny_http server on the device.
 *
 * ADB utility functions (`setupUsbTunnel`, `listUsbDevices`) are exported
 * as separate helpers. They degrade gracefully when `adb` is not installed
 * or the runtime lacks shell access (e.g. pure browser environment).
 *
 * All HTTP requests carry a 5-second timeout via AbortController.
 */
import type { ReplicaRow, Hlc, SyncError } from '@/types/replica';
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

/** Build a SyncError object from a fetch failure. */
function syncError(peerId: string, kind: SyncCategory, err: unknown): SyncError {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Unknown sync error';
  return {
    peerId,
    kind,
    timestamp: Date.now(),
    message,
    cause: message,
  };
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
    const peerId = `localhost:${this.port}`;
    let url = `http://localhost:${this.port}/replicas/${encodeURIComponent(kind)}`;
    if (since) {
      url += `?since=${encodeURIComponent(since)}`;
    }

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, { signal: controller.signal });
      clear();
    } catch (err) {
      throw syncError(peerId, kind, err);
    }

    if (!res.ok) {
      throw {
        peerId,
        kind,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
    }

    const data: unknown = await res.json();
    return filterReplicaRows(data);
  }

  // -------------------------------------------------------------------------
  // Push
  // -------------------------------------------------------------------------

  async push(kind: SyncCategory, rows: ReplicaRow[]): Promise<void> {
    if (rows.length === 0) return;

    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/replicas/${encodeURIComponent(kind)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
        signal: controller.signal,
      });
      clear();
    } catch (err) {
      throw syncError(peerId, kind, err);
    }

    if (!res.ok) {
      throw {
        peerId,
        kind,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
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
    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/dictionary-images/${encodeURIComponent(entryId)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, { signal: controller.signal });
      clear();
    } catch (err) {
      throw syncError(peerId, 'dictionary-entry', err);
    }

    if (res.status === 404) return null;
    if (!res.ok) {
      throw {
        peerId,
        kind: 'dictionary-entry' as SyncCategory,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
    }

    return await res.arrayBuffer();
  }

  async pushDictionaryImage(
    entryId: string,
    imageBytes: ArrayBuffer,
  ): Promise<{ uploaded: boolean }> {
    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/dictionary-images/${encodeURIComponent(entryId)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: imageBytes,
        signal: controller.signal,
      });
      clear();
    } catch (err) {
      throw syncError(peerId, 'dictionary-entry', err);
    }

    if (!res.ok) {
      throw {
        peerId,
        kind: 'dictionary-entry' as SyncCategory,
        timestamp: Date.now(),
        message: `HTTP ${res.status}`,
      } as SyncError;
    }

    return { uploaded: true };
  }
}

// ---------------------------------------------------------------------------
// ADB utility functions
// ---------------------------------------------------------------------------

/**
 * Set up an ADB forward tunnel so the remote device's sync port is reachable
 * from desktop localhost.
 *
 * Executes `adb -s {deviceSerial} forward tcp:{port} tcp:{port}`.
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
      const cmd = `adb -s ${deviceSerial} forward tcp:${port} tcp:${port}`;
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
