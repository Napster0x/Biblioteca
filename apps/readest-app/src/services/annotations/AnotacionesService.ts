import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import { createAnnotacionId, type Annotacion, type AnnotacionInput } from '@/types/annotaciones';

const DB_SCHEMA = 'annotaciones';
const DB_PATH = 'annotations.db';

/**
 * Raw row shape as stored in the `annotations` table. Snake_case mirrors the
 * DDL in `services/database/migrations/index.ts`.
 */
type AnnotacionRow = {
  id: string;
  book_hash: string;
  book_title: string | null;
  book_author: string | null;
  cfi: string | null;
  section_href: string | null;
  page: number | null;
  text: string;
  note: string;
  style: string;
  color: string;
  created_at: number;
  updated_at: number | null;
};

/** Columns for SELECT queries on `annotations` — shared to stay DRY. */
const ANNOTATION_COLUMNS = [
  'id',
  'book_hash',
  'book_title',
  'book_author',
  'cfi',
  'section_href',
  'page',
  'text',
  'note',
  'style',
  'color',
  'created_at',
  'updated_at',
].join(', ');

export interface AnotacionesServiceOptions {
  /** Override `Date.now` (deterministic tests). */
  now?: () => number;
  /** Override id generation (deterministic tests). */
  createId?: () => string;
}

export class AnotacionesService {
  private now: () => number;
  private createId: () => string;

  constructor(
    private readonly db: DatabaseService,
    options: AnotacionesServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? createAnnotacionId;
  }

  /**
   * Opens the annotations database via the AppService and returns a ready
   * `AnotacionesService`.
   */
  static async open(appService: AppService): Promise<AnotacionesService> {
    const db = await appService.openDatabase(DB_SCHEMA, DB_PATH, 'Data');
    return new AnotacionesService(db);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * Replaces the `now()` clock. Test-only escape hatch.
   */
  setNow(now: () => number): void {
    this.now = now;
  }

  async listAnnotations(): Promise<Annotacion[]> {
    const rows = await this.db.select<AnnotacionRow>(
      `SELECT ${ANNOTATION_COLUMNS} FROM annotations ORDER BY created_at DESC`,
    );
    return rows.map(annotationFromRow);
  }

  async searchAnnotations(query: string): Promise<Annotacion[]> {
    const pattern = `%${query}%`;
    const rows = await this.db.select<AnnotacionRow>(
      `SELECT ${ANNOTATION_COLUMNS}
       FROM annotations
       WHERE text LIKE ? OR note LIKE ? OR book_title LIKE ? OR book_author LIKE ?
       ORDER BY created_at DESC`,
      [pattern, pattern, pattern, pattern],
    );
    return rows.map(annotationFromRow);
  }

  async createAnnotation(input: AnnotacionInput): Promise<Annotacion> {
    const id = this.createId();
    const createdAt = this.now();

    await this.db.execute(
      `INSERT INTO annotations
       (id, book_hash, book_title, book_author, cfi, section_href, page,
        text, note, style, color, created_at, updated_at)
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
        input.note,
        input.style,
        input.color,
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
      note: input.note,
      style: input.style,
      color: input.color,
      createdAt,
      updatedAt: null,
    };
  }

  async deleteAnnotations(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.execute(`DELETE FROM annotations WHERE id IN (${placeholders})`, [...ids]);
  }

  async deleteAnnotationsByBook(bookHash: string): Promise<string[]> {
    const rows = await this.db.select<{ id: string }>(
      'SELECT id FROM annotations WHERE book_hash = ?',
      [bookHash],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    await this.db.execute('DELETE FROM annotations WHERE book_hash = ?', [bookHash]);
    return ids;
  }
}

function annotationFromRow(row: AnnotacionRow): Annotacion {
  return {
    id: row.id,
    bookHash: row.book_hash,
    bookTitle: row.book_title,
    bookAuthor: row.book_author,
    cfi: row.cfi,
    sectionHref: row.section_href,
    page: row.page,
    text: row.text,
    note: row.note,
    style: row.style,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
