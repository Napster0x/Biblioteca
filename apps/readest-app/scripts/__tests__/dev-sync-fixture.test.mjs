#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchFixture, parseFixtureArgs } from '../dev-sync-fixture.mjs';

function makeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    resolveDefaults: (target, table) => ({
      target,
      table,
      dbPath: `/tmp/${table}.db`,
      dataRoot: '/tmp/readest-data',
      execFileSync: () => {},
      devHarnessEnabled: true,
    }),
    resolveAndroidServerUrl: () => 'http://android.test',
    updateRow: (payload) => {
      calls.push(['updateRow', payload]);
      return { ok: true, table: payload.table, rowId: payload.rowId };
    },
    softDeleteRow: (payload) => {
      calls.push(['softDeleteRow', payload]);
      return { ok: true, table: payload.table, rowId: payload.rowId, deleted: true };
    },
    deleteBook: (bookHash, options) => {
      calls.push(['deleteBook', bookHash, options]);
      return { ok: true, bookHash, action: 'deleted' };
    },
    updateBook: (bookHash, updates, options) => {
      calls.push(['updateBook', bookHash, updates, options]);
      return { ok: true, bookHash, action: 'updated' };
    },
    updateBookViaHttp: async (...args) => {
      calls.push(['updateBookViaHttp', ...args]);
      return { ok: true, inserted: 1, target: 'android-http', table: 'books', action: 'updated' };
    },
    updateReplicaViaHttp: async (...args) => {
      calls.push(['updateReplicaViaHttp', ...args]);
      return { ok: true, inserted: 1, target: 'android-http', table: args[1] };
    },
    deleteReplicaViaHttp: async (...args) => {
      calls.push(['deleteReplicaViaHttp', ...args]);
      return { ok: true, inserted: 1, target: 'android-http', table: args[1] };
    },
    deleteBookViaHttp: async (...args) => {
      calls.push(['deleteBookViaHttp', ...args]);
      return { ok: true, inserted: 1, target: 'android-http', table: 'books' };
    },
    deleteSemanticHighlightViaHttp: async (...args) => {
      calls.push(['deleteSemanticHighlightViaHttp', ...args]);
      return { ok: true, action: 'semantic-delete', deletedConfigNotes: 1, deletedSemanticRows: 1 };
    },
    deleteSemanticHighlightOnDesktop: async (...args) => {
      calls.push(['deleteSemanticHighlightOnDesktop', ...args]);
      return { ok: true, action: 'semantic-delete', deletedConfigNotes: 1, deletedSemanticRows: 1 };
    },
    createEpubImportDescriptor: (...args) => {
      calls.push(['createEpubImportDescriptor', ...args]);
      return {
        hash: 'book-import',
        fileName: 'fixture.epub',
        byteSize: 12,
        entry: { hash: 'book-import', title: 'Imported', fileName: 'fixture.epub', updatedAt: '2026-03-04T05:06:07.000Z' },
      };
    },
    importBookViaHttp: async (...args) => {
      calls.push(['importBookViaHttp', ...args]);
      return { ok: true, inserted: 1, target: 'android-http', table: 'books', action: 'imported' };
    },
    injectDictionary: async (payload) => {
      calls.push(['injectDictionary', payload]);
      return { ok: true, entryId: 'entry-1' };
    },
    injectQuote: async (payload) => {
      calls.push(['injectQuote', payload]);
      return { ok: true, quoteId: 'quote-1' };
    },
    injectAnnotation: async (payload) => {
      calls.push(['injectAnnotation', payload]);
      return { ok: true, annId: 'ann-1' };
    },
    injectBookViaHttp: async (...args) => {
      calls.push(['injectBookViaHttp', ...args]);
      return { ok: true, inserted: 1, target: 'android-http', table: 'books' };
    },
    importEpubToLibrary: ({ filePath, dataRoot, title, author, language }) => {
      calls.push(['importEpubToLibrary', { filePath, dataRoot, title, author, language }]);
      return { ok: true, book: { hash: 'epub-hash-1', title: title ?? 'Test', author: author ?? 'Author' } };
    },
    ...overrides,
  };
}

describe('parseFixtureArgs', () => {
  it('keeps existing create parsing backward-compatible', () => {
    const opts = parseFixtureArgs(['--target', 'desktop', '--dict', 'zozobrar', '--book', 'book-1', '--definition', 'hundirse']);

    assert.deepEqual(opts, {
      target: 'desktop',
      type: 'dict',
      term: 'zozobrar',
      bookHash: 'book-1',
      definition: 'hundirse',
    });
  });

  it('parses edit operations with multiple fields and explicit HLC', () => {
    const opts = parseFixtureArgs(['--edit', 'dictionary_entries:entry-1:definition=nueva,image_path=/tmp/img.png', '--hlc', '1719500000000']);

    assert.deepEqual(opts.edit, {
      table: 'dictionary_entries',
      rowId: 'entry-1',
      updates: { definition: 'nueva', image_path: '/tmp/img.png' },
    });
    assert.equal(opts.hlcTimestamp, 1719500000000);
  });

  it('accepts hex-encoded HLC strings without numeric conversion', () => {
    const hlc = '001905a2fcb00-00000001-visible';

    const opts = parseFixtureArgs(['--dict', 'zozobrar', '--book', 'book-1', '--hlc', hlc]);

    assert.equal(opts.hlcTimestamp, hlc);
  });

  it('rejects malformed edit operations clearly', () => {
    assert.throws(
      () => parseFixtureArgs(['--edit', 'dictionary_entries:entry-1']),
      /--edit expects table:id:field=value/,
    );
  });

  it('parses delete and delete-book operations', () => {
    assert.deepEqual(parseFixtureArgs(['--delete', 'annotations:ann-1']).delete, {
      table: 'annotations',
      rowId: 'ann-1',
    });
    assert.equal(parseFixtureArgs(['--delete-book', 'book-1']).deleteBookHash, 'book-1');
  });

  it('parses Android EPUB import options with deterministic HLC', () => {
    const opts = parseFixtureArgs([
      '--target', 'android-http',
      '--import-book', '/tmp/fixture.epub',
      '--title', 'Imported',
      '--author', 'Harness',
      '--language', 'es',
      '--hlc', '1719500000000',
    ]);

    assert.deepEqual(opts, {
      target: 'android-http',
      importBookPath: '/tmp/fixture.epub',
      title: 'Imported',
      author: 'Harness',
      language: 'es',
      hlcTimestamp: 1719500000000,
    });
  });

  it('parses semantic delete targets for BookNote/highlight associations', () => {
    const opts = parseFixtureArgs([
      '--target', 'android-http',
      '--semantic-delete', 'quote',
      '--book', 'book-1',
      '--id', 'quote-1',
      '--cfi', '/6/4',
      '--text', 'quoted text',
      '--hlc', '1719500000000',
    ]);

    assert.deepEqual(opts.semanticDelete, {
      kind: 'quote',
      id: 'quote-1',
      cfi: '/6/4',
      text: 'quoted text',
    });
    assert.equal(opts.bookHash, 'book-1');
    assert.equal(opts.hlcTimestamp, 1719500000000);
  });

  it('rejects invalid HLC values clearly', () => {
    assert.throws(
      () => parseFixtureArgs(['--dict', 'zozobrar', '--book', 'book-1', '--hlc', 'not-a-number']),
      /--hlc expects milliseconds or a hex-encoded HLC string/,
    );
  });
});

describe('dispatchFixture', () => {
  it('routes existing create behavior to injectDictionary', async () => {
    const deps = makeDeps();
    const result = await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--dict', 'zozobrar', '--book', 'book-1']), deps);

    assert.equal(result.ok, true);
    assert.equal(deps.calls[0][0], 'injectDictionary');
    assert.equal(deps.calls[0][1].target, 'desktop');
    assert.equal(deps.calls[0][1].term, 'zozobrar');
  });

  it('passes explicit HLC through existing create helpers', async () => {
    const deps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--dict', 'zozobrar', '--book', 'book-1', '--hlc', '1719500000000']), deps);

    assert.equal(deps.calls[0][0], 'injectDictionary');
    assert.equal(deps.calls[0][1].overrideTimestamp, 1719500000000);
    assert.equal(deps.calls[0][1].hlcTimestamp, 1719500000000);
  });

  it('routes desktop edit to updateRow with HLC passthrough', async () => {
    const deps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--edit', 'dictionary_entries:entry-1:definition=nueva', '--hlc', '1719500000000']), deps);

    assert.equal(deps.calls[0][0], 'updateRow');
    assert.deepEqual(deps.calls[0][1], {
      dbPath: '/tmp/dictionary_entries.db',
      execFileSync: deps.calls[0][1].execFileSync,
      table: 'dictionary_entries',
      rowId: 'entry-1',
      updates: { definition: 'nueva' },
      timestamp: 1719500000000,
      hlcTimestamp: 1719500000000,
    });
  });

  it('routes android-http edit to updateReplicaViaHttp', async () => {
    const deps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'android-http', '--edit', 'annotations:ann-1:note=nueva nota']), deps);

    assert.deepEqual(deps.calls[0], [
      'updateReplicaViaHttp',
      'http://android.test',
      'annotation',
      [{ id: 'ann-1', note: 'nueva nota' }],
      { fieldMap: deps.calls[0][4].fieldMap, hlcTimestamp: undefined },
    ]);
  });

  it('allows the full safe editable matrix and routes book edits to library update', async () => {
    const allowedSpecs = [
      'dictionary_entries:entry-1:display_term=Zozobrar,language=es,enrichment_status=done,image_path=/tmp/img.png,curiosity=Curious',
      'quotes:quote-1:book_title=Nuevo,book_author=Autora,cfi=/6/2,section_href=chap.xhtml,page=7,context_before=A,context_after=B,content_hash=h1',
      'annotations:ann-1:book_title=Nuevo,book_author=Autora,cfi=/6/2,section_href=chap.xhtml,page=7,note=Nota,style=underline,color=blue',
      'books:book-1:title=Nuevo,author=Autora,coverImageUrl=/cover.jpg,groupId=favorites,readingStatus=reading,progress=42,metadata.language=es',
    ];

    for (const spec of allowedSpecs) {
      const deps = makeDeps();
      const result = await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--edit', spec]), deps);
      assert.equal(result.ok, true, `expected edit to be allowed for ${spec}`);
    }

    const bookDeps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--edit', 'books:book-1:cover=/cover.jpg,group=favorites,metadata.publisher=Acme']), bookDeps);
    assert.deepEqual(bookDeps.calls[0], [
      'updateBook',
      'book-1',
      { coverImageUrl: '/cover.jpg', groupId: 'favorites', metadata: { publisher: 'Acme' } },
      { dataRoot: '/tmp/readest-data' },
    ]);
  });

  it('routes android-http book edits through the safe book-index HTTP updater', async () => {
    const deps = makeDeps();

    const result = await dispatchFixture(
      parseFixtureArgs(['--target', 'android-http', '--edit', 'books:book-1:title=Nuevo,metadata.language=es', '--hlc', '1719500000000']),
      deps,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(deps.calls[0], [
      'updateBookViaHttp',
      'http://android.test',
      'book-1',
      { title: 'Nuevo', metadata: { language: 'es' } },
      { now: 1719500000000 },
    ]);
  });

  it('still rejects immutable fixture fields after expanding safe edits', async () => {
    for (const spec of [
      'dictionary_entries:entry-1:term=changed',
      'dictionary_occurrences:occ-1:selected_text=changed',
      'quotes:quote-1:text=changed',
      'annotations:ann-1:text=changed',
      'highlights:hl-1:text=changed',
    ]) {
      await assert.rejects(
        () => dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--edit', spec]), makeDeps()),
        /Field is not editable by this harness|Entity is not editable by this harness/,
      );
    }
  });

  it('routes desktop delete to softDeleteRow', async () => {
    const deps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--delete', 'annotations:ann-1']), deps);

    assert.equal(deps.calls[0][0], 'softDeleteRow');
    assert.equal(deps.calls[0][1].table, 'annotations');
    assert.equal(deps.calls[0][1].rowId, 'ann-1');
  });

  it('routes android-http delete to deleteReplicaViaHttp', async () => {
    const deps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'android-http', '--delete', 'dictionary_entries:entry-1', '--hlc', '1719500000000']), deps);

    assert.deepEqual(deps.calls[0], [
      'deleteReplicaViaHttp',
      'http://android.test',
      'dictionary-entry',
      ['entry-1'],
      { fieldMap: deps.calls[0][4].fieldMap, hlcTimestamp: 1719500000000 },
    ]);
  });

  it('routes delete-book by target', async () => {
    const desktopDeps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--delete-book', 'book-1']), desktopDeps);
    assert.deepEqual(desktopDeps.calls[0], ['deleteBook', 'book-1', { dataRoot: '/tmp/readest-data' }]);

    const androidDeps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'android-http', '--delete-book', 'book-1']), androidDeps);
    assert.deepEqual(androidDeps.calls[0], ['deleteBookViaHttp', 'http://android.test', 'book-1']);
  });

  it('routes Android EPUB import through descriptor generation and HTTP import helper', async () => {
    const deps = makeDeps();

    const result = await dispatchFixture(parseFixtureArgs([
      '--target', 'android-http',
      '--import-book', '/tmp/fixture.epub',
      '--title', 'Imported',
      '--author', 'Harness',
      '--hlc', '1719500000000',
    ]), deps);

    assert.equal(result.ok, true);
    assert.deepEqual(deps.calls[0], [
      'createEpubImportDescriptor',
      {
        filePath: '/tmp/fixture.epub',
        title: 'Imported',
        author: 'Harness',
        language: undefined,
        now: 1719500000000,
      },
    ]);
    assert.deepEqual(deps.calls[1], [
      'importBookViaHttp',
      'http://android.test',
      deps.calls[1][2],
      { now: 1719500000000, reimport: true },
    ]);
  });

  it('routes android-http semantic delete through safe config plus replica helper', async () => {
    const deps = makeDeps();

    const result = await dispatchFixture(parseFixtureArgs([
      '--target', 'android-http',
      '--semantic-delete', 'annotation',
      '--book', 'book-1',
      '--id', 'ann-1',
      '--hlc', '1719500000000',
    ]), deps);

    assert.equal(result.ok, true);
    assert.deepEqual(deps.calls[0], [
      'deleteSemanticHighlightViaHttp',
      'http://android.test',
      { kind: 'annotation', id: 'ann-1', bookHash: 'book-1' },
      { hlcTimestamp: 1719500000000 },
    ]);
  });

  it('routes desktop semantic delete through safe config plus sqlite helper', async () => {
    const deps = makeDeps();

    const result = await dispatchFixture(parseFixtureArgs([
      '--target', 'desktop',
      '--semantic-delete', 'dictionary',
      '--book', 'book-1',
      '--dictionary-entry', 'entry-1',
    ]), deps);

    assert.equal(result.ok, true);
    assert.equal(deps.calls[0][0], 'deleteSemanticHighlightOnDesktop');
    assert.deepEqual(deps.calls[0][1], {
      kind: 'dictionary',
      dictionaryEntryId: 'entry-1',
      bookHash: 'book-1',
    });
  });

  it('parses --case15 with optional title and author', () => {
    const opts = parseFixtureArgs(['--target', 'desktop', '--case15', 'book-hash-1', '--title', 'Test Book', '--author', 'Author', '--hlc', '1719500000000']);
    assert.equal(opts.type, 'case15');
    assert.equal(opts.case15BookHash, 'book-hash-1');
    assert.equal(opts.title, 'Test Book');
    assert.equal(opts.author, 'Author');
    assert.equal(opts.hlcTimestamp, 1719500000000);
  });

  it('parses --case16 with term, book, language, and definition', () => {
    const opts = parseFixtureArgs(['--target', 'desktop', '--case16', 'Café', '--book', 'book-1', '--language', 'es', '--definition', 'bebida']);
    assert.equal(opts.type, 'case16');
    assert.equal(opts.case16Term, 'Café');
    assert.equal(opts.bookHash, 'book-1');
    assert.equal(opts.language, 'es');
    assert.equal(opts.definition, 'bebida');
  });

  it('parses --case17 with text and book', () => {
    const opts = parseFixtureArgs(['--target', 'android-http', '--case17', 'quote text', '--book', 'book-1']);
    assert.equal(opts.type, 'case17');
    assert.equal(opts.case17Text, 'quote text');
    assert.equal(opts.bookHash, 'book-1');
  });

  it('throws on case15 fixture without book hash argument', () => {
    assert.throws(
      () => parseFixtureArgs(['--case15']),
      /--case15 requires a value/,
    );
  });

  it('routes --case15 desktop to injectBookForDesktop', async () => {
    const deps = makeDeps();
    const result = await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--case15', 'book-15', '--title', 'Desktop Title']), deps);
    assert.equal(result.ok, true);
    assert.equal(result.bookHash, 'book-15');
  });

  it('routes --case15 android-http without --import-book to injectBookViaHttp', async () => {
    const deps = makeDeps();
    const result = await dispatchFixture(parseFixtureArgs(['--target', 'android-http', '--case15', 'book-15', '--title', 'Android Title']), deps);
    assert.equal(result.ok, true);
    assert.equal(deps.calls[0][0], 'injectBookViaHttp');
    // injectBookViaHttp(serverUrl, booksArray) → booksArray[0]
    assert.equal(deps.calls[0][2][0].hash, 'book-15');
    assert.equal(deps.calls[0][2][0].title, 'Android Title');
  });

  it('routes --case15 android-http with --import-book to importBookViaHttp with real EPUB', async () => {
    const deps = makeDeps();
    const result = await dispatchFixture(parseFixtureArgs([
      '--target', 'android-http', '--case15', 'ignored-hash',
      '--import-book', '/fake/path/book.epub',
      '--title', 'Epub Title', '--author', 'Epub Author',
    ]), deps);
    assert.equal(result.ok, true);
    // Should route through createEpubImportDescriptor + importBookViaHttp
    assert.equal(deps.calls[0][0], 'createEpubImportDescriptor');
    assert.equal(deps.calls[0][1].filePath, '/fake/path/book.epub');
    assert.equal(deps.calls[1][0], 'importBookViaHttp');
    // Hash comes from the descriptor (mocked to 'book-import'), not from --case15 arg
    assert.equal(deps.calls[1][2].hash, 'book-import');
  });

  it('routes --case15 desktop with --import-book to importEpubToLibrary', async () => {
    const deps = makeDeps();
    const result = await dispatchFixture(parseFixtureArgs([
      '--target', 'desktop', '--case15', 'ignored-hash',
      '--import-book', '/fake/path/book.epub',
      '--title', 'Desktop Epub', '--author', 'Epub Author',
    ]), deps);
    assert.equal(result.ok, true);
    assert.equal(deps.calls[0][0], 'importEpubToLibrary');
    assert.equal(deps.calls[0][1].filePath, '/fake/path/book.epub');
    assert.equal(deps.calls[0][1].title, 'Desktop Epub');
  });

  it('routes --case16 desktop to injectDictionary', async () => {
    const deps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--case16', 'Café', '--book', 'book-1']), deps);
    assert.equal(deps.calls[0][0], 'injectDictionary');
    assert.equal(deps.calls[0][1].term, 'Café');
  });

  it('routes --case17 desktop to injectQuote', async () => {
    const deps = makeDeps();
    await dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--case17', 'quote text', '--book', 'book-1']), deps);
    assert.equal(deps.calls[0][0], 'injectQuote');
    assert.equal(deps.calls[0][1].text, 'quote text');
  });

  it('rejects invalid combinations and non-editable fields clearly', async () => {
    await assert.rejects(
      () => dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--edit', 'quotes:quote-1:text=changed']), makeDeps()),
      /Field is not editable by this harness: quotes\.text/,
    );

    await assert.rejects(
      () => dispatchFixture(parseFixtureArgs(['--target', 'desktop', '--dict', 'zozobrar', '--book', 'book-1', '--delete', 'annotations:ann-1']), makeDeps()),
      /Choose exactly one fixture operation/,
    );
  });
});
