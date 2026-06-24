import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as React from 'react';

import { createLibraryBookDeleteHandler } from '@/app/library/bookDelete';
import Bookshelf from '@/app/library/components/Bookshelf';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useCitasStore } from '@/store/citasStore';
import { useDictionaryStore } from '@/store/dictionaryStore';
import type { Book } from '@/types/book';
import type { Annotacion } from '@/types/annotaciones';
import type { Cite } from '@/types/citas';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';

const {
  pushMock,
  navigateToReaderMock,
  menuNewMock,
  menuItemNewMock,
  loadBookConfigMock,
  saveBookConfigMock,
  deleteQuotesByBookMock,
  getCitasServiceMock,
  removeQuotesFromStateMock,
  consoleWarnMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  navigateToReaderMock: vi.fn(),
  menuNewMock: vi.fn(async () => ({ append: vi.fn(), popup: vi.fn() })),
  menuItemNewMock: vi.fn(async () => ({})),
  loadBookConfigMock: vi.fn(),
  saveBookConfigMock: vi.fn(),
  deleteQuotesByBookMock: vi.fn<(bookHash: string) => Promise<string[]>>(),
  getCitasServiceMock: vi.fn(),
  removeQuotesFromStateMock: vi.fn(),
  consoleWarnMock: vi.fn(),
}));

let searchParams = new URLSearchParams();
let selectedBooks: string[] = [];
let hasContextMenu = false;
let libraryViewMode = 'grid';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock('@/utils/nav', async () => {
  const actual = await vi.importActual<typeof import('@/utils/nav')>('@/utils/nav');
  return {
    ...actual,
    navigateToReader: navigateToReaderMock,
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      hasWindow: false,
      hasContextMenu,
      isMobileApp: false,
      isAndroidApp: false,
      isBookAvailable: vi.fn(async () => true),
      loadBookConfig: loadBookConfigMock,
      saveBookConfig: saveBookConfigMock,
    },
  }),
}));

vi.mock('@/hooks/useAutoFocus', () => ({
  useAutoFocus: () => ({ current: null }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: () => 15,
}));

vi.mock('@/app/library/hooks/useSpatialNavigation', () => ({
  useSpatialNavigation: vi.fn(),
}));

vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: () => [vi.fn(), () => ({ destroy: vi.fn() })],
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    totalCount,
    itemContent,
  }: {
    totalCount: number;
    itemContent: (index: number) => React.ReactNode;
  }) => (
    <div data-testid='virtuoso-list'>
      {Array.from({ length: totalCount }, (_, index) => (
        <div key={index}>{itemContent(index)}</div>
      ))}
    </div>
  ),
  VirtuosoGrid: ({
    totalCount,
    itemContent,
  }: {
    totalCount: number;
    itemContent: (index: number) => React.ReactNode;
  }) => (
    <div data-testid='virtuoso-grid'>
      {Array.from({ length: totalCount }, (_, index) => (
        <div key={index}>{itemContent(index)}</div>
      ))}
    </div>
  ),
}));

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNewMock },
  MenuItem: { new: menuItemNewMock },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { bottom: 0 } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryViewMode,
      librarySortBy: 'title',
      librarySortAscending: true,
      libraryGroupBy: 'none',
      libraryCoverFit: 'crop',
      libraryAutoColumns: true,
      libraryColumns: 6,
      openBookInNewWindow: false,
    },
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({
    setCurrentBookshelf: vi.fn(),
    setLibrary: vi.fn(),
    updateBooks: vi.fn(),
    setSelectedBooks: (ids: string[]) => {
      selectedBooks = ids;
    },
    getSelectedBooks: () => selectedBooks,
    toggleSelectedBook: (id: string) => {
      selectedBooks = selectedBooks.includes(id)
        ? selectedBooks.filter((selectedId) => selectedId !== id)
        : [...selectedBooks, id];
    },
    getGroupName: vi.fn(() => ''),
  }),
}));

const makeBook = (overrides: Partial<Book>): Book => ({
  hash: overrides.hash ?? 'book-hash',
  format: 'EPUB',
  title: overrides.title ?? 'Book title',
  author: overrides.author ?? 'Author',
  coverImageUrl: overrides.coverImageUrl ?? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  createdAt: overrides.createdAt ?? 1,
  updatedAt: overrides.updatedAt ?? 1,
  groupName: overrides.groupName,
  groupId: overrides.groupId,
  deletedAt: overrides.deletedAt,
});

const makeQuote = (overrides: Partial<Cite>): Cite => ({
  id: overrides.id ?? 'quote-1',
  bookHash: overrides.bookHash ?? 'book-abc',
  bookTitle: 'Book title',
  bookAuthor: 'Author',
  cfi: 'epubcfi(/6/2)',
  sectionHref: 'chapter.xhtml',
  page: 7,
  text: 'quoted text',
  contextBefore: 'before',
  contextAfter: 'after',
  contentHash: 'hash',
  createdAt: 1,
  updatedAt: null,
  ...overrides,
});

const makeAnnotation = (overrides: Partial<Annotacion>): Annotacion => ({
  id: overrides.id ?? 'annotation-1',
  bookHash: overrides.bookHash ?? 'book-abc',
  bookTitle: 'Book title',
  bookAuthor: 'Author',
  cfi: 'epubcfi(/6/4)',
  sectionHref: 'chapter.xhtml',
  page: 8,
  text: 'annotated text',
  note: 'reader note',
  style: 'highlight',
  color: 'yellow',
  createdAt: 1,
  updatedAt: null,
  ...overrides,
});

const makeDictionaryEntry = (overrides: Partial<DictionaryEntry>): DictionaryEntry => ({
  id: overrides.id ?? 'dictionary-entry-1',
  term: 'palabra',
  displayTerm: 'Palabra',
  language: 'es',
  definition: 'definition',
  enrichmentStatus: 'none',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const makeDictionaryOccurrence = (
  overrides: Partial<DictionaryOccurrence>,
): DictionaryOccurrence => ({
  id: overrides.id ?? 'dictionary-occurrence-1',
  entryId: overrides.entryId ?? 'dictionary-entry-1',
  bookHash: overrides.bookHash ?? 'book-abc',
  bookTitle: 'Book title',
  bookAuthor: 'Author',
  cfi: 'epubcfi(/6/8)',
  sectionHref: 'chapter.xhtml',
  page: 9,
  selectedText: 'palabra',
  contextBefore: 'before',
  contextAfter: 'after',
  createdAt: 1,
  ...overrides,
});

const renderBookshelf = (books: Book[], isSelectMode = false) =>
  render(
    <Bookshelf
      libraryBooks={books}
      isSelectMode={isSelectMode}
      isSelectAll={false}
      isSelectNone={false}
      onScrollerRef={vi.fn()}
      handleImportBooks={vi.fn()}
      handleBookDelete={vi.fn(async () => true)}
      handleSetSelectMode={vi.fn()}
      handleShowDetailsBook={vi.fn()}
      handleLibraryNavigation={vi.fn()}
      handlePushLibrary={vi.fn(async () => undefined)}
    />,
  );

const bookshelfLabels = () =>
  screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
    .filter((label) => label !== 'Show Book Details');

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  navigateToReaderMock.mockReset();
  menuNewMock.mockClear();
  menuItemNewMock.mockClear();
  loadBookConfigMock.mockReset();
  saveBookConfigMock.mockReset();
  searchParams = new URLSearchParams();
  selectedBooks = [];
  hasContextMenu = false;
  libraryViewMode = 'grid';
});

describe('Bookshelf Citas entry', () => {
  it('pins Citas second while real books follow both false books and Anotaciones', () => {
    searchParams = new URLSearchParams('sort=title&order=asc');

    renderBookshelf([
      makeBook({ hash: 'zeta', title: 'Zeta handbook', updatedAt: 1 }),
      makeBook({ hash: 'alpha', title: 'Alpha field notes', updatedAt: 2 }),
    ]);

    const grid = screen.getByTestId('virtuoso-grid');
    const itemLabels = within(grid)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label !== 'Show Book Details');
    expect(itemLabels).toEqual([
      'Diccionario',
      'Citas',
      'Anotaciones',
      'Alpha field notes',
      'Zeta handbook',
      'Import Books',
    ]);
  });

  it('filters Citas out when search filters out every book', () => {
    searchParams = new URLSearchParams('q=missing');

    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    expect(bookshelfLabels()).toEqual(['Import Books']);
    expect(screen.queryByRole('button', { name: 'Alpha field notes' })).toBeNull();
  });

  it('opens /citas without invoking reader navigation', () => {
    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Citas' }));

    expect(pushMock).toHaveBeenCalledWith('/citas');
    expect(navigateToReaderMock).not.toHaveBeenCalled();
    expect(loadBookConfigMock).not.toHaveBeenCalled();
    expect(saveBookConfigMock).not.toHaveBeenCalled();
  });

  it('renders the Citas author in list mode', () => {
    libraryViewMode = 'list';

    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    expect(screen.getAllByText('Mateo Galiano')).toHaveLength(3);
    expect(screen.queryByText('Citas guardadas desde tus lecturas')).toBeNull();
  });

  it('ignores selection attempts on Citas', () => {
    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })], true);

    fireEvent.click(screen.getByRole('button', { name: 'Citas' }));

    expect(selectedBooks).toEqual([]);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('ignores the context menu for Citas', () => {
    hasContextMenu = true;
    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Citas' }));

    expect(menuNewMock).not.toHaveBeenCalled();
    expect(menuItemNewMock).not.toHaveBeenCalled();
  });
});

describe('Book deletion preserves collected Citas data', () => {
  const envConfig = { getAppService: vi.fn() };

  const createDeleteHandler = (deleteBook = vi.fn().mockResolvedValue(undefined)) => {
    const updateBook = vi.fn<(_envConfig: typeof envConfig, book: Book) => Promise<void>>();
    const clearBookData = vi.fn<(bookHash: string) => void>();
    const dispatchToast =
      vi.fn<(payload: { type: string; message: string; timeout?: number }) => void>();

    const handler = createLibraryBookDeleteHandler({
      appService: { deleteBook },
      envConfig,
      updateBook,
      clearBookData,
      dispatchToast,
      translate: (key: string, values?: Record<string, string>) =>
        values?.title ? `${key}:${values.title}` : key,
      now: () => 12345,
    });

    return { handler, deleteBook, updateBook, clearBookData, dispatchToast };
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(consoleWarnMock);
    getCitasServiceMock.mockReset();
    deleteQuotesByBookMock.mockReset();
    removeQuotesFromStateMock.mockReset();
    consoleWarnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useCitasStore.getState().reset();
    useAnotacionesStore.getState().reset();
    useDictionaryStore.getState().reset();
  });

  it('marks the source book deleted without deleting preserved quotes', async () => {
    const { handler, deleteBook, updateBook, clearBookData, dispatchToast } = createDeleteHandler();
    const book = makeBook({ hash: 'book-abc' });
    const result = await handler(book);

    expect(result).toBe(true);
    expect(deleteBook).toHaveBeenCalledWith(book);
    expect(updateBook).toHaveBeenCalledWith(envConfig, {
      ...book,
      deletedAt: 12345,
      downloadedAt: null,
      coverDownloadedAt: null,
    });
    expect(clearBookData).toHaveBeenCalledWith('book-abc');
    expect(dispatchToast).toHaveBeenCalledWith({
      type: 'info',
      timeout: 1000,
      message: 'Book deleted: {{title}}:Book title',
    });
    expect(getCitasServiceMock).not.toHaveBeenCalled();
    expect(deleteQuotesByBookMock).not.toHaveBeenCalled();
    expect(removeQuotesFromStateMock).not.toHaveBeenCalled();
  });

  it('marks the source book deleted while quotes, annotations, and dictionary occurrences stay visible', async () => {
    const { handler } = createDeleteHandler();
    const quote = makeQuote({ bookHash: 'book-preserved' });
    const annotation = makeAnnotation({ bookHash: 'book-preserved' });
    const dictionaryEntry = makeDictionaryEntry({ id: 'entry-preserved' });
    const dictionaryOccurrence = makeDictionaryOccurrence({
      entryId: 'entry-preserved',
      bookHash: 'book-preserved',
    });
    useCitasStore.getState().setQuotes([quote]);
    useAnotacionesStore.setState({ annotations: [annotation] });
    useDictionaryStore.getState().setEntries([dictionaryEntry]);
    useDictionaryStore.getState().setOccurrences('entry-preserved', [dictionaryOccurrence]);

    const result = await handler(makeBook({ hash: 'book-preserved' }));

    expect(result).toBe(true);
    expect(useCitasStore.getState().getVisibleQuotes()).toEqual([quote]);
    expect(useAnotacionesStore.getState().getVisibleAnnotations()).toEqual([annotation]);
    expect(useDictionaryStore.getState().getVisibleDictionaryEntries()).toEqual([dictionaryEntry]);
    expect(useDictionaryStore.getState().getVisibleOccurrences('entry-preserved')).toEqual([
      dictionaryOccurrence,
    ]);
  });

  it('does NOT call collected-data deleters when book deletion fails', async () => {
    const { handler, updateBook, clearBookData, dispatchToast } = createDeleteHandler(
      vi.fn().mockRejectedValue(new Error('delete failed')),
    );
    getCitasServiceMock.mockResolvedValue({
      deleteQuotesByBook: deleteQuotesByBookMock,
    });

    const result = await handler(makeBook({ hash: 'book-fail' }));

    expect(result).toBe(false);
    expect(updateBook).not.toHaveBeenCalled();
    expect(clearBookData).not.toHaveBeenCalled();
    expect(dispatchToast).toHaveBeenCalledWith({
      message: 'Failed to delete book: {{title}}:Book title',
      type: 'error',
    });
    expect(deleteQuotesByBookMock).not.toHaveBeenCalled();
  });
});
