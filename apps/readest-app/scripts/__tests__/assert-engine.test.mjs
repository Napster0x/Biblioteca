#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertCase15,
  assertCase16,
  assertCase17,
  bookNoteIdentityKey,
  compareSemanticState,
  dictionaryEntryIdentityKey,
  quoteIdentityKey,
} from '../assert-engine.mjs';

describe('assert-engine Phase 3 semantic identity helpers', () => {
  it('normalizes same dictionary term and language to one semantic identity', () => {
    assert.equal(
      dictionaryEntryIdentityKey({ term: ' Café ', language: 'EN' }),
      dictionaryEntryIdentityKey({ term: 'cafe', language: 'en' }),
    );
  });

  it('uses book hash, range, and quote text/content hash for quote identity', () => {
    assert.equal(
      quoteIdentityKey({ bookHash: 'book-1', cfi: '/6/4', text: 'Same quote' }),
      quoteIdentityKey({ book_hash: 'book-1', cfi: '/6/4', contentHash: 'same quote' }),
    );
    assert.notEqual(
      quoteIdentityKey({ bookHash: 'book-1', cfi: '/6/4', text: 'Same quote' }),
      quoteIdentityKey({ bookHash: 'book-1', cfi: '/6/8', text: 'Same quote' }),
    );
  });

  it('keeps same BookNote range with different semantic groups as distinct identities', () => {
    const dictionaryNote = bookNoteIdentityKey({ bookHash: 'book-1', id: 'note-1', type: 'highlight', cfi: '/6/4', dictionaryEntryId: 'dict-1' });
    const quoteNote = bookNoteIdentityKey({ bookHash: 'book-1', id: 'note-1', type: 'highlight', cfi: '/6/4', citeId: 'quote-1' });

    assert.notEqual(dictionaryNote, quoteNote);
  });
});

describe('assertCase15 — same book dedup', () => {
  it('passes when no duplicate book hashes on either side', () => {
    const result = assertCase15({
      desktop: { books: [{ hash: 'book-a' }, { hash: 'book-b' }] },
      android: { books: [{ hash: 'book-a' }, { hash: 'book-c' }] },
    });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when desktop has duplicate book hash', () => {
    const result = assertCase15({
      desktop: { books: [{ hash: 'dup' }, { hash: 'dup' }] },
      android: { books: [{ hash: 'dup' }] },
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'case15-no-duplicate-hash');
    assert.equal(result.failures[0].logicalKey, 'book:dup');
  });

  it('fails when android has duplicate book hash', () => {
    const result = assertCase15({
      desktop: { books: [{ hash: 'a' }] },
      android: { books: [{ hash: 'dup' }, { hash: 'dup' }] },
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].side, 'android');
  });

  it('handles empty book lists gracefully', () => {
    const result = assertCase15({ desktop: {}, android: {} });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });
});

describe('assertCase16 — same dictionary entry dedup', () => {
  it('passes when no duplicate normalized dictionary entries on either side', () => {
    const result = assertCase16({
      desktop: { dictionaryEntries: [{ term: 'Café', language: 'EN' }] },
      android: { dictionaryEntries: [{ term: 'Coffee', language: 'EN' }] },
    });
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });

  it('fails when desktop has duplicate normalized dictionary entries', () => {
    const result = assertCase16({
      desktop: {
        dictionaryEntries: [
          { id: 'a', term: 'Café', language: 'EN' },
          { id: 'b', term: 'cafe', language: 'en' },
        ],
      },
      android: { dictionaryEntries: [] },
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'case16-no-duplicate-dictionary-entry');
    assert.equal(result.failures[0].logicalKey, 'dictionary-entry:cafe|en');
  });

  it('fails when android has duplicate normalized dictionary entries', () => {
    const result = assertCase16({
      desktop: { dictionaryEntries: [{ term: 'cafe', language: 'en' }] },
      android: {
        dictionaryEntries: [
          { term: 'Café', language: 'EN' },
          { term: 'cafe', language: 'en' },
        ],
      },
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures[0].side, 'android');
  });

  it('handles empty dictionary entry lists gracefully', () => {
    const result = assertCase16({ desktop: {}, android: {} });
    assert.equal(result.verdict, 'PASS');
  });
});

describe('assertCase17 — same quote dedup', () => {
  it('passes when no duplicate quotes on either side', () => {
    const result = assertCase17({
      desktop: { quotes: [{ bookHash: 'b1', cfi: '/6/4', text: 'hello' }] },
      android: { quotes: [{ bookHash: 'b1', cfi: '/6/4', text: 'world' }] },
    });
    assert.equal(result.verdict, 'PASS');
  });

  it('fails when desktop has duplicate quotes with same identity', () => {
    const result = assertCase17({
      desktop: {
        quotes: [
          { id: 'q1', bookHash: 'b1', cfi: '/6/4', text: 'same' },
          { id: 'q2', bookHash: 'b1', cfi: '/6/4', text: 'same' },
        ],
      },
      android: { quotes: [] },
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].invariant, 'case17-no-duplicate-quote');
  });

  it('fails when android has duplicate quotes with same identity', () => {
    const result = assertCase17({
      desktop: { quotes: [{ bookHash: 'b1', cfi: '/6/4', text: 'same' }] },
      android: {
        quotes: [
          { bookHash: 'b1', cfi: '/6/4', text: 'same' },
          { book_hash: 'b1', cfi: '/6/4', contentHash: 'same' },
        ],
      },
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.failures[0].side, 'android');
  });

  it('handles empty quote lists gracefully', () => {
    const result = assertCase17({ desktop: {}, android: {} });
    assert.equal(result.verdict, 'PASS');
  });
});

describe('compareSemanticState Phase 3 duplicate semantics', () => {
  it('fails when normalized dictionary entries duplicate the same semantic identity', () => {
    const result = compareSemanticState({
      desktop: {
        dictionaryEntries: [
          { id: 'entry-a', term: ' Café ', language: 'EN' },
          { id: 'entry-b', term: 'cafe', language: 'en' },
        ],
      },
      android: {
        dictionaryEntries: [{ id: 'entry-a', term: 'cafe', language: 'en' }],
      },
    });

    assert.equal(result.verdict, 'FAIL');
    const duplicateFailures = result.failures.filter((failure) => failure.invariant === 'no-duplicate-logical-rows');
    assert.deepEqual(duplicateFailures.map((failure) => [failure.entity, failure.logicalKey, failure.count]), [
      ['dictionary-entry', 'dictionary-entry:cafe|en', 2],
    ]);
  });

  it('passes same range BookNotes when their semantic groups differ', () => {
    const sharedBookNotes = [
      { bookHash: 'book-1', id: 'note-1', type: 'highlight', cfi: '/6/4', dictionaryEntryId: 'dict-1' },
      { bookHash: 'book-1', id: 'note-1', type: 'highlight', cfi: '/6/4', citeId: 'quote-1' },
    ];

    const result = compareSemanticState({
      desktop: { bookNotes: sharedBookNotes },
      android: { bookNotes: sharedBookNotes },
    });

    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.failures, []);
  });
});
