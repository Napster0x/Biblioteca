/**
 * Dev sync prepare engine — pure functions for EPUB import to desktop library.
 *
 * Reused by dev-sync-prepare CLI and dev-sync-cycle pipeline mode.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, openSync, readSync, closeSync, copyFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Compute partialMD5 hash identical to the browser version in src/utils/md5.ts.
 *
 * Reads 1024-byte chunks at exponentially increasing offsets (i = -1 to 10),
 * using the same `step << (2*i)` offset computation.
 */
export function computePartialMd5Node(filePath) {
  const step = 1024;
  const size = 1024;
  const fileSize = statSync(filePath).size;
  const fd = openSync(filePath, 'r');
  try {
    const hasher = createHash('md5');
    for (let i = -1; i <= 10; i++) {
      const start = Math.min(fileSize, step << (2 * i));
      const end = Math.min(start + size, fileSize);
      if (start >= fileSize) break;
      const buffer = Buffer.alloc(end - start);
      readSync(fd, buffer, 0, buffer.length, start);
      hasher.update(buffer);
    }
    return hasher.digest('hex');
  } finally {
    closeSync(fd);
  }
}

// Cached AdmZip constructor — populated on first successful load.
// `undefined` means "not yet attempted"; `null` means "tried and failed".
let _AdmZip;

function loadAdmZip() {
  if (_AdmZip !== undefined) return _AdmZip;

  // In vitest, import.meta.url may be transformed. Use a fixed absolute path
  // derived from the scripts directory to the app root's node_modules.
  const appRoot = join(__dirname, '..');

  try {
    // Use createRequire from the app root's package.json
    const r = createRequire(join(appRoot, 'package.json'));
    const m = r('adm-zip');
    _AdmZip = m.default || m;
    return _AdmZip;
  } catch(_e1) {
    try {
      // Fallback: resolve from cwd (works in some test runners)
      const r = createRequire(join(process.cwd(), 'package.json'));
      const m = r('adm-zip');
      _AdmZip = m.default || m;
      return _AdmZip;
    } catch(_e2) {
      _AdmZip = null;
    }
  }
  return _AdmZip;
}

function resolveNowValue(now) {
  const value = typeof now === 'function' ? now() : now;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

/**
 * For testing: inject AdmZip constructor to bypass vitest resolution issues.
 */
export function __setAdmZip(ctor) {
  _AdmZip = ctor;
}

/**
 * Extract metadata from an EPUB file (ZIP format).
 */
export function extractEpubMetadata(epubPath) {
  const fileName = basename(epubPath, '.epub');
  const AdmZip = _AdmZip !== undefined ? _AdmZip : loadAdmZip();
  if (!AdmZip) return { title: fileName, author: 'Unknown' };

  try {
    const zip = new AdmZip(epubPath);
    const entries = zip.getEntries();

    const containerEntry = entries.find(
      (e) => e.entryName === 'META-INF/container.xml' || e.entryName.toLowerCase() === 'meta-inf/container.xml',
    );
    if (!containerEntry) return { title: fileName, author: 'Unknown' };

    const containerXml = containerEntry.getData().toString('utf8');
    const opfMatch = containerXml.match(/full-path\s*=\s*"([^"]+)"/i);
    if (!opfMatch) return { title: fileName, author: 'Unknown' };

    const opfPath = opfMatch[1];
    const opfEntry = entries.find((e) => e.entryName === opfPath || e.entryName.endsWith('/' + opfPath));
    if (!opfEntry) return { title: fileName, author: 'Unknown' };

    const opfXml = opfEntry.getData().toString('utf8');

    let title = null;
    const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i) || opfXml.match(/<dcterms:title[^>]*>([^<]+)<\/dcterms:title>/i);
    if (titleMatch) title = titleMatch[1].trim();

    let author = 'Unknown';
    const creatorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i) || opfXml.match(/<dcterms:creator[^>]*>([^<]+)<\/dcterms:creator>/i);
    if (creatorMatch) author = creatorMatch[1].trim();

    let language = null;
    const langMatch = opfXml.match(/<dc:language[^>]*>([^<]+)<\/dc:language>/i) || opfXml.match(/<dcterms:language[^>]*>([^<]+)<\/dcterms:language>/i);
    if (langMatch) language = langMatch[1].trim();

    return { title: title || fileName, author, ...(language ? { language } : {}) };
  } catch {
    return { title: fileName, author: 'Unknown' };
  }
}

/**
 * Create a reusable EPUB import descriptor without writing desktop state.
 */
export function createEpubImportDescriptor({ filePath, title, author, language, now }) {
  if (!existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const hash = computePartialMd5Node(filePath);
  const fileName = basename(filePath);
  const byteSize = statSync(filePath).size;
  const extracted = extractEpubMetadata(filePath);
  const metadata = {
    title: title ?? extracted.title,
    author: author ?? extracted.author,
    ...(language ?? extracted.language ? { language: language ?? extracted.language } : {}),
  };
  const timestamp = resolveNowValue(now);
  const entry = {
    hash,
    title: metadata.title,
    author: metadata.author,
    byteSize,
    fileName,
    importedAt: timestamp,
    updatedAt: timestamp,
    ...(metadata.language ? { language: metadata.language } : {}),
  };

  return { hash, fileName, byteSize, metadata, entry, filePath };
}

/**
 * Import an EPUB file into the desktop dev-sync library.
 */
export function importEpubToLibrary({ filePath, dataRoot, title, author, language }) {
  if (!existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const descriptor = createEpubImportDescriptor({ filePath, title, author, language });
  const { hash, fileName } = descriptor;

  const booksDir = join(dataRoot, 'Readest', 'Books');
  const libraryPath = join(booksDir, 'library.json');
  let library = [];
  let existingIndex = -1;
  if (existsSync(libraryPath)) {
    try {
      const existing = JSON.parse(readFileSync(libraryPath, 'utf8'));
      if (Array.isArray(existing)) {
        library = existing;
        existingIndex = library.findIndex((e) => e.hash === hash);
        const existingBook = existingIndex === -1 ? null : library[existingIndex];
        if (existingBook && !existingBook.deletedAt) {
          return { ok: true, action: 'skipped', hash, book: existingBook };
        }
      }
    } catch { /* overwrite on malformed */ }
  }

  const bookDir = join(booksDir, hash);
  mkdirSync(bookDir, { recursive: true });
  copyFileSync(filePath, join(bookDir, fileName));

  const entry = descriptor.entry;

  if (existingIndex === -1) library.push(entry);
  else library[existingIndex] = entry;

  mkdirSync(booksDir, { recursive: true });
  writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf8');

  return { ok: true, book: entry };
}
