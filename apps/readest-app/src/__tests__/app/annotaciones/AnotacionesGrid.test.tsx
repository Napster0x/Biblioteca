import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import type { Annotacion } from '@/types/annotaciones';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  loadAnnotations: vi.fn(),
  searchAnnotations: vi.fn(),
  deleteAnnotations: vi.fn(),
  removeAnnotationsFromState: vi.fn(),
  setSearchQuery: vi.fn(),
  toggleSelect: vi.fn(),
  enterSelectMode: vi.fn(),
  exitSelectMode: vi.fn(),
  selectAll: vi.fn(),
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
  appService: { platform: 'test' },
  envConfig: {},
  settings: { animated: false },
}));

let mockAnnotations: Annotacion[] = [];
let mockIsLoading = false;
let mockIsSelectMode = false;
let mockSelectedAnnotationIds: string[] = [];
let mockSearchQuery = '';

interface MockAnotacionesStoreState {
  annotations: Annotacion[];
  isLoading: boolean;
  isSelectMode: boolean;
  selectedAnnotationIds: string[];
  searchQuery: string;
  loadAnnotations: typeof mocks.loadAnnotations;
  searchAnnotations: typeof mocks.searchAnnotations;
  deleteAnnotations: typeof mocks.deleteAnnotations;
  removeAnnotationsFromState: typeof mocks.removeAnnotationsFromState;
  setSearchQuery: typeof mocks.setSearchQuery;
  toggleSelect: typeof mocks.toggleSelect;
  enterSelectMode: typeof mocks.enterSelectMode;
  exitSelectMode: typeof mocks.exitSelectMode;
  selectAll: typeof mocks.selectAll;
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mocks.back, push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: mocks.settings }),
}));

vi.mock('@/store/annotacionesStore', () => ({
  useAnotacionesStore: (selector: (s: MockAnotacionesStoreState) => unknown) =>
    selector({
      annotations: mockAnnotations,
      isLoading: mockIsLoading,
      isSelectMode: mockIsSelectMode,
      selectedAnnotationIds: mockSelectedAnnotationIds,
      searchQuery: mockSearchQuery,
      loadAnnotations: mocks.loadAnnotations,
      searchAnnotations: mocks.searchAnnotations,
      deleteAnnotations: mocks.deleteAnnotations,
      removeAnnotationsFromState: mocks.removeAnnotationsFromState,
      setSearchQuery: mocks.setSearchQuery,
      toggleSelect: mocks.toggleSelect,
      enterSelectMode: mocks.enterSelectMode,
      exitSelectMode: mocks.exitSelectMode,
      selectAll: mocks.selectAll,
    }),
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: mocks.navigateToLibrary,
  navigateToReader: mocks.navigateToReader,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace('{{count}}', options?.['count'] ?? ''),
}));

import AnotacionesGrid from '@/app/annotaciones/AnotacionesGrid';

const mockService = {} as AnotacionesService;

function makeAnnotation(overrides: Partial<Annotacion> = {}): Annotacion {
  return {
    id: 'annot-1',
    bookHash: 'book-1',
    bookTitle: 'Ficciones',
    bookAuthor: 'Borges',
    cfi: 'epubcfi(/6/2)',
    sectionHref: 'chapter-1.xhtml',
    page: 42,
    text: 'El Aleph es un punto en el espacio que contiene todos los puntos.',
    note: 'Una reflexion sobre el infinito.',
    style: 'highlight',
    color: '#ffff00',
    createdAt: 1,
    updatedAt: null,
    ...overrides,
  };
}

describe('AnotacionesGrid', () => {
  beforeEach(() => {
    mockAnnotations = [];
    mockIsLoading = false;
    mockIsSelectMode = false;
    mockSelectedAnnotationIds = [];
    mockSearchQuery = '';
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.back.mockReset();
    mocks.loadAnnotations.mockReset();
    mocks.searchAnnotations.mockReset();
    mocks.deleteAnnotations.mockReset();
    mocks.removeAnnotationsFromState.mockReset();
    mocks.setSearchQuery.mockReset();
    mocks.toggleSelect.mockReset();
    mocks.enterSelectMode.mockReset();
    mocks.exitSelectMode.mockReset();
    mocks.navigateToLibrary.mockReset();
    mocks.navigateToReader.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the header and search input on mount', () => {
    render(<AnotacionesGrid service={mockService} />);

    expect(screen.getByRole('heading', { name: 'Anotaciones' })).toBeTruthy();
    expect(screen.getByLabelText('Search')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search…')).toBeTruthy();
  });

  it('loads annotations on mount', () => {
    render(<AnotacionesGrid service={mockService} />);

    expect(mocks.loadAnnotations).toHaveBeenCalledWith(mockService);
  });

  it('renders the empty state when there are no annotations', () => {
    render(<AnotacionesGrid service={mockService} />);

    expect(screen.getByText('No annotations yet')).toBeTruthy();
  });

  it('renders annotations as tiles', () => {
    mockAnnotations = [makeAnnotation()];

    render(<AnotacionesGrid service={mockService} />);

    expect(
      screen.getByText('El Aleph es un punto en el espacio que contiene todos los puntos.'),
    ).toBeTruthy();
  });

  it('filters annotations by search query client-side', () => {
    mockAnnotations = [
      makeAnnotation({ id: 'annot-1', text: 'Biblioteca de Babel', bookAuthor: 'Borges' }),
      makeAnnotation({ id: 'annot-2', text: 'El jardin de senderos', bookAuthor: 'Bioy' }),
    ];

    render(<AnotacionesGrid service={mockService} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Borges' } });

    expect(screen.getByText('Biblioteca de Babel')).toBeTruthy();
    expect(screen.queryByText('El jardin de senderos')).toBeNull();
  });

  it('shows select mode button', () => {
    render(<AnotacionesGrid service={mockService} />);

    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
  });

  it('enters select mode when Select button is clicked', () => {
    render(<AnotacionesGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    expect(mocks.enterSelectMode).toHaveBeenCalled();
  });

  it('shows batch delete bar in select mode', () => {
    mockIsSelectMode = true;

    render(<AnotacionesGrid service={mockService} />);

    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('disables Delete button when nothing is selected in select mode', () => {
    mockIsSelectMode = true;
    mockSelectedAnnotationIds = [];

    render(<AnotacionesGrid service={mockService} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete selected' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Delete button when items are selected', () => {
    mockIsSelectMode = true;
    mockSelectedAnnotationIds = ['annot-1'];

    render(<AnotacionesGrid service={mockService} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete selected' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows confirm dialog before batch delete', () => {
    mockIsSelectMode = true;
    mockSelectedAnnotationIds = ['annot-1'];

    render(<AnotacionesGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));

    expect(screen.getByRole('dialog', { name: 'Delete selected' })).toBeTruthy();
  });

  it('calls exitSelectMode when Cancel in bottom bar is clicked', () => {
    mockIsSelectMode = true;

    render(<AnotacionesGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.exitSelectMode).toHaveBeenCalled();
  });

  it('calls deleteAnnotations on confirm delete', async () => {
    mockAnnotations = [makeAnnotation()];
    mockIsSelectMode = true;
    mockSelectedAnnotationIds = ['annot-1'];

    render(<AnotacionesGrid service={mockService} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mocks.deleteAnnotations).toHaveBeenCalledWith(['annot-1'], mockService);
      expect(mocks.exitSelectMode).toHaveBeenCalled();
    });
  });

  it('renders empty search results message when search yields no matches', () => {
    mockAnnotations = [makeAnnotation()];

    render(<AnotacionesGrid service={mockService} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Nonexistent' } });

    expect(screen.getByText('No results found')).toBeTruthy();
  });
});
