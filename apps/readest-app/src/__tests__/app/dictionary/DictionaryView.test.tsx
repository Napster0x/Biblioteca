import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';

// jsdom provides window.localStorage by default, but some error-recovery test
// flows can leave it undefined. Stub it at the file level to avoid cascading
// "Cannot read properties of undefined" failures from DictionaryGrid.tsx:37.
if (typeof window !== 'undefined' && !window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      const store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          Object.keys(store).forEach((k) => delete store[k]);
        },
      };
    })(),
    writable: true,
    configurable: true,
  });
}

// jsdom does not implement ResizeObserver. DictionaryGrid uses useContainerSize
// which creates a ResizeObserver internally. Provide a no-op stub so the
// component renders without throwing.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  goTo: vi.fn(),
  createDir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  loadEntries: vi.fn(),
  loadEntry: vi.fn(),
  loadOccurrences: vi.fn(),
  updateEntry: vi.fn(),
  toggleSelectedEntry: vi.fn(),
  addEntry: vi.fn(),
  enterSelectMode: vi.fn(),
  cancelSelectMode: vi.fn(),
  deleteSelectedEntries: vi.fn(),
  setEntry: vi.fn(),
  setOccurrences: vi.fn(),
  getDictionaryService: vi.fn(),
  appService: { platform: 'test', createDir: vi.fn(), writeFile: vi.fn(), readFile: vi.fn() },
}));

let mockEntries: DictionaryEntry[] = [];
let mockEntry: DictionaryEntry | null = null;
let mockOccurrencesByEntryId: Record<string, DictionaryOccurrence[]> = {};
let mockIsLoading = false;
let mockIsSelectMode = false;
let mockSelectedEntryIds: string[] = [];
let mockViewStates: Record<string, { view?: { goTo: (cfi: string) => void } }> = {};

interface MockDictionaryStoreState {
  entries: DictionaryEntry[];
  entry: DictionaryEntry | null;
  occurrencesByEntryId: Record<string, DictionaryOccurrence[]>;
  isLoading: boolean;
  isSelectMode: boolean;
  selectedEntryIds: string[];
  loadEntries: typeof mocks.loadEntries;
  searchEntries: typeof mocks.loadEntries;
  loadEntry: typeof mocks.loadEntry;
  loadOccurrences: typeof mocks.loadOccurrences;
  updateEntry: typeof mocks.updateEntry;
  toggleSelectedEntry: typeof mocks.toggleSelectedEntry;
  addEntry: typeof mocks.addEntry;
  enterSelectMode: typeof mocks.enterSelectMode;
  cancelSelectMode: typeof mocks.cancelSelectMode;
  deleteSelectedEntries: typeof mocks.deleteSelectedEntries;
  setEntry: typeof mocks.setEntry;
  setOccurrences: typeof mocks.setOccurrences;
}

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=entry-1'),
  useRouter: () => ({ back: mocks.back, push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.appService }),
}));

vi.mock('@/services/dictionary/dictionaryServiceCache', () => ({
  getDictionaryService: mocks.getDictionaryService,
}));

vi.mock('@/store/dictionaryStore', () => ({
  useDictionaryStore: (selector: (s: MockDictionaryStoreState) => unknown) =>
    selector({
      entries: mockEntries,
      entry: mockEntry,
      occurrencesByEntryId: mockOccurrencesByEntryId,
      isLoading: mockIsLoading,
      isSelectMode: mockIsSelectMode,
      selectedEntryIds: mockSelectedEntryIds,
      loadEntries: mocks.loadEntries,
      searchEntries: mocks.loadEntries,
      loadEntry: mocks.loadEntry,
      loadOccurrences: mocks.loadOccurrences,
      updateEntry: mocks.updateEntry,
      toggleSelectedEntry: mocks.toggleSelectedEntry,
      addEntry: mocks.addEntry,
      enterSelectMode: mocks.enterSelectMode,
      cancelSelectMode: mocks.cancelSelectMode,
      deleteSelectedEntries: mocks.deleteSelectedEntries,
      setEntry: mocks.setEntry,
      setOccurrences: mocks.setOccurrences,
    }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      viewStates: mockViewStates,
      setPreviewMode: vi.fn(),
    }),
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import DictionaryGrid from '@/app/dictionary/DictionaryGrid';
import DictionaryDetailPage from '@/app/dictionary/detail/page';
import DictionaryPage from '@/app/dictionary/page';

const mockService = {
  getEntry: vi.fn().mockResolvedValue(makeEntry()),
  listOccurrences: vi.fn().mockResolvedValue([]),
} as unknown as DictionaryService;

function makeEntry(overrides: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return {
    id: 'entry-1',
    term: 'serendipia',
    displayTerm: 'serendipia',
    enrichmentStatus: 'none',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeOccurrence(overrides: Partial<DictionaryOccurrence> = {}): DictionaryOccurrence {
  return {
    id: 'occ-1',
    entryId: 'entry-1',
    bookHash: 'book-hash',
    bookTitle: 'El libro de los casos',
    cfi: '/6/2!/4/2',
    selectedText: 'serendipia',
    contextBefore: 'Antes de la palabra',
    contextAfter: 'después de la palabra',
    createdAt: 3000,
    ...overrides,
  };
}

describe('DictionaryGrid', () => {
  beforeEach(() => {
    mockEntries = [];
    mockEntry = null;
    mockOccurrencesByEntryId = {};
    mockIsLoading = false;
    mockIsSelectMode = false;
    mockSelectedEntryIds = [];
    mockViewStates = {};
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.goTo.mockReset();
    mocks.loadEntries.mockReset();
    mocks.loadEntry.mockReset();
    mocks.loadOccurrences.mockReset();
    mocks.updateEntry.mockReset();
    mocks.toggleSelectedEntry.mockReset();
    mocks.addEntry.mockReset();
    mocks.enterSelectMode.mockReset();
    mocks.cancelSelectMode.mockReset();
    mocks.deleteSelectedEntries.mockReset();
    mocks.setEntry.mockReset();
    mocks.setOccurrences.mockReset();
    vi.mocked(mockService.listOccurrences).mockResolvedValue([]);
    vi.mocked(mockService.getEntry).mockResolvedValue(makeEntry());
    mocks.getDictionaryService.mockReset();
    mocks.getDictionaryService.mockResolvedValue(mockService);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders an empty dictionary message and loads entries on mount', () => {
    render(<DictionaryGrid service={mockService} />);

    expect(screen.getByText('Diccionario')).toBeTruthy();
    expect(screen.getByText(/vacío/i)).toBeTruthy();
    expect(mocks.loadEntries).toHaveBeenCalledWith(mockService);
  });

  it('renders square tile links for entries with and without images', () => {
    mockEntries = [
      makeEntry({
        id: 'entry-1',
        displayTerm: 'serendipia',
        imagePath: 'Dictionaries/entry-1.png',
      }),
      makeEntry({ id: 'entry-2', displayTerm: 'efímero', imagePath: undefined }),
    ];

    render(<DictionaryGrid service={mockService} />);

    expect(screen.getByRole('link', { name: /serendipia/i }).getAttribute('href')).toBe(
      '/dictionary/detail?id=entry-1',
    );
    expect(screen.getByRole('link', { name: /efímero/i }).getAttribute('href')).toBe(
      '/dictionary/detail?id=entry-2',
    );
  });

  it('delegates tile search by word and definition to the dictionary store', () => {
    mockEntries = [
      makeEntry({ id: 'entry-1', displayTerm: 'serendipia', definition: 'Hallazgo afortunado' }),
      makeEntry({ id: 'entry-2', displayTerm: 'efímero', definition: 'Dura poco' }),
    ];

    const { rerender } = render(<DictionaryGrid service={mockService} />);
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'afortunado' } });
    mockEntries = [
      makeEntry({ id: 'entry-1', displayTerm: 'serendipia', definition: 'Hallazgo afortunado' }),
    ];
    rerender(<DictionaryGrid service={mockService} />);

    expect(screen.getByRole('link', { name: /serendipia/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /efímero/i })).toBeNull();
    expect(mocks.loadEntries).toHaveBeenCalledWith('afortunado', mockService);
  });

  it('renders dictionary tiles as toggle buttons when select mode is active', () => {
    mockIsSelectMode = true;
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);
    const tile = screen.getByRole('button', { name: /seleccionar serendipia/i });

    fireEvent.click(tile);

    expect(tile.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('link', { name: /serendipia/i })).toBeNull();
    expect(mocks.toggleSelectedEntry).toHaveBeenCalledWith('entry-1');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shows selected tiles with a non-color selected label in select mode', () => {
    mockIsSelectMode = true;
    mockSelectedEntryIds = ['entry-1'];
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);
    const tile = screen.getByRole('button', { name: /deseleccionar serendipia/i });

    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Seleccionado')).toBeTruthy();
  });

  it('shows a loading message when loading before entries exist', () => {
    mockIsLoading = true;

    render(<DictionaryGrid service={mockService} />);

    expect(screen.getByText(/cargando/i)).toBeTruthy();
  });

  it('keeps the search input mounted while a search is loading with no results', () => {
    const { rerender } = render(<DictionaryGrid service={mockService} />);

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'borges' } });
    mockIsLoading = true;
    mockEntries = [];
    rerender(<DictionaryGrid service={mockService} />);

    const searchInput = screen.getByLabelText('Buscar') as HTMLInputElement;
    expect(searchInput.value).toBe('borges');
    expect(screen.queryByText(/cargando/i)).toBeNull();
    expect(screen.getByText('Actualizando…')).toBeTruthy();
  });

  it('renders toolbar Add (PiPlus) and Select action buttons on the right side', () => {
    render(<DictionaryGrid service={mockService} />);

    expect(screen.getByRole('button', { name: 'Añadir palabra' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seleccionar' })).toBeTruthy();
  });

  it('does not show book-only Group, Status, or Import actions in dictionary toolbar', () => {
    render(<DictionaryGrid service={mockService} />);

    expect(screen.queryByRole('button', { name: /agrupar|grupo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /estado|status/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /importar/i })).toBeNull();
  });

  it('opens an Add Word dialog when + is clicked and submits with term + definition', async () => {
    render(<DictionaryGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Añadir palabra' }));

    expect(screen.getByRole('dialog', { name: 'Añadir palabra' })).toBeTruthy();
    expect(screen.getByLabelText('Palabra')).toBeTruthy();
    expect(screen.getByLabelText('Definición (opcional)')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Palabra'), { target: { value: 'neologismo' } });
    fireEvent.change(screen.getByLabelText('Definición (opcional)'), {
      target: { value: 'Palabra de nueva creación' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      expect(mocks.addEntry).toHaveBeenCalledWith(
        { term: 'neologismo', definition: 'Palabra de nueva creación' },
        mockService,
      );
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rejects empty or whitespace-only term in Add Word dialog with validation message', () => {
    render(<DictionaryGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Añadir palabra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText('La palabra es obligatoria')).toBeTruthy();
    expect(mocks.addEntry).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Whitespace-only is also rejected
    fireEvent.change(screen.getByLabelText('Palabra'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText('La palabra es obligatoria')).toBeTruthy();
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it('closes Add Word dialog when cancel is clicked without submitting', () => {
    render(<DictionaryGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Añadir palabra' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it('shows toolbar actions alongside no-results empty state when search has no matches', () => {
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    const { rerender } = render(<DictionaryGrid service={mockService} />);
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'xyzzy' } });
    mockEntries = [];
    rerender(<DictionaryGrid service={mockService} />);

    expect(screen.getByText('Sin resultados')).toBeTruthy();
    // Toolbar actions remain usable
    expect(screen.getByRole('button', { name: 'Añadir palabra' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seleccionar' })).toBeTruthy();
  });

  it('enters select mode when Select toolbar button is clicked and shows Cancel/Delete bar', () => {
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar' }));

    expect(mocks.enterSelectMode).toHaveBeenCalled();
  });

  it('shows bottom Cancel and Delete action bar when select mode is active', () => {
    mockIsSelectMode = true;
    mockSelectedEntryIds = ['entry-1'];
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Borrar seleccionados' })).toBeTruthy();
  });

  it('shows disabled Delete button when select mode is active but no entries selected', () => {
    mockIsSelectMode = true;
    mockSelectedEntryIds = [];
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);

    const deleteButton = screen.getByRole('button', { name: 'Borrar seleccionados' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls cancelSelectMode when Cancel is clicked in the bottom bar', () => {
    mockIsSelectMode = true;
    mockSelectedEntryIds = ['entry-1'];
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(mocks.cancelSelectMode).toHaveBeenCalled();
  });

  it('shows confirmation alert and calls deleteSelectedEntries when Delete is confirmed', async () => {
    mockIsSelectMode = true;
    mockSelectedEntryIds = ['entry-1'];
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Borrar seleccionados' }));

    // Confirmation dialog appears (translation mock returns key as-is)
    expect(screen.getByText(/¿Borrar.*entrada.*seleccionada/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sí, borrar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No, cancelar' })).toBeTruthy();

    // Confirm delete
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }));

    await waitFor(() => {
      expect(mocks.deleteSelectedEntries).toHaveBeenCalledWith(mockService);
    });
  });

  it('cancels delete when No is clicked in confirmation alert without deleting', () => {
    mockIsSelectMode = true;
    mockSelectedEntryIds = ['entry-1'];
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Borrar seleccionados' }));
    fireEvent.click(screen.getByRole('button', { name: 'No, cancelar' }));

    expect(mocks.deleteSelectedEntries).not.toHaveBeenCalled();
  });

  it('preserves search wiring alongside toolbar actions', () => {
    mockEntries = [
      makeEntry({ id: 'entry-1', displayTerm: 'serendipia', definition: 'Hallazgo afortunado' }),
      makeEntry({ id: 'entry-2', displayTerm: 'efímero', definition: 'Dura poco' }),
    ];

    render(<DictionaryGrid service={mockService} />);

    // Toolbar actions are present
    expect(screen.getByRole('button', { name: 'Añadir palabra' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seleccionar' })).toBeTruthy();

    // Search is delegated to the dictionary store/service so occurrence metadata
    // such as book title and author can participate in the same search.
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'afortunado' } });
    expect(screen.getByRole('link', { name: /serendipia/i })).toBeTruthy();
    expect(mocks.loadEntries).toHaveBeenCalledWith('afortunado', mockService);
  });

  it('searches dictionary entries through the store action when the user types', () => {
    render(<DictionaryGrid service={mockService} />);

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Borges' } });

    expect(mocks.loadEntries).toHaveBeenCalledWith('Borges', mockService);
  });

  it('shows book-only actions never appear in dictionary toolbar groups', () => {
    // Select mode does not add Group, Status, Details, or Open actions
    mockIsSelectMode = true;
    mockSelectedEntryIds = ['entry-1'];
    mockEntries = [makeEntry({ id: 'entry-1', displayTerm: 'serendipia' })];

    render(<DictionaryGrid service={mockService} />);

    expect(screen.queryByText('Agrupar')).toBeNull();
    expect(screen.queryByText('Estado')).toBeNull();
    expect(screen.queryByText('Detalles')).toBeNull();
    expect(screen.queryByText('Abrir')).toBeNull();
  });

  it('sizes the word relative to the tile so long words stay inside the mosaic (and on hover)', () => {
    // A 24-char word that would overflow a small tile with a viewport-based clamp
    mockEntries = [
      makeEntry({ id: 'entry-1', displayTerm: 'electroencefalografista' }),
      makeEntry({ id: 'entry-2', displayTerm: 'serendipia' }),
    ];

    render(<DictionaryGrid service={mockService} />);

    const link = screen.getByRole('link', { name: /electroencefalografista/i });

    // The tile is a CSS container so the word's font-size can adapt to it
    // (otherwise clamp(vw, …) is independent of the actual tile size in the grid)
    expect(link.className).toContain('@container');

    // The word is sized relative to the tile (container query) so it shrinks on
    // small tiles and the hover scale-110 still fits inside. The data attribute
    // is the structural marker for the formula; jsdom can't parse `cqi` / `min()`
    // so the inline font-size would otherwise round-trip to empty in tests.
    const wordSpan = link.querySelector('span');
    expect(wordSpan).toBeTruthy();
    expect(wordSpan?.getAttribute('data-word-sizing')).toBe('cqi');

    // Very long words break to multiple lines instead of overflowing
    expect(wordSpan?.className).toContain('break-words');

    // Short words still render and the same rules apply
    const shortLink = screen.getByRole('link', { name: /serendipia/i });
    expect(shortLink.className).toContain('@container');
  });
});

describe('DictionaryPage', () => {
  beforeEach(() => {
    mockEntries = [];
    mockEntry = null;
    mockOccurrencesByEntryId = {};
    mockIsLoading = false;
    mocks.loadEntries.mockReset();
    mocks.setEntry.mockReset();
    mocks.setOccurrences.mockReset();
    mocks.getDictionaryService.mockReset();
    mocks.back.mockReset();
    mocks.replace.mockReset();
    vi.mocked(mockService.getEntry).mockResolvedValue(makeEntry());
    vi.mocked(mockService.listOccurrences).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an error when the dictionary service fails to open', async () => {
    mocks.getDictionaryService.mockRejectedValue(new Error('database locked'));

    render(<DictionaryPage />);

    expect(
      await screen.findByRole('heading', { name: 'Error al abrir el diccionario' }),
    ).toBeTruthy();
    expect(screen.getByText('database locked')).toBeTruthy();
  });

  it('retries opening the dictionary service when Reintentar is clicked', async () => {
    mocks.getDictionaryService
      .mockRejectedValueOnce(new Error('database locked'))
      .mockResolvedValueOnce(mockService);

    render(<DictionaryPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(mocks.getDictionaryService).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Diccionario')).toBeTruthy();
  });

  it('uses the book icon in the dictionary header to navigate back', async () => {
    mocks.getDictionaryService.mockResolvedValue(mockService);

    render(<DictionaryPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Volver a Biblioteca' }));

    expect(mocks.replace).toHaveBeenCalledWith('/library', undefined);
  });
});

describe('DictionaryDetailPage', () => {
  beforeEach(() => {
    mockEntries = [];
    mockEntry = makeEntry({
      displayTerm: 'serendipia',
      definition: 'Definición inicial',
      curiosity: 'Dato inicial',
      imagePath: 'Dictionaries/entry-1.png',
    });
    mockOccurrencesByEntryId = { 'entry-1': [makeOccurrence()] };
    mockIsLoading = false;
    mockViewStates = {};
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.back.mockReset();
    mocks.goTo.mockReset();
    mocks.createDir.mockReset();
    mocks.writeFile.mockReset();
    mocks.readFile.mockReset();
    mocks.appService.createDir = mocks.createDir;
    mocks.appService.writeFile = mocks.writeFile;
    mocks.appService.readFile = mocks.readFile;
    mocks.readFile.mockResolvedValue(new ArrayBuffer(1));
    mocks.loadEntry.mockReset();
    mocks.loadOccurrences.mockReset();
    mocks.updateEntry.mockReset();
    mocks.getDictionaryService.mockReset();
    mocks.getDictionaryService.mockResolvedValue(mockService);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the literary card without visible field labels or a global edit button', async () => {
    render(<DictionaryDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Serendipia' })).toBeTruthy();
    expect(screen.getByText('Definición inicial')).toBeTruthy();
    expect(screen.getByLabelText('Imagen actual')).toBeTruthy();
    expect(screen.queryByText('Definición')).toBeNull();
    expect(screen.queryByText('Cita')).toBeNull();
    expect(screen.queryByText('Curiosidad')).toBeNull();
    expect(screen.queryByText('Imagen')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByLabelText('Editar definición')).toBeTruthy();
    expect(screen.queryByTestId('definition-edit-toggle')).toBeNull();
    expect(screen.queryByLabelText('Editar curiosidad')).toBeNull();
    expect(screen.queryByTestId('curiosity-edit-toggle')).toBeNull();
  });

  it('renders a complete quote from context with highlighted selected text', async () => {
    render(<DictionaryDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Serendipia' })).toBeTruthy();
    const quote = screen.getByTestId('dictionary-quote-text');
    expect(quote.textContent).toBe('Antes de la palabra serendipia después de la palabra');
    expect(screen.getByText('serendipia').tagName).toBe('MARK');
    expect(screen.getByText('serendipia').getAttribute('class')).toContain('font-semibold');
    expect(screen.getByText('~ "El libro de los casos"')).toBeTruthy();
  });

  it('renders only the sentence containing the word when context spans multiple sentences', async () => {
    mockOccurrencesByEntryId = {
      'entry-1': [
        makeOccurrence({
          selectedText: 'serendipia',
          contextBefore: 'Llovía fuerte. El sol salió y',
          contextAfter: 'llenó el aire. Los pájaros cantaban.',
        }),
      ],
    };

    render(<DictionaryDetailPage />);

    const quote = await screen.findByTestId('dictionary-quote-text');
    // Only the sentence containing the word is shown, not the surrounding ones
    expect(quote.textContent).toBe('El sol salió y serendipia llenó el aire.');
    expect(quote.textContent).not.toContain('Llovía fuerte');
    expect(quote.textContent).not.toContain('Los pájaros cantaban');
    expect(screen.getByText('serendipia').tagName).toBe('MARK');
  });

  it('shows the book author in the quote source when available', async () => {
    mockOccurrencesByEntryId = {
      'entry-1': [makeOccurrence({ bookAuthor: 'Autora de prueba' })],
    };

    render(<DictionaryDetailPage />);

    expect(await screen.findByText('~ "El libro de los casos" de Autora de prueba')).toBeTruthy();
  });

  it('keeps the definition editable inline without rendering a toggle', async () => {
    render(<DictionaryDetailPage />);

    expect(await screen.findByText('Definición inicial')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Editar definición' })).toBeTruthy();
    expect(screen.queryByTestId('definition-edit-toggle')).toBeNull();
  });

  it('persists the definition when the inline field loses focus', async () => {
    render(<DictionaryDetailPage />);

    expect(await screen.findByText('Definición inicial')).toBeTruthy();
    const definitionEditor = screen.getByRole('textbox', { name: 'Editar definición' });
    definitionEditor.textContent = 'Nueva definición';
    fireEvent.input(definitionEditor);
    fireEvent.blur(definitionEditor);

    await waitFor(() =>
      expect(mocks.updateEntry).toHaveBeenCalledWith(
        {
          id: 'entry-1',
          definition: 'Nueva definición',
          imagePath: 'Dictionaries/entry-1.png',
        },
        mockService,
      ),
    );
    expect(screen.getByText('Nueva definición')).toBeTruthy();
  });

  it('does not render curiosity editing controls alongside the inline definition editor', async () => {
    render(<DictionaryDetailPage />);

    await screen.findByRole('textbox', { name: 'Editar definición' });
    expect(screen.getByRole('textbox', { name: 'Editar definición' })).toBeTruthy();
    expect(screen.queryByLabelText('Editar curiosidad')).toBeNull();
    expect(screen.queryByTestId('definition-edit-toggle')).toBeNull();
    expect(screen.queryByTestId('curiosity-edit-toggle')).toBeNull();
  });

  it('keeps the field editable and shows an error when blur save fails', async () => {
    mocks.updateEntry.mockRejectedValueOnce(new Error('No se pudo guardar'));
    render(<DictionaryDetailPage />);

    await screen.findByRole('textbox', { name: 'Editar definición' });
    const definitionEditor = screen.getByRole('textbox', { name: 'Editar definición' });
    definitionEditor.textContent = 'Definición que falla';
    fireEvent.input(definitionEditor);
    fireEvent.blur(definitionEditor);

    await waitFor(() => expect(mocks.updateEntry).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: 'Editar definición' })).toBeTruthy();
    expect(screen.getByText('No se pudo guardar')).toBeTruthy();
  });

  it('clicks the image card to open the hidden file input and persists imagePath', async () => {
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');

    render(<DictionaryDetailPage />);

    fireEvent.click(await screen.findByLabelText('Imagen actual'));

    expect(inputClickSpy).toHaveBeenCalled();
    expect(screen.getByLabelText('Cambiar imagen').getAttribute('type')).toBe('file');
    expect(screen.getByLabelText('Cambiar imagen').getAttribute('accept')).toBe('image/*');
    fireEvent.change(screen.getByLabelText('Cambiar imagen'), {
      target: { files: [new File(['image-bytes'], 'cover.jpg', { type: 'image/jpeg' })] },
    });

    await waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
    expect(screen.queryByDisplayValue('Dictionaries/entry-1-new.png')).toBeNull();
    expect(mocks.createDir).toHaveBeenCalledWith('entries/entry-1', 'Dictionaries', true);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      'entries/entry-1/image.jpg',
      'Dictionaries',
      expect.any(ArrayBuffer),
    );
    expect(mocks.updateEntry).toHaveBeenCalledWith(
      {
        id: 'entry-1',
        definition: 'Definición inicial',
        imagePath: 'entries/entry-1/image.jpg',
      },
      mockService,
    );

    inputClickSpy.mockRestore();
  });

  it('clicks the quote card to go to the quote CFI and return to the reader when the book is already open', async () => {
    mockViewStates = { 'book-hash-main': { view: { goTo: mocks.goTo } } };

    render(<DictionaryDetailPage />);
    fireEvent.click(await screen.findByTestId('dictionary-quote-card'));

    expect(mocks.goTo).toHaveBeenCalledWith('/6/2!/4/2');
    expect(mocks.push).toHaveBeenCalledWith(
      '/reader?cfi=%2F6%2F2%21%2F4%2F2&ids=book-hash',
      undefined,
    );
  });

  describe('Paste image (mouse hover + Ctrl+V)', () => {
    // Increase timeout for paste tests which involve async file operations
    // through the component's saveImageFromFile → file.arrayBuffer() chain.
    vi.setConfig({ testTimeout: 15000, hookTimeout: 15000 });
    type PasteEventWithClipboard = Event & {
      clipboardData: {
        items: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
      };
    };

    // Build a synthetic ClipboardEvent with a fake clipboardData.items list.
    // jsdom's real `paste` event has no useful clipboard data, so we attach
    // a shim that mimics the real DataTransferItemList contract used here.
    function buildPasteEventWithItem(item: {
      kind: string;
      type: string;
      file: File | null;
    }): PasteEventWithClipboard {
      const event = new Event('paste', {
        bubbles: true,
        cancelable: true,
      }) as PasteEventWithClipboard;
      event.clipboardData = {
        items: [
          {
            kind: item.kind,
            type: item.type,
            getAsFile: () => item.file,
          },
        ],
      };
      vi.spyOn(event, 'preventDefault');
      return event;
    }

    // The paste listener is attached at the document level (because Chromium
    // does not fire paste on non-editable elements like `<button>`), and is
    // gated on hover state tracked via mouseenter/mouseleave on the button.
    // Tests need to fire both: the mouseenter to set hover state, then the
    // paste. Without the hover, the paste is ignored even if the clipboard
    // has an image — this is what lets the user still paste text into the
    // contenteditable definition below.
    async function hoverImageArea() {
      const button = await screen.findByTestId('dictionary-image-area');
      fireEvent.mouseEnter(button);
    }

    it('writes a pasted image to disk and updates the entry imagePath while hovering', async () => {
      const imageFile = new File(['png-bytes'], 'pasted.png', { type: 'image/png' });
      imageFile.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: imageFile,
      });

      render(<DictionaryDetailPage />);
      // Wait for both the service AND the image to load before hovering.
      // The image loading effect (readFile → setImageUrl) triggers a re-render
      // after the component fully mounts. Without this wait, the paste can fire
      // during the async state-settle window, causing `service` (captured in the
      // useCallback closure) to still be null when saveImageFromFile runs.
      await waitFor(() =>
        expect(screen.getByTestId('dictionary-image-area').getAttribute('aria-label')).toBe(
          'Imagen actual',
        ),
      );
      await hoverImageArea();
      fireEvent(document.body, pasteEvent);

      // Should preventDefault to stop the browser from pasting the file's
      // text representation into the definition editor or anywhere else
      expect(pasteEvent.preventDefault).toHaveBeenCalled();

      await waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
      expect(mocks.createDir).toHaveBeenCalledWith('entries/entry-1', 'Dictionaries', true);
      expect(mocks.writeFile).toHaveBeenCalledWith(
        'entries/entry-1/image.png',
        'Dictionaries',
        expect.any(ArrayBuffer),
      );
      expect(mocks.updateEntry).toHaveBeenCalledWith(
        {
          id: 'entry-1',
          definition: 'Definición inicial',
          imagePath: 'entries/entry-1/image.png',
        },
        mockService,
      );
    });

    it('does NOT paste an image when the user is NOT hovering the change-image area', async () => {
      const imageFile = new File(['png-bytes'], 'pasted.png', { type: 'image/png' });
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: imageFile,
      });

      render(<DictionaryDetailPage />);
      // No hover step on purpose
      fireEvent(document.body, pasteEvent);

      // Nothing should have been written or updated
      expect(mocks.writeFile).not.toHaveBeenCalled();
      expect(mocks.updateEntry).not.toHaveBeenCalled();
    });

    it('does NOT intercept text pastes in the contenteditable definition', async () => {
      const pasteEvent = buildPasteEventWithItem({
        kind: 'string',
        type: 'text/plain',
        file: null,
      });

      render(<DictionaryDetailPage />);
      await hoverImageArea();

      // Fire the paste on the definition editor (its natural target). Our
      // handler must NOT preventDefault so the default text-paste behavior
      // is preserved when the user is editing the definition.
      const definitionEditor = await screen.findByRole('textbox', { name: 'Editar definición' });
      fireEvent(definitionEditor, pasteEvent);

      expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
      expect(mocks.writeFile).not.toHaveBeenCalled();
      expect(mocks.updateEntry).not.toHaveBeenCalled();
    });

    it('uses a sensible default name when the pasted file has none', async () => {
      const namelessFile = new File(['png-bytes'], '', { type: 'image/png' });
      Object.defineProperty(namelessFile, 'arrayBuffer', {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: namelessFile,
      });

      render(<DictionaryDetailPage />);
      // Wait for both the service AND the image to load before hovering.
      // The image loading effect (readFile → setImageUrl) triggers a re-render
      // after the component fully mounts. Without this wait, the paste can fire
      // during the async state-settle window, causing `service` (captured in the
      // useCallback closure) to still be null when saveImageFromFile runs.
      await waitFor(() =>
        expect(screen.getByTestId('dictionary-image-area').getAttribute('aria-label')).toBe(
          'Imagen actual',
        ),
      );
      await hoverImageArea();
      fireEvent(document.body, pasteEvent);

      await waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
      // Default name → image.png on disk
      expect(mocks.writeFile).toHaveBeenCalledWith(
        'entries/entry-1/image.png',
        'Dictionaries',
        expect.any(ArrayBuffer),
      );
    });
  });
});
