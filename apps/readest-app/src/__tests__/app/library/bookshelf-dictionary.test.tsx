import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as React from 'react';

import Bookshelf from '@/app/library/components/Bookshelf';
import { createBookshelfSourceItems, createBookGroups } from '@/app/library/utils/libraryUtils';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { Book } from '@/types/book';
import { LibraryGroupByType } from '@/types/settings';

const { pushMock, navigateToReaderMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  navigateToReaderMock: vi.fn(),
}));

let searchParams = new URLSearchParams();
let selectedBooks: string[] = [];

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
      hasContextMenu: false,
      isMobileApp: false,
      isAndroidApp: false,
      isBookAvailable: vi.fn(async () => true),
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

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { bottom: 0 } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryViewMode: 'grid',
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
    getGroupName: (id: string) => (id === 'fiction' ? 'Fiction' : ''),
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

const renderBookshelf = (books: Book[]) =>
  render(
    <Bookshelf
      libraryBooks={books}
      isSelectMode={false}
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

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  navigateToReaderMock.mockReset();
  searchParams = new URLSearchParams();
  selectedBooks = [];
});

describe('Bookshelf dictionary entry', () => {
  it('filters false books out when search matches only a real book', () => {
    searchParams = new URLSearchParams('q=alpha&sort=title&order=asc');

    renderBookshelf([
      makeBook({ hash: 'zeta', title: 'Zeta handbook', updatedAt: 1 }),
      makeBook({ hash: 'alpha', title: 'Alpha field notes', updatedAt: 2 }),
    ]);

    const itemLabels = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label !== 'Show Book Details');
    expect(itemLabels).toEqual(['Alpha field notes', 'Import Books']);
    expect(screen.queryByRole('button', { name: 'Zeta handbook' })).toBeNull();
  });

  it('keeps Diccionario first when library grouping shows groups', () => {
    searchParams = new URLSearchParams('groupBy=group');

    renderBookshelf([
      makeBook({ hash: 'one', title: 'One', groupName: 'Fiction', updatedAt: 2 }),
      makeBook({ hash: 'two', title: 'Two', groupName: 'Fiction/Sub', updatedAt: 3 }),
    ]);

    const grid = screen.getByTestId('virtuoso-grid');
    const itemLabels = within(grid)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label !== 'Show Book Details');
    expect(itemLabels.slice(0, 4)).toEqual(['Diccionario', 'Citas', 'Anotaciones', 'Fiction']);
  });

  it('filters Diccionario, Citas and Anotaciones when search filters out every book', () => {
    searchParams = new URLSearchParams('q=missing');

    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    const itemLabels = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(itemLabels).toEqual(['Import Books']);
    expect(screen.queryByRole('button', { name: 'Alpha field notes' })).toBeNull();
  });

  it('finds the false books by their shared author', () => {
    searchParams = new URLSearchParams('q=Mateo Galiano');

    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    const itemLabels = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(itemLabels).toEqual(['Anotaciones', 'Citas', 'Diccionario', 'Import Books']);
    expect(screen.queryByRole('button', { name: 'Alpha field notes' })).toBeNull();
  });

  it('groups the false books under Mateo Galiano when grouping by author', () => {
    searchParams = new URLSearchParams('groupBy=author');

    renderBookshelf([
      makeBook({ hash: 'alpha', title: 'Alpha field notes', author: 'Other Author' }),
    ]);

    const itemLabels = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label !== 'Show Book Details');
    expect(itemLabels).toContain('Mateo Galiano');
  });

  it('groups future real Mateo Galiano books together with the false books', () => {
    const groups = createBookGroups(
      createBookshelfSourceItems([
        makeBook({ hash: 'mateo-real', title: 'Real Mateo book', author: 'Mateo Galiano' }),
      ]),
      LibraryGroupByType.Author,
    );

    const mateoGroup = groups.find(
      (item) => 'books' in item && item.displayName === 'Mateo Galiano',
    );

    expect(
      mateoGroup && 'books' in mateoGroup ? mateoGroup.books.map((book) => book.hash) : [],
    ).toEqual(expect.arrayContaining(['dictionary', 'citas', 'anotaciones', 'mateo-real']));
  });

  it('opens the dictionary route without invoking reader navigation', () => {
    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Diccionario' }));

    expect(pushMock).toHaveBeenCalledWith('/dictionary');
    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });
});
