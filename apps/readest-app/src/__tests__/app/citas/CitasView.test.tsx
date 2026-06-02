import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitasService } from '@/services/citas/CitasService';
import type { Cite } from '@/types/citas';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  loadQuotes: vi.fn(),
  searchQuotes: vi.fn(),
  createQuote: vi.fn(),
  updateQuote: vi.fn(),
  deleteQuotes: vi.fn(),
  enterSelectMode: vi.fn(),
  cancelSelectMode: vi.fn(),
  toggleSelectedQuote: vi.fn(),
  getCitasService: vi.fn(),
  appService: { platform: 'test' },
}));

let mockQuotes: Cite[] = [];
let mockIsLoading = false;
let mockIsSelectMode = false;
let mockSelectedQuoteIds: string[] = [];

interface MockCitasStoreState {
  quotes: Cite[];
  isLoading: boolean;
  isSelectMode: boolean;
  selectedQuoteIds: string[];
  loadQuotes: typeof mocks.loadQuotes;
  searchQuotes: typeof mocks.searchQuotes;
  createQuote: typeof mocks.createQuote;
  updateQuote: typeof mocks.updateQuote;
  deleteQuotes: typeof mocks.deleteQuotes;
  enterSelectMode: typeof mocks.enterSelectMode;
  cancelSelectMode: typeof mocks.cancelSelectMode;
  toggleSelectedQuote: typeof mocks.toggleSelectedQuote;
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mocks.back, push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.appService }),
}));

vi.mock('@/services/citas/citasServiceCache', () => ({
  getCitasService: mocks.getCitasService,
}));

vi.mock('@/store/citasStore', () => ({
  useCitasStore: (selector: (s: MockCitasStoreState) => unknown) =>
    selector({
      quotes: mockQuotes,
      isLoading: mockIsLoading,
      isSelectMode: mockIsSelectMode,
      selectedQuoteIds: mockSelectedQuoteIds,
      loadQuotes: mocks.loadQuotes,
      searchQuotes: mocks.searchQuotes,
      createQuote: mocks.createQuote,
      updateQuote: mocks.updateQuote,
      deleteQuotes: mocks.deleteQuotes,
      enterSelectMode: mocks.enterSelectMode,
      cancelSelectMode: mocks.cancelSelectMode,
      toggleSelectedQuote: mocks.toggleSelectedQuote,
    }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace('{{text}}', options?.['text'] ?? ''),
}));

import CitasGrid from '@/app/citas/CitasGrid';
import CitasPage from '@/app/citas/page';

const mockService = {} as CitasService;

function makeQuote(overrides: Partial<Cite> = {}): Cite {
  return {
    id: 'cite-1',
    bookHash: 'book-1',
    bookTitle: 'Ficciones',
    bookAuthor: 'Borges',
    cfi: null,
    sectionHref: null,
    page: null,
    text: 'El universo es una vasta biblioteca.',
    contextBefore: null,
    contextAfter: null,
    contentHash: 'hash-1',
    createdAt: 1,
    updatedAt: null,
    ...overrides,
  };
}

describe('CitasGrid', () => {
  beforeEach(() => {
    mockQuotes = [];
    mockIsLoading = false;
    mockIsSelectMode = false;
    mockSelectedQuoteIds = [];
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.back.mockReset();
    mocks.loadQuotes.mockReset();
    mocks.searchQuotes.mockReset();
    mocks.createQuote.mockReset();
    mocks.updateQuote.mockReset();
    mocks.deleteQuotes.mockReset();
    mocks.enterSelectMode.mockReset();
    mocks.cancelSelectMode.mockReset();
    mocks.toggleSelectedQuote.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Citas header, the search input, and the Select button on mount', () => {
    render(<CitasGrid service={mockService} />);

    expect(screen.getByRole('heading', { name: 'Citas' })).toBeTruthy();
    expect(screen.getByLabelText('Search')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
  });

  it('hydrates quotes on mount by calling loadQuotes with the service', () => {
    render(<CitasGrid service={mockService} />);

    expect(mocks.loadQuotes).toHaveBeenCalledWith(mockService);
  });

  it('renders the empty state when the store has no quotes', () => {
    render(<CitasGrid service={mockService} />);

    expect(screen.getByText('Your quotes collection is empty')).toBeTruthy();
    expect(
      screen.getByText('Quotes are created when you save a passage from the reader.'),
    ).toBeTruthy();
  });

  it('does NOT render the Add / Add Word / PiPlus button (citas are created from the reader in Fase 2)', () => {
    render(<CitasGrid service={mockService} />);

    // The dictionary grid renders a button with aria-label "Añadir palabra"
    // (i18n key) backed by the PiPlus icon. Citas Fase 1 has no manual
    // creation flow — the empty page is intentional. The grid must NOT
    // render any "add" / "añadir" action.
    expect(screen.queryByRole('button', { name: /añadir|add word|^add$/i })).toBeNull();
  });

  it('does NOT render the manual add-word modal that the dictionary page has', () => {
    render(<CitasGrid service={mockService} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the search input controlled — typing updates the rendered value', () => {
    render(<CitasGrid service={mockService} />);

    const searchInput = screen.getByLabelText('Search') as HTMLInputElement;
    expect(searchInput.value).toBe('');

    fireEvent.change(searchInput, { target: { value: 'Borges' } });

    expect(searchInput.value).toBe('Borges');
  });

  it('renders loaded quotes as CitasTile cards with accessible quote labels', () => {
    mockQuotes = [makeQuote()];

    render(<CitasGrid service={mockService} />);

    expect(
      screen.getByRole('link', { name: 'Quote: El universo es una vasta biblioteca.' }),
    ).toBeTruthy();
    expect(screen.getByText('El universo es una vasta biblioteca.')).toBeTruthy();
  });

  it('wires CitasTile selection clicks through the citas store in select mode', () => {
    mockQuotes = [makeQuote()];
    mockIsSelectMode = true;

    render(<CitasGrid service={mockService} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Quote: El universo es una vasta biblioteca.' }),
    );

    expect(mocks.toggleSelectedQuote).toHaveBeenCalledWith('cite-1');
  });

  it('searches quotes through the store action when the user types', () => {
    render(<CitasGrid service={mockService} />);

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Borges' } });

    expect(mocks.searchQuotes).toHaveBeenCalledWith('Borges', mockService);
  });

  it('enters select mode and shows the bottom bar with Cancel and disabled Delete when nothing is selected', () => {
    render(<CitasGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    expect(mocks.enterSelectMode).toHaveBeenCalled();
  });

  it('shows a disabled Delete button in the bottom bar when select mode is active but no quotes are selected', () => {
    mockIsSelectMode = true;
    mockSelectedQuoteIds = [];

    render(<CitasGrid service={mockService} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete selected' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('enables the Delete button in the bottom bar when at least one quote is selected', () => {
    mockIsSelectMode = true;
    mockSelectedQuoteIds = ['cite-1'];

    render(<CitasGrid service={mockService} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete selected' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls cancelSelectMode when the bottom-bar Cancel button is clicked', () => {
    mockIsSelectMode = true;
    mockSelectedQuoteIds = ['cite-1'];

    render(<CitasGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.cancelSelectMode).toHaveBeenCalled();
  });

  it('keeps the Add button absent and the dialog absent in select mode too', () => {
    mockIsSelectMode = true;
    mockSelectedQuoteIds = ['cite-1'];

    render(<CitasGrid service={mockService} />);

    // Defense in depth: the absence of the add flow must not depend on
    // select mode being off. The grid must NEVER render an add button.
    expect(screen.queryByRole('button', { name: /añadir|add word|^add$/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('navigates back to the library when the back button is clicked', () => {
    render(<CitasGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }));

    expect(mocks.replace).toHaveBeenCalledWith('/library', undefined);
  });
});

describe('CitasPage', () => {
  beforeEach(() => {
    mockQuotes = [];
    mockIsLoading = false;
    mockIsSelectMode = false;
    mockSelectedQuoteIds = [];
    mocks.loadQuotes.mockReset();
    mocks.getCitasService.mockReset();
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.back.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the error heading and the Retry button when getCitasService rejects', async () => {
    mocks.getCitasService.mockRejectedValue(new Error('database locked'));

    render(<CitasPage />);

    expect(await screen.findByRole('heading', { name: 'Could not open Citas' })).toBeTruthy();
    expect(screen.getByText('database locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('retries opening the citas service when Retry is clicked after a failure', async () => {
    mocks.getCitasService
      .mockRejectedValueOnce(new Error('database locked'))
      .mockResolvedValueOnce(mockService);

    render(<CitasPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(mocks.getCitasService).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Citas' })).toBeTruthy();
  });

  it('renders the initializing message while the service is opening, then swaps to the grid', async () => {
    mocks.getCitasService.mockResolvedValue(mockService);

    render(<CitasPage />);

    expect(screen.getByText('Initializing quotes…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Citas' })).toBeTruthy();
    expect(screen.queryByText('Initializing quotes…')).toBeNull();
  });
});
