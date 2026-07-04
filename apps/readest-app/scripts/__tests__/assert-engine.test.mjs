#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
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
