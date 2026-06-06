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
} satisfies Pick<DictionaryService, 'upsertEntry' | 'createOccurrence' | 'updateEntry'>;

const dictionaryService = mockDictionaryService as unknown as DictionaryService;

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
  dictionaryService,
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
      expect(screen.getByText(/Serendipity/i)).toBeTruthy();
    });

    it('renders a definition textarea', () => {
      renderPopup();
      expect(screen.getByPlaceholderText('Escribe una definición...')).toBeTruthy();
    });

    it('renders Save and Cancel buttons', () => {
      renderPopup();
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    });

    it('renders an image picker button', () => {
      renderPopup();
      expect(screen.getByRole('button', { name: 'Agregar Imagen' })).toBeTruthy();
    });
  });

  describe('Cancel', () => {
    it('calls onDismiss and does NOT call service methods when Cancel is clicked', () => {
      renderPopup();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
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
      const textarea = screen.getByPlaceholderText(
        'Escribe una definición...',
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, {
        target: { value: 'The occurrence of happy accidents.' },
      });

      // Click Save
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      });

      // Should upsert entry with the definition
      expect(mockDictionaryService.upsertEntry).toHaveBeenCalledWith({
        term: 'serendipity',
        displayTerm: 'serendipity',
        language: 'en',
        definition: 'The occurrence of happy accidents.',
      });

      // Should create highlight after entry upsert, linked to that entry
      expect(mockOnCreateHighlight).toHaveBeenCalledWith(
        'epubcfi(/6/2!/4/2)',
        'serendipity',
        12,
        'entry-1',
      );
      const upsertCallOrder = mockDictionaryService.upsertEntry.mock.invocationCallOrder[0];
      const highlightCallOrder = mockOnCreateHighlight.mock.invocationCallOrder[0];
      expect(upsertCallOrder).toBeDefined();
      expect(highlightCallOrder).toBeDefined();
      expect(upsertCallOrder!).toBeLessThan(highlightCallOrder!);

      // Should create occurrence with context trimmed (extracted from the surrounding text)
      expect(mockDictionaryService.createOccurrence).toHaveBeenCalledWith({
        entryId: 'entry-1',
        bookHash: 'book-1',
        bookTitle: 'Test Book',
        bookAuthor: 'Test Author',
        cfi: 'epubcfi(/6/2!/4/2)',
        sectionHref: 'chapter.xhtml',
        page: 12,
        selectedText: 'serendipity',
        contextBefore: 'the word',
        contextAfter: 'is great',
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
      const textarea = screen.getByPlaceholderText(
        'Escribe una definición...',
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, {
        target: { value: 'A happy accident.' },
      });

      // Click the image picker button
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Agregar Imagen' }));
      });
      expect(mockSelectFiles).toHaveBeenCalledWith({
        type: 'images',
        accept: 'image/*',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
      });

      // Now click Save
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
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

  describe('Paste image (mouse hover + Ctrl+V)', () => {
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
    // does not fire paste on non-editable elements), and is gated on hover
    // state tracked via mouseenter/mouseleave on the image area. Tests need
    // to fire both: the mouseenter to set hover state, then the paste.
    function hoverImageArea() {
      fireEvent.mouseEnter(screen.getByTestId('capture-image-area'));
    }

    it('sets the selected image when a paste event carries an image file while hovering', () => {
      const imageFile = new File(['png-bytes'], 'pasted.png', { type: 'image/png' });
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: imageFile,
      });

      renderPopup();
      hoverImageArea();
      fireEvent(document.body, pasteEvent);

      // The image is now "selected" — filename visible, Eliminar appears
      expect(screen.getByText('pasted.png')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Eliminar' })).toBeTruthy();
    });

    it('replaces a previously selected image when a new one is pasted', async () => {
      // First, set up an existing image via the picker
      const firstFile = new File(['jpeg-bytes'], 'first.jpg', { type: 'image/jpeg' });
      mockSelectFiles.mockResolvedValue({ files: [{ file: firstFile }] });
      renderPopup();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Agregar Imagen' }));
      });

      // Then paste a new image while hovering
      const secondFile = new File(['png-bytes'], 'pasted.png', { type: 'image/png' });
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: secondFile,
      });
      hoverImageArea();
      fireEvent(document.body, pasteEvent);

      // The pasted image wins
      expect(screen.getByText('pasted.png')).toBeTruthy();
      expect(screen.queryByText('first.jpg')).toBeNull();
    });

    it('does NOT paste an image when the user is NOT hovering the area', () => {
      const imageFile = new File(['png-bytes'], 'pasted.png', { type: 'image/png' });
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: imageFile,
      });

      renderPopup();
      // No hover — fireEvent.mouseEnter is intentionally not called
      fireEvent(document.body, pasteEvent);

      // No image was set — the Agregar Imagen button is still showing
      expect(screen.getByRole('button', { name: 'Agregar Imagen' })).toBeTruthy();
    });

    it('does NOT intercept text pastes in the definition textarea', () => {
      const pasteEvent = buildPasteEventWithItem({
        kind: 'string',
        type: 'text/plain',
        file: null,
      });

      renderPopup();
      hoverImageArea();

      // Fire the paste on the textarea (the natural target when the user is
      // editing the definition). Our handler must NOT preventDefault, so the
      // default text-paste behavior is preserved.
      const textarea = screen.getByPlaceholderText(
        'Escribe una definición...',
      ) as HTMLTextAreaElement;
      fireEvent(textarea, pasteEvent);

      expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
      // No image is set either
      expect(screen.getByRole('button', { name: 'Agregar Imagen' })).toBeTruthy();
    });

    it('persists the pasted image to disk and updates the entry when Save is clicked', async () => {
      const imageFile = new File(['png-bytes'], 'pasted.png', { type: 'image/png' });
      Object.defineProperty(imageFile, 'arrayBuffer', {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: imageFile,
      });

      renderPopup();
      hoverImageArea();
      fireEvent(document.body, pasteEvent);

      // The handler should have preventDefault'd to avoid the browser trying
      // to paste the file's text representation elsewhere
      expect(pasteEvent.preventDefault).toHaveBeenCalled();

      // Save
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      });

      // Same persistence path as the picker: createDir + writeFile + updateEntry
      expect(mockAppService.createDir).toHaveBeenCalledWith(
        'entries/entry-1',
        'Dictionaries',
        true,
      );
      expect(mockAppService.writeFile).toHaveBeenCalledWith(
        'entries/entry-1/image.png',
        'Dictionaries',
        expect.any(ArrayBuffer),
      );
      expect(mockDictionaryService.updateEntry).toHaveBeenCalledWith({
        id: 'entry-1',
        imagePath: 'entries/entry-1/image.png',
      });
    });

    it('uses a sensible default name when the pasted file has none', async () => {
      // The Clipboard API often hands back a File with an empty name
      const namelessFile = new File(['png-bytes'], '', { type: 'image/png' });
      Object.defineProperty(namelessFile, 'arrayBuffer', {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const pasteEvent = buildPasteEventWithItem({
        kind: 'file',
        type: 'image/png',
        file: namelessFile,
      });

      renderPopup();
      hoverImageArea();
      fireEvent(document.body, pasteEvent);

      // The user sees a friendly name in the UI
      expect(screen.getByText('pasted.png')).toBeTruthy();

      // And the file is saved with that name on disk
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      });
      expect(mockAppService.writeFile).toHaveBeenCalledWith(
        'entries/entry-1/image.png',
        'Dictionaries',
        expect.any(ArrayBuffer),
      );
    });
  });
});

describe('extractCaptureContext', () => {
  it('extracts context before and after the selected word in a text node, trimmed', () => {
    const text = makeTextNode('the old lighthouse stood there for years');
    // 'the old lighthouse stood there for years'
    //  0-7: 'the old '
    //  8-17: 'lighthouse' (10 chars)
    const range = makeRange(text, 8, 18); // selects 'lighthouse'
    const { contextBefore, contextAfter } = extractCaptureContext(range, 'lighthouse');

    expect(contextBefore).toBe('the old');
    expect(contextAfter).toBe('stood there for years');
  });

  it('handles selection at the start of text node', () => {
    const text = makeTextNode('lighthouse stood tall');
    const range = makeRange(text, 0, 10); // 'lighthouse'
    const { contextBefore, contextAfter } = extractCaptureContext(range, 'lighthouse');

    expect(contextBefore).toBe('');
    expect(contextAfter).toBe('stood tall');
  });

  it('handles selection at the end of text node', () => {
    const text = makeTextNode('the old lighthouse');
    const range = makeRange(text, 8, 18); // 'lighthouse'
    const { contextBefore, contextAfter } = extractCaptureContext(range, 'lighthouse');

    expect(contextBefore).toBe('the old');
    expect(contextAfter).toBe('');
  });

  it('returns empty strings for non-text nodes (edge case)', () => {
    const container = document.createElement('div');
    container.textContent = 'hello world';
    document.body.appendChild(container);
    const range = new Range();
    range.selectNodeContents(container); // container is an Element, not a Text node
    const { contextBefore, contextAfter } = extractCaptureContext(range, 'hello');
    document.body.removeChild(container);

    expect(contextBefore).toBe('');
    expect(contextAfter).toBe('');
  });

  it('captures a wide window and extracts the full sentence when the context has multiple sentences', () => {
    const text = makeTextNode(
      'The rain stopped. The sun came out and everything felt different. The birds sang.',
    );
    // Find 'everything' and select it
    const idx = text.textContent!.indexOf('everything');
    const range = makeRange(text, idx, idx + 'everything'.length);
    const { contextBefore, contextAfter } = extractCaptureContext(range, 'everything');

    // Only the sentence containing the word is captured, trimmed
    expect(contextBefore).toBe('The sun came out and');
    expect(contextAfter).toBe('felt different.');
    // The earlier and later sentences must NOT leak into the context
    expect(contextBefore).not.toContain('The rain stopped');
    expect(contextAfter).not.toContain('The birds sang');
  });

  it('handles selection across the entire text node', () => {
    const text = makeTextNode('hello');
    const range = makeRange(text, 0, 5);
    const { contextBefore, contextAfter } = extractCaptureContext(range, 'hello');

    expect(contextBefore).toBe('');
    expect(contextAfter).toBe('');
  });
});
