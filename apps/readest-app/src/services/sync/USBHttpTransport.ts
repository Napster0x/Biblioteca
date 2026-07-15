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
import type { Book } from '@/types/book';
import type { SyncCategory } from '@/types/settings';
import type {
  SyncTransport,
  UsbBookAssetName,
  UsbBookManifest,
} from '@/services/sync/SyncTransport';

// ---------------------------------------------------------------------------
// Image integrity helpers
// ---------------------------------------------------------------------------

export const PNG_MAGIC = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Check whether `bytes` starts with the PNG magic signature.
 */
export function isPng(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  const header = new Uint8Array(bytes.slice(0, PNG_MAGIC.length));
  return PNG_MAGIC.every((b, i) => header[i] === b);
}

/**
 * Validate that `bytes` is a valid PNG and matches optional expected
 * manifest metadata (byteSize, sha256).
 *
 * The sha256 check uses `crypto.subtle.digest` and is async. When the
 * runtime does not support `crypto.subtle`, sha256 validation is skipped
 * with a false return (fail-safe: assume mismatch).
 */
export async function verifyImageManifest(
  bytes: ArrayBuffer,
  manifest: { byteSize?: number; sha256?: string },
): Promise<{ valid: boolean; error?: string }> {
  if (!isPng(bytes)) {
    return { valid: false, error: 'Not a valid PNG image' };
  }
  if (manifest.byteSize !== undefined && bytes.byteLength !== manifest.byteSize) {
    return {
      valid: false,
      error: `Image byteSize mismatch: expected ${manifest.byteSize}, received ${bytes.byteLength}`,
    };
  }
  if (manifest.sha256 !== undefined) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const computed = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      if (computed !== manifest.sha256) {
        return {
          valid: false,
          error: `Image SHA-256 mismatch: expected ${manifest.sha256}, computed ${computed}`,
        };
      }
    } catch {
      return { valid: false, error: 'SHA-256 computation unavailable' };
    }
  }
  return { valid: true };
}

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

function sanitizeBookForUsbLibrary(book: Book): Book {
  const { coverImageUrl: _coverImageUrl, filePath: _filePath, ...rest } = book;
  return rest;
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

async function httpError(peerId: string, kind: SyncCategory, res: Response): Promise<SyncError> {
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    detail = '';
  }
  const suffix = detail ? `: ${detail}` : '';
  return {
    peerId,
    kind,
    timestamp: Date.now(),
    message: `HTTP ${res.status}${suffix}`,
    cause: detail || `HTTP ${res.status}`,
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
      throw await httpError(peerId, kind, res);
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
      throw await httpError(peerId, kind, res);
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

    // Validate PNG magic before sending
    if (!isPng(imageBytes)) {
      throw {
        peerId,
        kind: 'dictionary-entry' as SyncCategory,
        timestamp: Date.now(),
        message: 'Not a valid PNG image',
      } as SyncError;
    }

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

  // -------------------------------------------------------------------------
  // Book binary sync
  // -------------------------------------------------------------------------

  async pullBookManifest(): Promise<UsbBookManifest> {
    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/books/manifest`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, { signal: controller.signal });
      clear();
    } catch (err) {
      throw syncError(peerId, 'annotation', err);
    }

    if (!res.ok) {
      throw await httpError(peerId, 'annotation', res);
    }

    return (await res.json()) as UsbBookManifest;
  }

  async pullBookLibrary(): Promise<Book[]> {
    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/books/library`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, { signal: controller.signal });
      clear();
    } catch (err) {
      throw syncError(peerId, 'annotation', err);
    }

    if (!res.ok) {
      throw await httpError(peerId, 'annotation', res);
    }

    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as Book[]) : [];
  }

  async pushBookLibrary(books: Book[]): Promise<void> {
    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/books/library`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(books.map(sanitizeBookForUsbLibrary)),
        signal: controller.signal,
      });
      clear();
    } catch (err) {
      throw syncError(peerId, 'annotation', err);
    }

    if (!res.ok) {
      throw await httpError(peerId, 'annotation', res);
    }
  }

  async pullBookAsset(
    hash: string,
    asset: UsbBookAssetName,
    options: { optional?: boolean } = {},
  ): Promise<ArrayBuffer | null> {
    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/books/assets/${encodeURIComponent(hash)}/${encodeURIComponent(asset)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, { signal: controller.signal });
      clear();
    } catch (err) {
      throw syncError(peerId, 'book' as SyncCategory, err);
    }

    if (res.status === 404 && options.optional) return null;
    if (!res.ok) {
      throw await httpError(peerId, 'book' as SyncCategory, res);
    }

    return await res.arrayBuffer();
  }

  async pushBookAsset(hash: string, asset: UsbBookAssetName, bytes: ArrayBuffer): Promise<void> {
    const peerId = `localhost:${this.port}`;
    const url = `http://localhost:${this.port}/books/assets/${encodeURIComponent(hash)}/${encodeURIComponent(asset)}`;

    let res: Response;
    try {
      const { controller, clear } = createTimeoutController();
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
        signal: controller.signal,
      });
      clear();
    } catch (err) {
      throw syncError(peerId, 'book' as SyncCategory, err);
    }

    if (!res.ok) {
      throw await httpError(peerId, 'book' as SyncCategory, res);
    }
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
