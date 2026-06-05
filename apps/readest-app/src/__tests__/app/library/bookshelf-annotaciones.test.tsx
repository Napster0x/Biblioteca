import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as React from 'react';

import Bookshelf from '@/app/library/components/Bookshelf';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { Book } from '@/types/book';

const { pushMock, navigateToAnotacionesMock, menuNewMock, menuItemNewMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  navigateToAnotacionesMock: vi.fn(),
  menuNewMock: vi.fn(async () => ({ append: vi.fn(), popup: vi.fn() })),
  menuItemNewMock: vi.fn(async () => ({})),
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
    navigateToAnotaciones: navigateToAnotacionesMock,
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

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  navigateToAnotacionesMock.mockReset();
  menuNewMock.mockClear();
  menuItemNewMock.mockClear();
  searchParams = new URLSearchParams();
  selectedBooks = [];
  hasContextMenu = false;
  libraryViewMode = 'grid';
});

describe('Bookshelf Anotaciones entry', () => {
  it('pins Anotaciones third after DICT and CITAS, before real books', () => {
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

  it('opens /anotaciones without invoking reader navigation', () => {
    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Anotaciones' }));

    expect(navigateToAnotacionesMock).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('renders the Anotaciones author in list mode', () => {
    libraryViewMode = 'list';

    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    expect(screen.getAllByText('Mateo Galiano')).toHaveLength(3);
  });

  it('ignores selection attempts on Anotaciones', () => {
    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })], true);

    fireEvent.click(screen.getByRole('button', { name: 'Anotaciones' }));

    expect(selectedBooks).toEqual([]);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('ignores the context menu for Anotaciones', () => {
    hasContextMenu = true;
    renderBookshelf([makeBook({ hash: 'alpha', title: 'Alpha field notes' })]);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Anotaciones' }));

    expect(menuNewMock).not.toHaveBeenCalled();
    expect(menuItemNewMock).not.toHaveBeenCalled();
  });
});
