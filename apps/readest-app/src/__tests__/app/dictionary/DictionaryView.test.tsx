import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';

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
  loadEntry: typeof mocks.loadEntry;
  loadOccurrences: typeof mocks.loadOccurrences;
  updateEntry: typeof mocks.updateEntry;
  toggleSelectedEntry: typeof mocks.toggleSelectedEntry;
  addEntry: typeof mocks.addEntry;
  enterSelectMode: typeof mocks.enterSelectMode;
  cancelSelectMode: typeof mocks.cancelSelectMode;
  deleteSelectedEntries: typeof mocks.deleteSelectedEntries;
}

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'entry-1' }),
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
      loadEntry: mocks.loadEntry,
      loadOccurrences: mocks.loadOccurrences,
      updateEntry: mocks.updateEntry,
      toggleSelectedEntry: mocks.toggleSelectedEntry,
      addEntry: mocks.addEntry,
      enterSelectMode: mocks.enterSelectMode,
      cancelSelectMode: mocks.cancelSelectMode,
      deleteSelectedEntries: mocks.deleteSelectedEntries,
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
import DictionaryDetailPage from '@/app/dictionary/[id]/page';
import DictionaryPage from '@/app/dictionary/page';

const mockService = {
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
    vi.mocked(mockService.listOccurrences).mockResolvedValue([]);
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
      '/dictionary/entry-1',
    );
    expect(screen.getByRole('link', { name: /efímero/i }).getAttribute('href')).toBe(
      '/dictionary/entry-2',
    );
  });

  it('filters tiles by word and definition', () => {
    mockEntries = [
      makeEntry({ id: 'entry-1', displayTerm: 'serendipia', definition: 'Hallazgo afortunado' }),
      makeEntry({ id: 'entry-2', displayTerm: 'efímero', definition: 'Dura poco' }),
    ];

    render(<DictionaryGrid service={mockService} />);
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'afortunado' } });

    expect(screen.getByRole('link', { name: /serendipia/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /efímero/i })).toBeNull();
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

    render(<DictionaryGrid service={mockService} />);
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'xyzzy' } });

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

  it('preserves search and filter behavior alongside toolbar actions', () => {
    mockEntries = [
      makeEntry({ id: 'entry-1', displayTerm: 'serendipia', definition: 'Hallazgo afortunado' }),
      makeEntry({ id: 'entry-2', displayTerm: 'efímero', definition: 'Dura poco' }),
    ];

    render(<DictionaryGrid service={mockService} />);

    // Toolbar actions are present
    expect(screen.getByRole('button', { name: 'Añadir palabra' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seleccionar' })).toBeTruthy();

    // Search still works
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'afortunado' } });
    expect(screen.getByRole('link', { name: /serendipia/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /efímero/i })).toBeNull();
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
});

describe('DictionaryPage', () => {
  beforeEach(() => {
    mockEntries = [];
    mockEntry = null;
    mockOccurrencesByEntryId = {};
    mockIsLoading = false;
    mocks.loadEntries.mockReset();
    mocks.getDictionaryService.mockReset();
    mocks.back.mockReset();
    mocks.replace.mockReset();
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
});
