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
  deleted_at: number | null;
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
  'deleted_at',
].join(', ');

export interface AnotacionesServiceOptions {
  /** Override `Date.now` (deterministic tests). */
  now?: () => number;
  /** Override id generation (deterministic tests). */
  createId?: () => string;
}

export interface UpdateAnnotacionInput {
  id: string;
  note?: string;
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
      `SELECT ${ANNOTATION_COLUMNS} FROM annotations WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return rows.map(annotationFromRow);
  }

  async listAllAnnotations(): Promise<Annotacion[]> {
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
       WHERE (text LIKE ? OR note LIKE ? OR book_title LIKE ? OR book_author LIKE ?)
         AND deleted_at IS NULL
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

  async updateAnnotation(input: UpdateAnnotacionInput): Promise<Annotacion> {
    const updatedAt = this.now();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.note !== undefined) {
      sets.push('note = ?');
      params.push(input.note);
    }

    if (sets.length === 0) {
      const existing = await this.getAnnotation(input.id);
      if (!existing) throw new Error('Annotation not found');
      return existing;
    }

    sets.push('updated_at = ?');
    params.push(updatedAt, input.id);

    await this.db.execute(`UPDATE annotations SET ${sets.join(', ')} WHERE id = ?`, params);

    const updated = await this.getAnnotation(input.id);
    if (!updated) throw new Error('Annotation not found');
    return updated;
  }

  async getAnnotation(id: string): Promise<Annotacion | null> {
    const rows = await this.db.select<AnnotacionRow>(
      `SELECT ${ANNOTATION_COLUMNS} FROM annotations WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row ? annotationFromRow(row) : null;
  }

  async deleteAnnotations(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = this.now();
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.execute(`UPDATE annotations SET deleted_at = ? WHERE id IN (${placeholders})`, [
      now,
      ...ids,
    ]);
  }

  async deleteAnnotationsByBook(bookHash: string): Promise<string[]> {
    const now = this.now();
    const rows = await this.db.select<{ id: string }>(
      'SELECT id FROM annotations WHERE book_hash = ? AND deleted_at IS NULL',
      [bookHash],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    await this.db.execute(
      'UPDATE annotations SET deleted_at = ? WHERE book_hash = ? AND deleted_at IS NULL',
      [now, bookHash],
    );
    return ids;
  }

  async bulkUpsertAnnotations(annotations: Annotacion[]): Promise<void> {
    if (annotations.length === 0) return;

    const placeholders = annotations
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const params: unknown[] = [];

    for (const a of annotations) {
      params.push(
        a.id,
        a.bookHash,
        a.bookTitle ?? null,
        a.bookAuthor ?? null,
        a.cfi ?? null,
        a.sectionHref ?? null,
        a.page ?? null,
        a.text,
        a.note ?? '',
        a.style,
        a.color,
        a.createdAt,
        a.updatedAt ?? null,
        a.deletedAt ?? null,
      );
    }

    await this.db.execute(
      `INSERT OR REPLACE INTO annotations
       (id, book_hash, book_title, book_author, cfi, section_href, page,
        text, note, style, color, created_at, updated_at, deleted_at)
       VALUES ${placeholders}`,
      params,
    );
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
    deletedAt: row.deleted_at ?? undefined,
  };
}
