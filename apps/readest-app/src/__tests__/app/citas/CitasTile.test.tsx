import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cite } from '@/types/citas';

const mocks = vi.hoisted(() => ({
  goTo: vi.fn(),
  push: vi.fn(),
  setPreviewMode: vi.fn(),
  navigateToReader: vi.fn(),
  toggleSelectedQuote: vi.fn(),
}));

let mockIsSelectMode = false;
let mockSelectedQuoteIds: string[] = [];
let mockViewStates: Record<string, { view?: { goTo: (cfi: string) => void } }> = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      viewStates: mockViewStates,
      setPreviewMode: mocks.setPreviewMode,
    }),
  },
}));

vi.mock('@/utils/nav', () => ({
  navigateToReader: mocks.navigateToReader,
}));

vi.mock('@/store/citasStore', () => ({
  useCitasStore: (selector: (state: unknown) => unknown) =>
    selector({
      isSelectMode: mockIsSelectMode,
      selectedQuoteIds: mockSelectedQuoteIds,
      toggleSelectedQuote: mocks.toggleSelectedQuote,
    }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace('{{text}}', options?.['text'] ?? ''),
}));

import CitasTile from '@/app/citas/CitasTile';

function makeQuote(overrides: Partial<Cite> = {}): Cite {
  return {
    id: 'cite-1',
    bookHash: 'book-1',
    bookTitle: 'Ficciones',
    bookAuthor: 'Borges',
    cfi: 'epubcfi(/6/2)',
    sectionHref: 'chapter-1.xhtml',
    page: 12,
    text: 'El universo es una vasta biblioteca.',
    contextBefore: null,
    contextAfter: null,
    contentHash: 'hash-1',
    createdAt: 1,
    updatedAt: null,
    ...overrides,
  };
}

describe('CitasTile', () => {
  beforeEach(() => {
    mockIsSelectMode = false;
    mockSelectedQuoteIds = [];
    mockViewStates = {};
    mocks.goTo.mockReset();
    mocks.push.mockReset();
    mocks.setPreviewMode.mockReset();
    mocks.navigateToReader.mockReset();
    mocks.toggleSelectedQuote.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the full quote text and exact title-author metadata in default mode', () => {
    const longText =
      'El universo es una vasta biblioteca compuesta de galerías hexagonales que no debe quedar cortada ni escondida en una tarjeta cuadrada.';

    render(<CitasTile quote={makeQuote({ text: longText })} />);

    expect(screen.getByRole('button', { name: `Quote: ${longText}` })).toBeTruthy();
    expect(screen.getByText(longText)).toBeTruthy();
    expect(screen.getByText('Ficciones ~ Borges')).toBeTruthy();
  });

  it('does not apply truncation classes to the quote text or metadata', () => {
    const { container } = render(<CitasTile quote={makeQuote()} />);

    const renderedClasses = container.innerHTML;
    expect(renderedClasses).not.toContain('line-clamp');
    expect(renderedClasses).not.toContain('truncate');
  });

  it('navigates to the source book CFI and previews an already-open reader view', () => {
    mockViewStates = { 'book-1-main': { view: { goTo: mocks.goTo } } };

    render(<CitasTile quote={makeQuote()} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Quote: El universo es una vasta biblioteca.' }),
    );

    expect(mocks.goTo).toHaveBeenCalledWith('epubcfi(/6/2)');
    expect(mocks.setPreviewMode).toHaveBeenCalledWith('book-1-main', true);
    expect(mocks.navigateToReader).toHaveBeenCalledWith(
      { push: mocks.push },
      ['book-1'],
      'cfi=epubcfi(%2F6%2F2)',
    );
  });

  it('marks missing-CFI quotes disabled and keeps activation a no-op', () => {
    render(<CitasTile quote={makeQuote({ cfi: null })} />);

    const tile = screen.getByRole('button', {
      name: 'Quote unavailable: El universo es una vasta biblioteca.',
    });
    expect((tile as HTMLButtonElement).disabled).toBe(true);
    expect(tile.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(tile);

    expect(mocks.goTo).not.toHaveBeenCalled();
    expect(mocks.navigateToReader).not.toHaveBeenCalled();
  });

  it('toggles the quote selection from select mode instead of rendering a link', () => {
    mockIsSelectMode = true;

    render(<CitasTile quote={makeQuote()} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Quote: El universo es una vasta biblioteca.' }),
    );

    expect(mocks.toggleSelectedQuote).toHaveBeenCalledWith('cite-1');
    expect(mocks.navigateToReader).not.toHaveBeenCalled();
  });

  it('announces selected quotes as pressed in select mode', () => {
    mockIsSelectMode = true;
    mockSelectedQuoteIds = ['cite-1'];

    render(<CitasTile quote={makeQuote()} />);

    const tile = screen.getByRole('button', {
      name: 'Deselect Quote: El universo es una vasta biblioteca.',
    });
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Selected')).toBeTruthy();
  });

  it('adds the citas-pulse class when isHighlighted is true', () => {
    const { container } = render(<CitasTile quote={makeQuote()} isHighlighted />);
    const tile = container.firstChild as HTMLElement;
    expect(tile.className).toContain('citas-pulse');
  });

  it('does not add the citas-pulse class when isHighlighted is false or undefined', () => {
    const { container: undefContainer } = render(<CitasTile quote={makeQuote()} />);
    const undefinedTile = undefContainer.firstChild as HTMLElement;
    expect(undefinedTile.className).not.toContain('citas-pulse');

    const { container: falseContainer } = render(
      <CitasTile quote={makeQuote()} isHighlighted={false} />,
    );
    const falseTile = falseContainer.firstChild as HTMLElement;
    expect(falseTile.className).not.toContain('citas-pulse');
  });

  it('renders with id attribute on the outer element', () => {
    const { container } = render(<CitasTile quote={makeQuote({ id: 'cite-test-id' })} />);
    const tile = container.firstChild as HTMLElement;
    expect(tile.getAttribute('id')).toBe('cite-test-id');
  });
});
