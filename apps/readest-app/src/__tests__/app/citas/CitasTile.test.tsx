import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cite } from '@/types/citas';

const mocks = vi.hoisted(() => ({
  toggleSelectedQuote: vi.fn(),
}));

let mockIsSelectMode = false;
let mockSelectedQuoteIds: string[] = [];

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

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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
    mocks.toggleSelectedQuote.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders quote text with book metadata and an accessible label in default mode', () => {
    render(<CitasTile quote={makeQuote()} />);

    const tile = screen.getByRole('link', { name: 'Quote: El universo es una vasta biblioteca.' });
    expect(tile.getAttribute('href')).toBe('/citas');
    expect(screen.getByText('El universo es una vasta biblioteca.')).toBeTruthy();
    expect(screen.getByText('— Borges')).toBeTruthy();
    expect(screen.getByText('Ficciones')).toBeTruthy();
  });

  it('does not navigate to a source book CFI in Phase 1 default mode', () => {
    render(<CitasTile quote={makeQuote()} />);

    const tile = screen.getByRole('link', { name: 'Quote: El universo es una vasta biblioteca.' });
    expect(tile.getAttribute('href')).toBe('/citas');
    expect(tile.getAttribute('href')).not.toContain('/reader');
    expect(tile.getAttribute('href')).not.toContain('epubcfi');
  });

  it('toggles the quote selection from select mode instead of rendering a link', () => {
    mockIsSelectMode = true;

    render(<CitasTile quote={makeQuote()} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Quote: El universo es una vasta biblioteca.' }),
    );

    expect(mocks.toggleSelectedQuote).toHaveBeenCalledWith('cite-1');
    expect(screen.queryByRole('link')).toBeNull();
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
});
