import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotacion } from '@/types/annotaciones';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  navigateToReader: vi.fn(),
  toggleSelect: vi.fn(),
}));

let mockIsSelectMode = false;
let mockSelectedAnnotationIds: string[] = [];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/utils/nav', () => ({
  navigateToReader: mocks.navigateToReader,
}));

vi.mock('@/store/annotacionesStore', () => ({
  useAnotacionesStore: (selector: (state: unknown) => unknown) =>
    selector({
      isSelectMode: mockIsSelectMode,
      selectedAnnotationIds: mockSelectedAnnotationIds,
      toggleSelect: mocks.toggleSelect,
    }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace('{{text}}', options?.['text'] ?? ''),
}));

import AnotacionTile from '@/app/annotaciones/AnotacionTile';

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

describe('AnotacionTile', () => {
  beforeEach(() => {
    mockIsSelectMode = false;
    mockSelectedAnnotationIds = [];
    mocks.push.mockReset();
    mocks.navigateToReader.mockReset();
    mocks.toggleSelect.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the annotation text as a blockquote', () => {
    render(<AnotacionTile annotation={makeAnnotation()} />);

    expect(
      screen.getByText('El Aleph es un punto en el espacio que contiene todos los puntos.'),
    ).toBeTruthy();
  });

  it('renders the user note when present', () => {
    render(<AnotacionTile annotation={makeAnnotation()} />);

    expect(screen.getByText(/Una reflexion sobre el infinito/)).toBeTruthy();
  });

  it('renders book title and author metadata', () => {
    render(<AnotacionTile annotation={makeAnnotation()} />);

    expect(screen.getByText('Ficciones ~ Borges')).toBeTruthy();
  });

  it('renders page number when present', () => {
    render(<AnotacionTile annotation={makeAnnotation()} />);

    expect(screen.getByText(/p\.\s*42/)).toBeTruthy();
  });

  it('navigates to the reader with CFI on click', () => {
    render(<AnotacionTile annotation={makeAnnotation()} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Annotation: El Aleph es un punto en el espacio que contiene todos los puntos.',
      }),
    );

    expect(mocks.navigateToReader).toHaveBeenCalledWith(
      { push: mocks.push },
      ['book-1'],
      'cfi=epubcfi(%2F6%2F2)',
    );
  });

  it('toggles selection in select mode', () => {
    mockIsSelectMode = true;

    render(<AnotacionTile annotation={makeAnnotation()} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Annotation: El Aleph es un punto en el espacio que contiene todos los puntos.',
      }),
    );

    expect(mocks.toggleSelect).toHaveBeenCalledWith('annot-1');
    expect(mocks.navigateToReader).not.toHaveBeenCalled();
  });

  it('shows Selected badge when annotation is selected', () => {
    mockIsSelectMode = true;
    mockSelectedAnnotationIds = ['annot-1'];

    render(<AnotacionTile annotation={makeAnnotation()} />);

    expect(screen.getByText('Selected')).toBeTruthy();
  });

  it('adds anotaciones-pulse class when isHighlighted is true', () => {
    const { container } = render(<AnotacionTile annotation={makeAnnotation()} isHighlighted />);

    const tile = container.firstChild as HTMLElement;
    expect(tile.className).toContain('anotaciones-pulse');
  });

  it('does not add anotaciones-pulse when isHighlighted is false', () => {
    const { container } = render(<AnotacionTile annotation={makeAnnotation()} />);

    const tile = container.firstChild as HTMLElement;
    expect(tile.className).not.toContain('anotaciones-pulse');
  });

  it('renders with id attribute on the outer element', () => {
    const { container } = render(
      <AnotacionTile annotation={makeAnnotation({ id: 'annot-test-id' })} />,
    );

    const tile = container.firstChild as HTMLElement;
    expect(tile.getAttribute('id')).toBe('annot-test-id');
  });

  it('handles missing note gracefully', () => {
    render(<AnotacionTile annotation={makeAnnotation({ note: '' })} />);

    expect(
      screen.getByText('El Aleph es un punto en el espacio que contiene todos los puntos.'),
    ).toBeTruthy();
  });

  it('renders with a color indicator on the tile', () => {
    const { container } = render(
      <AnotacionTile annotation={makeAnnotation({ color: '#ff0000' })} />,
    );

    expect(container.querySelector('[style*="background-color: rgb(255, 0, 0)"]')).toBeTruthy();
  });
});
