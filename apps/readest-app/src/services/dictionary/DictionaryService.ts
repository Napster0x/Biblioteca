import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import type { DictionaryEntry, DictionaryOccurrence, EnrichmentStatus } from '@/types/dictionary';
import { normalizeDictionaryTerm } from '@/utils/dictionaryText';

const DB_SCHEMA = 'dictionary';
const DB_PATH = 'dictionary.db';

type DictionaryEntryRow = {
  id: string;
  term: string;
  display_term: string;
  language: string | null;
  definition: string | null;
  enrichment_status: EnrichmentStatus;
  image_path: string | null;
  curiosity: string | null;
  created_at: number;
  updated_at: number;
};

type DictionaryOccurrenceRow = {
  id: string;
  entry_id: string;
  book_hash: string;
  book_title: string | null;
  book_author: string | null;
  cfi: string;
  section_href: string | null;
  page: number | null;
  selected_text: string;
  context_before: string | null;
  context_after: string | null;
  highlight_note_id: string | null;
  created_at: number;
};

/** Columns for SELECT queries on dictionary_entries — shared to stay DRY. */
const ENTRY_COLUMNS = [
  'id',
  'term',
  'display_term',
  'language',
  'definition',
  'enrichment_status',
  'image_path',
  'curiosity',
  'created_at',
  'updated_at',
].join(', ');

export interface DictionaryServiceOptions {
  now?: () => number;
  createId?: (prefix: 'entry' | 'occurrence') => string;
}

export interface UpsertDictionaryEntryInput {
  term: string;
  displayTerm?: string;
  language?: string;
  definition?: string;
  enrichmentStatus?: EnrichmentStatus;
}

export interface CreateDictionaryOccurrenceInput {
  entryId: string;
  bookHash: string;
  bookTitle?: string;
  bookAuthor?: string;
  cfi: string;
  sectionHref?: string;
  page?: number;
  selectedText: string;
  contextBefore?: string;
  contextAfter?: string;
  highlightNoteId?: string;
}

export interface UpdateEntryInput {
  id: string;
  definition?: string;
  curiosity?: string;
  imagePath?: string;
}

export class DictionaryService {
  private readonly now: () => number;
  private readonly createId: (prefix: 'entry' | 'occurrence') => string;

  constructor(
    private readonly db: DatabaseService,
    options: DictionaryServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? createDictionaryId;
  }

  static async open(appService: AppService): Promise<DictionaryService> {
    const db = await appService.openDatabase(DB_SCHEMA, DB_PATH, 'Data');
    return new DictionaryService(db);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async upsertEntry(input: UpsertDictionaryEntryInput): Promise<DictionaryEntry> {
    const term = normalizeDictionaryTerm(input.term);
    const language = input.language ?? null;
    const existing = await this.findEntry(term, language);
    if (existing) return existing;

    const timestamp = this.now();
    const row: DictionaryEntryRow = {
      id: this.createId('entry'),
      term,
      display_term: input.displayTerm ?? term,
      language,
      definition: input.definition ?? null,
      image_path: null,
      curiosity: null,
      enrichment_status: input.enrichmentStatus ?? 'none',
      created_at: timestamp,
      updated_at: timestamp,
    };

    await this.db.execute(
      `INSERT INTO dictionary_entries
       (id, term, display_term, language, definition, enrichment_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.term,
        row.display_term,
        row.language,
        row.definition,
        row.enrichment_status,
        row.created_at,
        row.updated_at,
      ],
    );

    return entryFromRow(row);
  }

  async createOccurrence(input: CreateDictionaryOccurrenceInput): Promise<DictionaryOccurrence> {
    const row: DictionaryOccurrenceRow = {
      id: this.createId('occurrence'),
      entry_id: input.entryId,
      book_hash: input.bookHash,
      book_title: input.bookTitle ?? null,
      book_author: input.bookAuthor ?? null,
      cfi: input.cfi,
      section_href: input.sectionHref ?? null,
      page: input.page ?? null,
      selected_text: input.selectedText,
      context_before: input.contextBefore ?? null,
      context_after: input.contextAfter ?? null,
      highlight_note_id: input.highlightNoteId ?? null,
      created_at: this.now(),
    };

    await this.db.execute(
      `INSERT INTO dictionary_occurrences
       (id, entry_id, book_hash, book_title, book_author, cfi, section_href, page, selected_text, context_before, context_after, highlight_note_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.entry_id,
        row.book_hash,
        row.book_title,
        row.book_author,
        row.cfi,
        row.section_href,
        row.page,
        row.selected_text,
        row.context_before,
        row.context_after,
        row.highlight_note_id,
        row.created_at,
      ],
    );

    return occurrenceFromRow(row);
  }

  async listEntries(): Promise<DictionaryEntry[]> {
    const rows = await this.db.select<DictionaryEntryRow>(
      `SELECT ${ENTRY_COLUMNS}
       FROM dictionary_entries
       ORDER BY updated_at DESC, display_term ASC`,
    );
    return rows.map(entryFromRow);
  }

  async searchEntries(query: string): Promise<DictionaryEntry[]> {
    const pattern = `%${query}%`;
    const rows = await this.db.select<DictionaryEntryRow>(
      `SELECT ${ENTRY_COLUMNS}
       FROM dictionary_entries AS entry
       WHERE entry.term LIKE ?
          OR entry.display_term LIKE ?
          OR entry.definition LIKE ?
          OR EXISTS (
            SELECT 1
            FROM dictionary_occurrences AS occurrence
            WHERE occurrence.entry_id = entry.id
              AND (
                occurrence.selected_text LIKE ?
                OR occurrence.book_title LIKE ?
                OR occurrence.book_author LIKE ?
              )
          )
       ORDER BY entry.updated_at DESC, entry.display_term ASC`,
      [pattern, pattern, pattern, pattern, pattern, pattern],
    );
    return rows.map(entryFromRow);
  }

  async listOccurrences(entryId: string): Promise<DictionaryOccurrence[]> {
    const rows = await this.db.select<DictionaryOccurrenceRow>(
      `SELECT id, entry_id, book_hash, book_title, book_author, cfi, section_href, page, selected_text,
              context_before, context_after, highlight_note_id, created_at
       FROM dictionary_occurrences
       WHERE entry_id = ?
       ORDER BY created_at DESC`,
      [entryId],
    );
    return rows.map(occurrenceFromRow);
  }

  async getEntry(id: string): Promise<DictionaryEntry | null> {
    const rows = await this.db.select<DictionaryEntryRow>(
      `SELECT ${ENTRY_COLUMNS}
       FROM dictionary_entries
       WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row ? entryFromRow(row) : null;
  }

  async updateEntry(input: UpdateEntryInput): Promise<DictionaryEntry> {
    const timestamp = this.now();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.definition !== undefined) {
      sets.push('definition = ?');
      params.push(input.definition);
    }
    if (input.curiosity !== undefined) {
      sets.push('curiosity = ?');
      params.push(input.curiosity);
    }
    if (input.imagePath !== undefined) {
      sets.push('image_path = ?');
      params.push(input.imagePath);
    }

    sets.push('updated_at = ?');
    params.push(timestamp);
    params.push(input.id);

    await this.db.execute(`UPDATE dictionary_entries SET ${sets.join(', ')} WHERE id = ?`, params);

    const rows = await this.db.select<DictionaryEntryRow>(
      `SELECT ${ENTRY_COLUMNS}
       FROM dictionary_entries
       WHERE id = ?`,
      [input.id],
    );
    const row = rows[0];
    if (!row) throw new Error(`Entry not found: ${input.id}`);
    return entryFromRow(row);
  }

  async deleteEntries(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    await this.db.execute(
      `DELETE FROM dictionary_occurrences WHERE entry_id IN (${placeholders})`,
      [...ids],
    );
    await this.db.execute(`DELETE FROM dictionary_entries WHERE id IN (${placeholders})`, [...ids]);
  }

  private async findEntry(term: string, language: string | null): Promise<DictionaryEntry | null> {
    const rows = await this.db.select<DictionaryEntryRow>(
      `SELECT ${ENTRY_COLUMNS}
       FROM dictionary_entries
       WHERE term = ? AND IFNULL(language, '') = IFNULL(?, '')`,
      [term, language],
    );
    const row = rows[0];
    return row ? entryFromRow(row) : null;
  }
}

function entryFromRow(row: DictionaryEntryRow): DictionaryEntry {
  return {
    id: row.id,
    term: row.term,
    displayTerm: row.display_term,
    language: row.language ?? undefined,
    definition: row.definition ?? undefined,
    enrichmentStatus: row.enrichment_status,
    imagePath: row.image_path ?? undefined,
    curiosity: row.curiosity ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function occurrenceFromRow(row: DictionaryOccurrenceRow): DictionaryOccurrence {
  return {
    id: row.id,
    entryId: row.entry_id,
    bookHash: row.book_hash,
    bookTitle: row.book_title ?? undefined,
    bookAuthor: row.book_author ?? undefined,
    cfi: row.cfi,
    sectionHref: row.section_href ?? undefined,
    page: row.page ?? undefined,
    selectedText: row.selected_text,
    contextBefore: row.context_before ?? undefined,
    contextAfter: row.context_after ?? undefined,
    highlightNoteId: row.highlight_note_id ?? undefined,
    createdAt: row.created_at,
  };
}

function createDictionaryId(prefix: 'entry' | 'occurrence'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
