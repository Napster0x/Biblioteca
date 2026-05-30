import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { AppService } from '@/types/system';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Replace Popup with a thin shell so tests don't need layout/DOM positioning.
vi.mock('@/components/Popup', () => ({
  default: ({
    children,
    onDismiss,
  }: {
    children: ReactNode;
    isOpen?: boolean;
    position?: unknown;
    trianglePosition?: unknown;
    width: number;
    onDismiss?: () => void;
  }) => (
    <div data-testid='capture-popup' role='dialog'>
      {children}
      <button data-testid='popup-backdrop' onClick={onDismiss} aria-label='backdrop' />
    </div>
  ),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// Mock useFileSelector for the image picker
const mockSelectFiles = vi.fn();
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: mockSelectFiles }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextNode(text: string): Text {
  return document.createTextNode(text);
}

function makeRange(container: Text, startOffset: number, endOffset: number): Range {
  const range = new Range();
  range.setStart(container, startOffset);
  range.setEnd(container, endOffset);
  return range;
}

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import CapturePopup, {
  extractCaptureContext,
} from '@/app/reader/components/annotator/CapturePopup';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const defaultBook = { hash: 'book-1', title: 'Test Book', author: 'Test Author', language: 'en' };

const mockDictionaryService = {
  upsertEntry: vi.fn().mockResolvedValue({ id: 'entry-1' }),
  createOccurrence: vi.fn().mockResolvedValue({ id: 'occurrence-1' }),
  updateEntry: vi.fn().mockResolvedValue({}),
} as unknown as DictionaryService;

const mockAppService = {
  writeFile: vi.fn().mockResolvedValue(undefined),
  createDir: vi.fn().mockResolvedValue(undefined),
} as unknown as AppService;

const mockOnCreateHighlight = vi.fn().mockResolvedValue('highlight-1');

const mockOnDismiss = vi.fn();

const defaultProps = {
  selectedText: 'serendipity',
  range: makeRange(makeTextNode('the word serendipity is great'), 9, 20),
  cfi: 'epubcfi(/6/2!/4/2)',
  page: 12,
  sectionHref: 'chapter.xhtml',
  book: defaultBook,
  position: { dir: 'up' as const, point: { x: 100, y: 200 } },
  trianglePosition: { dir: 'up' as const, point: { x: 150, y: 250 } },
  popupWidth: 480,
  popupHeight: 360,
  appService: mockAppService,
  dictionaryService: mockDictionaryService,
  onCreateHighlight: mockOnCreateHighlight,
  onDismiss: mockOnDismiss,
};

function renderPopup(overrides: Record<string, unknown> = {}) {
  return render(<CapturePopup {...defaultProps} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CapturePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('render', () => {
    it('displays the selected word at the top of the popup', () => {
      renderPopup();
      expect(screen.getByText('serendipity')).toBeTruthy();
    });

    it('renders a definition textarea', () => {
      renderPopup();
      expect(screen.getByPlaceholderText('Write a definition...')).toBeTruthy();
    });

    it('renders Save and Cancel buttons', () => {
      renderPopup();
      expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('renders an image picker button', () => {
      renderPopup();
      expect(screen.getByRole('button', { name: 'Select Image' })).toBeTruthy();
    });
  });

  describe('Cancel', () => {
    it('calls onDismiss and does NOT call service methods when Cancel is clicked', () => {
      renderPopup();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
      expect(mockDictionaryService.upsertEntry).not.toHaveBeenCalled();
      expect(mockDictionaryService.createOccurrence).not.toHaveBeenCalled();
      expect(mockAppService.writeFile).not.toHaveBeenCalled();
      expect(mockOnCreateHighlight).not.toHaveBeenCalled();
    });
  });

  describe('Save — no definition (word only)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('saves without a definition when the textarea is empty', async () => {
      renderPopup();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });

      // Entry upserted without definition
      expect(mockDictionaryService.upsertEntry).toHaveBeenCalledWith({
        term: 'serendipity',
        displayTerm: 'serendipity',
        language: 'en',
        definition: undefined,
      });

      // Occurrence still created
      expect(mockDictionaryService.createOccurrence).toHaveBeenCalled();

      // Image NOT written
      expect(mockAppService.writeFile).not.toHaveBeenCalled();

      // Dismissed
      expect(mockOnDismiss).toHaveBeenCalled();
    });
  });

  describe('Save — happy path (definition only, no image)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls onCreateHighlight, upsertEntry, and createOccurrence when Save is clicked', async () => {
      renderPopup();

      // Type a definition
      const textarea = screen.getByPlaceholderText('Write a definition...') as HTMLTextAreaElement;
      fireEvent.change(textarea, {
        target: { value: 'The occurrence of happy accidents.' },
      });

      // Click Save
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });

      // Should create highlight first
      expect(mockOnCreateHighlight).toHaveBeenCalledWith('epubcfi(/6/2!/4/2)', 'serendipity', 12);

      // Should upsert entry with the definition
      expect(mockDictionaryService.upsertEntry).toHaveBeenCalledWith({
        term: 'serendipity',
        displayTerm: 'serendipity',
        language: 'en',
        definition: 'The occurrence of happy accidents.',
      });

      // Should create occurrence with context
      expect(mockDictionaryService.createOccurrence).toHaveBeenCalledWith({
        entryId: 'entry-1',
        bookHash: 'book-1',
        bookTitle: 'Test Book',
        bookAuthor: 'Test Author',
        cfi: 'epubcfi(/6/2!/4/2)',
        sectionHref: 'chapter.xhtml',
        page: 12,
        selectedText: 'serendipity',
        contextBefore: 'the word ',
        contextAfter: ' is great',
        highlightNoteId: 'highlight-1',
      });

      // Should NOT write an image (no image selected)
      expect(mockAppService.writeFile).not.toHaveBeenCalled();

      // Should dismiss on success
      expect(mockOnDismiss).toHaveBeenCalled();
    });
  });

  describe('Save — with image', () => {
    it('writes the image file and updates the entry imagePath when an image is selected', async () => {
      // Set up mock selectFiles to return a file
      const mockFile = new File(['fake-image-bytes'], 'photo.jpg', {
        type: 'image/jpeg',
      });
      Object.defineProperty(mockFile, 'arrayBuffer', {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockSelectFiles.mockResolvedValue({ files: [{ file: mockFile }] });

      renderPopup();

      // Type a definition
      const textarea = screen.getByPlaceholderText('Write a definition...') as HTMLTextAreaElement;
      fireEvent.change(textarea, {
        target: { value: 'A happy accident.' },
      });

      // Click the image picker button
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select Image' }));
      });
      expect(mockSelectFiles).toHaveBeenCalledWith({
        type: 'images',
        accept: 'image/*',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
      });

      // Now click Save
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });

      // Should write the image file
      expect(mockAppService.createDir).toHaveBeenCalledWith(
        'entries/entry-1',
        'Dictionaries',
        true,
      );
      expect(mockAppService.writeFile).toHaveBeenCalledWith(
        'entries/entry-1/image.jpg',
        'Dictionaries',
        expect.any(ArrayBuffer),
      );

      // Should update the entry with imagePath
      expect(mockDictionaryService.updateEntry).toHaveBeenCalledWith({
        id: 'entry-1',
        imagePath: 'entries/entry-1/image.jpg',
      });
    });
  });
});

describe('extractCaptureContext', () => {
  it('extracts context before and after the selected word in a text node', () => {
    const text = makeTextNode('the old lighthouse stood there for years');
    // 'the old lighthouse stood there for years'
    //  0-7: 'the old '
    //  8-17: 'lighthouse' (10 chars)
    const range = makeRange(text, 8, 18); // selects 'lighthouse'
    const { contextBefore, contextAfter } = extractCaptureContext(range);

    expect(contextBefore).toBe('the old ');
    expect(contextAfter).toBe(' stood there for years');
  });

  it('handles selection at the start of text node', () => {
    const text = makeTextNode('lighthouse stood tall');
    const range = makeRange(text, 0, 10); // 'lighthouse'
    const { contextBefore, contextAfter } = extractCaptureContext(range);

    expect(contextBefore).toBe('');
    expect(contextAfter).toBe(' stood tall');
  });

  it('handles selection at the end of text node', () => {
    const text = makeTextNode('the old lighthouse');
    const range = makeRange(text, 8, 18); // 'lighthouse'
    const { contextBefore, contextAfter } = extractCaptureContext(range);

    expect(contextBefore).toBe('the old ');
    expect(contextAfter).toBe('');
  });

  it('returns empty strings for non-text nodes (edge case)', () => {
    const container = document.createElement('div');
    container.textContent = 'hello world';
    document.body.appendChild(container);
    const range = new Range();
    range.selectNodeContents(container); // container is an Element, not a Text node
    const { contextBefore, contextAfter } = extractCaptureContext(range);
    document.body.removeChild(container);

    expect(contextBefore).toBe('');
    expect(contextAfter).toBe('');
  });

  it('truncates context beyond 60 characters', () => {
    const longText =
      'this is a very long sentence that goes on and on and on and on and on ' +
      'without ever stopping because it just keeps going forever ' +
      'theword right here in the middle of this mess';
    const text = makeTextNode(longText);
    // Find the start of 'theword' in the concatenated string
    const idx = longText.indexOf('theword');
    const range = makeRange(text, idx, idx + 7);
    const { contextBefore, contextAfter } = extractCaptureContext(range);

    expect(contextBefore.length).toBeLessThanOrEqual(60);
    expect(contextAfter.length).toBeLessThanOrEqual(60);
    // contextBefore should be the 60 chars preceding 'theword'
    expect(contextBefore).toBe(longText.slice(idx - 60, idx));
    // contextAfter should be the 60 chars after 'theword'
    expect(contextAfter).toBe(longText.slice(idx + 7, idx + 7 + 60));
    // Verify it actually IS truncated (not the full text)
    expect(contextBefore).not.toContain('this is a very');
    expect(contextAfter).toContain('right here');
  });

  it('handles selection across the entire text node', () => {
    const text = makeTextNode('hello');
    const range = makeRange(text, 0, 5);
    const { contextBefore, contextAfter } = extractCaptureContext(range);

    expect(contextBefore).toBe('');
    expect(contextAfter).toBe('');
  });
});
