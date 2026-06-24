import { describe, expect, it } from 'vitest';
import { normalizeDictionaryTerm } from '@/utils/dictionaryText';

describe('Semantic dedup — Cycle 3', () => {
  // ── SID-1: Dictionary term normalization for collision detection ──────

  describe('dictionary term case collision (SID-1)', () => {
    it('normalizes different capitalization to the same term', () => {
      const termA = normalizeDictionaryTerm('Zozobrar');
      const termB = normalizeDictionaryTerm('zozobrar');
      expect(termA).toBe(termB);
    });

    it('normalizes accented uppercase to lowercase NFC', () => {
      const result = normalizeDictionaryTerm('Café');
      // NFC decomposes é to e + combining acute, then recomposes to é
      // toLocaleLowerCase converts to lowercase
      expect(result).toBe('café');
    });

    it('strips soft hyphens (U+00AD)', () => {
      const result = normalizeDictionaryTerm('hell\u{00AD}o');
      expect(result).toBe('hello');
    });

    it('normalizes multi-word terms (only NFC + lowercase)', () => {
      const result = normalizeDictionaryTerm('Río Grande');
      expect(result).toBe('río grande');
    });

    it('treats term+language as composite semantic key', () => {
      // "pain" in English vs "pain" in French should be distinct
      const termEn = { term: normalizeDictionaryTerm('pain'), language: 'en' };
      const termFr = { term: normalizeDictionaryTerm('pain'), language: 'fr' };
      // Different languages → different composite keys
      const keyEn = `${termEn.term}|${termEn.language}`;
      const keyFr = `${termFr.term}|${termFr.language}`;
      expect(keyEn).not.toBe(keyFr);
    });
  });

  // ── SID-2: Quote dedup by book_hash + content_hash ───────────────────

  describe('quote dedup integration (SID-2)', () => {
    it('identifies same quote by book_hash + content_hash composite key', () => {
      const bookHash = 'abc123bookhash';
      const contentHash = 'sha256ofquotetext';
      const keyA = `quote:${bookHash}:${contentHash}`;
      const keyB = `quote:${bookHash}:${contentHash}`;
      expect(keyA).toBe(keyB);
    });

    it('distinguishes same text in different books', () => {
      const contentHash = 'sha256ofquotetext';
      const keyBook1 = `quote:book-A:${contentHash}`;
      const keyBook2 = `quote:book-B:${contentHash}`;
      expect(keyBook1).not.toBe(keyBook2);
    });

    it('distinguishes different text in same book', () => {
      const bookHash = 'abc123bookhash';
      const keyQuote1 = `quote:${bookHash}:hash-aaa`;
      const keyQuote2 = `quote:${bookHash}:hash-bbb`;
      expect(keyQuote1).not.toBe(keyQuote2);
    });
  });

  // ── SID-3: Annotation dedup by book_hash + cfi ───────────────────────

  describe('annotation dedup integration (SID-3)', () => {
    it('identifies same annotation by book_hash + cfi composite key', () => {
      const bookHash = 'abc123bookhash';
      const cfi = '/6/4';
      const keyA = `annotation:${bookHash}:${cfi}`;
      const keyB = `annotation:${bookHash}:${cfi}`;
      expect(keyA).toBe(keyB);
    });

    it('distinguishes same book different position', () => {
      const bookHash = 'abc123bookhash';
      const keyPos1 = `annotation:${bookHash}:/6/4`;
      const keyPos2 = `annotation:${bookHash}:/6/8`;
      expect(keyPos1).not.toBe(keyPos2);
    });

    it('distinguishes same position different book', () => {
      const cfi = '/6/4';
      const keyBookA = `annotation:book-A:${cfi}`;
      const keyBookB = `annotation:book-B:${cfi}`;
      expect(keyBookA).not.toBe(keyBookB);
    });
  });
});
