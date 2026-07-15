import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import {
  getBookNavFilename,
  getConfigFilename,
  getCoverFilename,
  getLibraryFilename,
  getLocalBookFilename,
} from '@/utils/book';
import { mergeImportedLibraryBooks } from '@/services/libraryService';
import type { Hlc } from '@/types/replica';
import type {
  SyncTransport,
  UsbBookAssetName,
  UsbBookManifest,
} from '@/services/sync/SyncTransport';

export interface UsbBookFileService {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, bytes: ArrayBuffer): Promise<void>;
  fileExists(path: string): Promise<boolean>;
}

export interface UsbBookSyncResult {
  sent: number;
  received: number;
  failedHashes: string[];
  errors: string[];
}

// ── Scoped config merge ─────────────────────────────────────────────────────

/** Fields within BookConfig that are merged per-field with HLC comparison. */
const SCOPED_CONFIG_FIELDS = ['progress', 'booknotes', 'viewSettings'] as const;

/** Per-field HLC timestamps stored in `_replica.fieldTimestamps` inside config.json. */
export interface FieldTimestamps {
  [fieldName: string]: Hlc;
}

/** Extract per-field timestamps from a parsed config object. */
function extractFieldTimestamps(config: Record<string, unknown>): FieldTimestamps {
  const replica = config['_replica'] as { fieldTimestamps?: FieldTimestamps } | undefined;
  return replica?.fieldTimestamps ?? {};
}

/**
 * Merge two book configs using per-field HLC comparison.
 *
 * Only `SCOPED_CONFIG_FIELDS` are compared; all other fields (unscoped) are
 * preserved from the local config. The `_replica.fieldTimestamps` metadata is
 * updated to reflect merged timestamps.
 */
export function mergeBookConfig(localJson: string, remoteJson: string): string {
  const local = JSON.parse(localJson) as Record<string, unknown>;
  const remote = JSON.parse(remoteJson) as Record<string, unknown>;
  const localTimestamps = extractFieldTimestamps(local);
  const remoteTimestamps = extractFieldTimestamps(remote);

  // Start with local as base (preserves unscoped fields)
  const merged: Record<string, unknown> = { ...local };
  const mergedTimestamps: FieldTimestamps = { ...localTimestamps };

  for (const field of SCOPED_CONFIG_FIELDS) {
    const remoteValue = remote[field];
    if (remoteValue === undefined) continue;

    const localTs = localTimestamps[field];
    const remoteTs = remoteTimestamps[field];

    if (!localTs || (remoteTs && remoteTs > localTs)) {
      // Remote is newer (or local has no timestamp) → take remote value
      merged[field] = remoteValue;
      if (remoteTs) {
        mergedTimestamps[field] = remoteTs;
      }
    }
  }

  merged['_replica'] = { fieldTimestamps: mergedTimestamps };
  merged['updatedAt'] = Date.now();

  return JSON.stringify(merged);
}

/** Read a book's config.json as a string. Returns null if the file does not exist. */
async function readBookConfig(files: UsbBookFileService, book: Book): Promise<string | null> {
  try {
    const path = getConfigFilename(book);
    return await files.readText(path);
  } catch (e) {
    return null;
  }
}

/** Write a book's config.json string to disk. */
async function writeBookConfig(files: UsbBookFileService, book: Book, json: string): Promise<void> {
  await files.writeText(getConfigFilename(book), json);
}

const REQUIRED_ASSETS: readonly UsbBookAssetName[] = ['book', 'cover.png', 'config.json'];

export function createUsbBookFileService(appService: AppService): UsbBookFileService {
  return {
    async readText(path) {
      return (await appService.readFile(path, 'Books', 'text')) as string;
    },
    async writeText(path, text) {
      await appService.writeFile(path, 'Books', text);
    },
    async readBinary(path) {
      return (await appService.readFile(path, 'Books', 'binary')) as ArrayBuffer;
    },
    async writeBinary(path, bytes) {
      await appService.writeFile(path, 'Books', bytes);
    },
    async fileExists(path) {
      return await appService.exists(path, 'Books');
    },
  };
}

function sanitizeBook(book: Book): Book {
  const { coverImageUrl: _coverImageUrl, filePath: _filePath, ...rest } = book;
  return {
    ...rest,
    filePath: undefined,
    downloadedAt: book.downloadedAt ?? Date.now(),
    uploadedAt: null,
    deletedAt: null,
  };
}

function ownedArrayBuffer(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}

function parseLibrary(raw: string): Book[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (book): book is Book =>
      typeof book === 'object' &&
      book !== null &&
      typeof (book as Book).hash === 'string' &&
      (typeof (book as Book).title === 'string' || typeof (book as Book).title === 'object'),
  );
}

async function readLocalLibrary(files: UsbBookFileService): Promise<Book[]> {
  try {
    const raw = await files.readText(getLibraryFilename());
    return parseLibrary(raw);
  } catch (e) {
    return [];
  }
}

async function writeLocalLibrary(files: UsbBookFileService, books: Book[]): Promise<void> {
  const json = JSON.stringify(books);
  await files.writeText(`${getLibraryFilename()}.bak`, json);
  await files.writeText(getLibraryFilename(), json);
}

function assetPath(book: Book, asset: UsbBookAssetName): string {
  switch (asset) {
    case 'book':
      return getLocalBookFilename(book);
    case 'cover.png':
      return getCoverFilename(book);
    case 'config.json':
      return getConfigFilename(book);
    case 'nav.json':
      return getBookNavFilename(book);
  }
}

function hasBook(library: Book[], hash: string): boolean {
  return library.some((book) => book.hash === hash && !book.deletedAt);
}

function manifestBooks(manifest: UsbBookManifest): Map<string, Book> {
  return new Map(manifest.books.map((entry) => [entry.hash, entry.book]));
}

async function pullRemoteLibraryBooks(
  transport: SyncTransport,
  result: UsbBookSyncResult,
): Promise<Book[]> {
  if (!transport.pullBookLibrary) return [];
  try {
    return await transport.pullBookLibrary();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`pullBookLibrary: ${msg}`);
    return [];
  }
}

function mergeRemoteBooks(manifest: UsbBookManifest, libraryBooks: Book[]): Map<string, Book> {
  const books = manifestBooks(manifest);
  for (const book of libraryBooks) {
    books.set(book.hash, book);
  }
  return books;
}

function isLocalReimportAfterRemoteDelete(localBook: Book, remoteBook: Book): boolean {
  return (
    !localBook.deletedAt && !!remoteBook.deletedAt && localBook.createdAt > remoteBook.deletedAt
  );
}

async function receiveBook(
  entry: UsbBookManifest['books'][number],
  transport: SyncTransport,
  files: UsbBookFileService,
): Promise<Book> {
  for (const asset of entry.assets) {
    const bytes = await transport.pullBookAsset?.(entry.hash, asset.name, {
      optional: !asset.required,
    });
    if (!bytes) {
      if (asset.required)
        throw new Error(`Missing required book asset ${entry.hash}/${asset.name}`);
      continue;
    }
    await files.writeBinary(assetPath(entry.book, asset.name), bytes);
  }
  return sanitizeBook(entry.book);
}

async function sendBook(
  book: Book,
  transport: SyncTransport,
  files: UsbBookFileService,
): Promise<void> {
  for (const asset of REQUIRED_ASSETS) {
    const path = assetPath(book, asset);
    if (!(await files.fileExists(path)))
      throw new Error(`Missing local book asset ${book.hash}/${asset}`);
    await transport.pushBookAsset?.(
      book.hash,
      asset,
      ownedArrayBuffer(await files.readBinary(path)),
    );
  }

  const navPath = assetPath(book, 'nav.json');
  if (await files.fileExists(navPath)) {
    await transport.pushBookAsset?.(
      book.hash,
      'nav.json',
      ownedArrayBuffer(await files.readBinary(navPath)),
    );
  }
}

export async function syncUsbBooks(
  transport: SyncTransport,
  files: UsbBookFileService,
): Promise<UsbBookSyncResult> {
  const result: UsbBookSyncResult = { sent: 0, received: 0, failedHashes: [], errors: [] };
  if (!transport.pullBookManifest || !transport.pullBookAsset || !transport.pushBookAsset) {
    return result;
  }

  const localLibrary = await readLocalLibrary(files);
  const remoteManifest = await transport.pullBookManifest();
  const remoteLibraryBooks = await pullRemoteLibraryBooks(transport, result);
  const remoteBooks = mergeRemoteBooks(remoteManifest, remoteLibraryBooks);
  const receivedBooks: Book[] = [];
  const sentBooks: Book[] = [];

  // ── Resolve local-live vs remote-tombstone conflicts ──────────
  // A remote tombstone wins over a stale local live row by default, but a local
  // live row whose createdAt is newer than the remote deletedAt is a local
  // reimport after the delete and must be pushed back to the peer.
  let localChanged = false;
  const localReimportsToPush = new Set<string>();
  for (const remoteBook of remoteBooks.values()) {
    if (!remoteBook.deletedAt) continue;
    const localBook = localLibrary.find((b) => b.hash === remoteBook.hash && !b.deletedAt);
    if (!localBook) continue;
    if (isLocalReimportAfterRemoteDelete(localBook, remoteBook)) {
      localReimportsToPush.add(localBook.hash);
      continue;
    }
    Object.assign(localBook, remoteBook);
    localChanged = true;
  }
  if (localChanged) {
    await writeLocalLibrary(files, localLibrary);
  }

  // Receive new books from remote (skip tombstones — their assets
  // are already gone and we only need the deletedAt marker propagated).
  for (const entry of remoteManifest.books) {
    if (entry.book.deletedAt || remoteBooks.get(entry.hash)?.deletedAt) continue;
    if (hasBook(localLibrary, entry.hash)) continue;
    try {
      receivedBooks.push(await receiveBook(entry, transport, files));
      result.received += 1;
    } catch (error) {
      result.failedHashes.push(entry.hash);
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      result.errors.push(`receive ${entry.hash}: ${msg}`);
    }
  }

  // Collect books to send: skip remote-duplicates and tombstones.
  const booksToSend: Book[] = [];
  for (const book of localLibrary) {
    if (book.deletedAt) continue;
    if (remoteBooks.has(book.hash) && !localReimportsToPush.has(book.hash)) continue;
    booksToSend.push(book);
  }

  // Push library index FIRST so the server can resolve book filenames
  // from library.json before receiving asset binary payloads.
  if (booksToSend.length > 0) {
    await transport.pushBookLibrary?.(mergeImportedLibraryBooks([], booksToSend));
  }

  // Now push the actual book assets (file, cover, config, nav)
  for (const book of booksToSend) {
    try {
      await sendBook(book, transport, files);
      sentBooks.push(book);
      result.sent += 1;
    } catch (error) {
      result.failedHashes.push(book.hash);
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      result.errors.push(`send ${book.hash}: ${msg}`);
    }
  }

  // ── Push local tombstones ─────────────────────────────────────────
  // Push tombstones that don't exist on remote or where remote is live.
  for (const book of localLibrary) {
    if (!book.deletedAt) continue;
    const remoteBook = remoteBooks.get(book.hash);
    if (remoteBook && remoteBook.deletedAt) continue; // both tombstoned
    try {
      await transport.pushBookLibrary?.([book]);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      result.errors.push(`tombstone push ${book.hash}: ${msg}`);
    }
  }

  // Config merge for shared books
  if (transport.pullBookConfig && transport.pushBookConfig) {
    for (const entry of remoteManifest.books) {
      if (!hasBook(localLibrary, entry.hash)) continue;
      let remoteConfigJson: string | null = null;
      try {
        remoteConfigJson = await transport.pullBookConfig(entry.hash);
      } catch (error) {
        result.failedHashes.push(entry.hash);
        result.errors.push(
          `pullBookConfig: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (remoteConfigJson === null) continue;
      try {
        const localConfigJson = await readBookConfig(files, entry.book);
        if (localConfigJson === null) continue;

        const mergedJson = mergeBookConfig(localConfigJson, remoteConfigJson);
        await writeBookConfig(files, entry.book, mergedJson);
        await transport.pushBookConfig(entry.hash, mergedJson);
      } catch (error) {
        result.failedHashes.push(entry.hash);
        result.errors.push(`config: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (receivedBooks.length > 0) {
    await writeLocalLibrary(files, mergeImportedLibraryBooks(localLibrary, receivedBooks));
  }

  return result;
}
