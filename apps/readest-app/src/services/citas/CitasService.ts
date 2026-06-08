import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import { createCitasId, type Cite, type CiteInput, type CiteUpdate } from '@/types/citas';

const DB_SCHEMA = 'citas';
const DB_PATH = 'citas.db';

type Sha256 = (input: string) => string | Promise<string>;

/**
 * Raw row shape as stored in the `quotes` table. Snake_case mirrors the
 * DDL in `services/database/migrations/index.ts` so the row → domain
 * mapping stays a mechanical rename in `quoteFromRow`.
 */
type QuoteRow = {
  id: string;
  book_hash: string;
  book_title: string | null;
  book_author: string | null;
  cfi: string | null;
  section_href: string | null;
  page: number | null;
  text: string;
  context_before: string | null;
  context_after: string | null;
  content_hash: string;
  created_at: number;
  updated_at: number | null;
  deleted_at: number | null;
};

/** Columns for SELECT queries on `quotes` — shared to stay DRY. */
const QUOTE_COLUMNS = [
  'id',
  'book_hash',
  'book_title',
  'book_author',
  'cfi',
  'section_href',
  'page',
  'text',
  'context_before',
  'context_after',
  'content_hash',
  'created_at',
  'updated_at',
  'deleted_at',
].join(', ');

export interface CitasServiceOptions {
  /** Override `Date.now` (deterministic tests). */
  now?: () => number;
  /** Override id generation (deterministic tests). */
  createId?: () => string;
  /**
   * Override the SHA-256 helper. Tests pass a pure-JS implementation
   * so assertions don't depend on the host's `crypto.subtle` support.
   * Production callers can rely on the browser/WebView-safe Web Crypto default.
   */
  sha256?: Sha256;
}

export class CitasService {
  private now: () => number;
  private createId: () => string;
  private sha256: Sha256;

  constructor(
    private readonly db: DatabaseService,
    options: CitasServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? createCitasId;
    this.sha256 = options.sha256 ?? defaultSha256;
  }

  /**
   * Opens the citas database via the AppService and returns a ready
   * `CitasService`. Mirrors `DictionaryService.open` so the same
   * `appService.openDatabase(schema, path, base)` contract applies.
   */
  static async open(appService: AppService): Promise<CitasService> {
    const db = await appService.openDatabase(DB_SCHEMA, DB_PATH, 'Data');
    return new CitasService(db);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * Replaces the `now()` clock. Test-only escape hatch: lets a single
   * test instance verify `updated_at` advances between calls. Production
   * code should never need this.
   */
  setNow(now: () => number): void {
    this.now = now;
  }

  async listQuotes(): Promise<Cite[]> {
    const rows = await this.db.select<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quotes WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return rows.map(quoteFromRow);
  }

  async listAllQuotes(): Promise<Cite[]> {
    const rows = await this.db.select<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quotes ORDER BY created_at DESC`,
    );
    return rows.map(quoteFromRow);
  }

  async listQuotesByBook(bookHash: string): Promise<Cite[]> {
    const rows = await this.db.select<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quotes WHERE book_hash = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      [bookHash],
    );
    return rows.map(quoteFromRow);
  }

  async getQuote(id: string): Promise<Cite | null> {
    const rows = await this.db.select<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quotes WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row ? quoteFromRow(row) : null;
  }

  async createQuote(input: CiteInput): Promise<Cite> {
    const id = this.createId();
    const createdAt = this.now();
    const contentHash = await computeContentHash(this.sha256, input);

    await this.db.execute(
      `INSERT INTO quotes
       (id, book_hash, book_title, book_author, cfi, section_href, page,
        text, context_before, context_after, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
        input.bookHash,
        input.bookTitle,
        input.bookAuthor,
        input.cfi,
        input.sectionHref,
        input.page,
        input.text,
        input.contextBefore,
        input.contextAfter,
        contentHash,
        createdAt,
      ],
    );

    return {
      id,
      bookHash: input.bookHash,
      bookTitle: input.bookTitle,
      bookAuthor: input.bookAuthor,
      cfi: input.cfi,
      sectionHref: input.sectionHref,
      page: input.page,
      text: input.text,
      contextBefore: input.contextBefore,
      contextAfter: input.contextAfter,
      contentHash,
      createdAt,
      updatedAt: null,
    };
  }

  async updateQuote(input: CiteUpdate): Promise<Cite> {
    const current = await this.getQuote(input.id);
    if (!current) {
      throw new Error(`Quote not found: ${input.id}`);
    }

    // Resolve merged values, with `undefined` meaning "keep current" and
    // an explicit `null` meaning "set to NULL". Required so callers can
    // clear optional fields (e.g. sectionHref) without touching the
    // content hash unnecessarily.
    const nextText = input.text !== undefined ? input.text : current.text;
    const nextContextBefore =
      input.contextBefore !== undefined ? input.contextBefore : current.contextBefore;
    const nextContextAfter =
      input.contextAfter !== undefined ? input.contextAfter : current.contextAfter;

    // Recompute the content hash from the merged state. The UNIQUE
    // constraint on (book_hash, content_hash) means the hash must
    // reflect the visible content of the quote at all times.
    const contentHash = await computeContentHashFromParts(
      this.sha256,
      nextText,
      nextContextBefore,
      nextContextAfter,
    );
    const updatedAt = this.now();

    await this.db.execute(
      `UPDATE quotes SET
         book_title    = ?,
         book_author   = ?,
         cfi           = ?,
         section_href  = ?,
         page          = ?,
         text          = ?,
         context_before = ?,
         context_after  = ?,
         content_hash  = ?,
         updated_at    = ?
       WHERE id = ?`,
      [
        input.bookTitle !== undefined ? input.bookTitle : current.bookTitle,
        input.bookAuthor !== undefined ? input.bookAuthor : current.bookAuthor,
        input.cfi !== undefined ? input.cfi : current.cfi,
        input.sectionHref !== undefined ? input.sectionHref : current.sectionHref,
        input.page !== undefined ? input.page : current.page,
        nextText,
        nextContextBefore,
        nextContextAfter,
        contentHash,
        updatedAt,
        input.id,
      ],
    );

    const refreshed = await this.getQuote(input.id);
    if (!refreshed) {
      // Race: the row was deleted between our read and write. Surface it
      // loudly rather than returning a fabricated value.
      throw new Error(`Quote not found after update: ${input.id}`);
    }
    return refreshed;
  }

  async searchQuotes(query: string): Promise<Cite[]> {
    // SQLite's default LIKE is case-insensitive for ASCII, so passing
    // the raw pattern covers the "BORGES" → "Borges" case the spec
    // requires without an extra LOWER() call.
    const pattern = `%${query}%`;
    const rows = await this.db.select<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS}
       FROM quotes
       WHERE (text LIKE ? OR book_title LIKE ? OR book_author LIKE ?)
         AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [pattern, pattern, pattern],
    );
    return rows.map(quoteFromRow);
  }

  async deleteQuotes(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = this.now();
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.execute(`UPDATE quotes SET deleted_at = ? WHERE id IN (${placeholders})`, [
      now,
      ...ids,
    ]);
  }

  async deleteQuotesByBook(bookHash: string): Promise<string[]> {
    const now = this.now();
    const rows = await this.db.select<{ id: string }>(
      'SELECT id FROM quotes WHERE book_hash = ? AND deleted_at IS NULL',
      [bookHash],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    await this.db.execute(
      'UPDATE quotes SET deleted_at = ? WHERE book_hash = ? AND deleted_at IS NULL',
      [now, bookHash],
    );
    return ids;
  }

  async bulkUpsertQuotes(quotes: Cite[]): Promise<void> {
    if (quotes.length === 0) return;

    const placeholders = quotes.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];

    for (const q of quotes) {
      params.push(
        q.id,
        q.bookHash,
        q.bookTitle ?? null,
        q.bookAuthor ?? null,
        q.cfi ?? null,
        q.sectionHref ?? null,
        q.page ?? null,
        q.text,
        q.contextBefore ?? null,
        q.contextAfter ?? null,
        q.contentHash,
        q.createdAt,
        q.updatedAt ?? null,
        q.deletedAt ?? null,
      );
    }

    await this.db.execute(
      `INSERT OR REPLACE INTO quotes
       (id, book_hash, book_title, book_author, cfi, section_href, page,
        text, context_before, context_after, content_hash, created_at, updated_at, deleted_at)
       VALUES ${placeholders}`,
      params,
    );
  }
}

function quoteFromRow(row: QuoteRow): Cite {
  return {
    id: row.id,
    bookHash: row.book_hash,
    bookTitle: row.book_title,
    bookAuthor: row.book_author,
    cfi: row.cfi,
    sectionHref: row.section_href,
    page: row.page,
    text: row.text,
    contextBefore: row.context_before,
    contextAfter: row.context_after,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  };
}

/**
 * SHA-256 of `text || \0 || contextBefore || \0 || contextAfter`.
 *
 * NUL is the chosen separator (decision D1) because it can never appear
 * in the visible text of a rendered book — readers strip NUL out of
 * both EPUB and PDF text layers. This removes the boundary collision
 * that a plain `||` would introduce (e.g. `(text="a", ctxBefore="bc")`
 * vs `(text="ab", ctxBefore="c")`).
 */
async function computeContentHash(sha256: Sha256, input: CiteInput): Promise<string> {
  return computeContentHashFromParts(sha256, input.text, input.contextBefore, input.contextAfter);
}

async function computeContentHashFromParts(
  sha256: Sha256,
  text: string,
  contextBefore: string | null,
  contextAfter: string | null,
): Promise<string> {
  return sha256(`${text}\0${contextBefore ?? ''}\0${contextAfter ?? ''}`);
}

/** Browser/WebView-safe SHA-256 default for client-imported Citas modules. */
async function defaultSha256(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto SHA-256 is not available in this runtime');
  }

  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
