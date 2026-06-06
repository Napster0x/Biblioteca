import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createDictionaryCaptureHighlight } from '@/app/reader/utils/dictionaryCapture';
import { eventDispatcher } from '@/utils/event';
import type { BookNote } from '@/types/book';

function withoutDictionaryEntryId(note: BookNote): Omit<BookNote, 'dictionaryEntryId'> {
  const { dictionaryEntryId: _dictionaryEntryId, ...rest } = note;
  return rest;
}

function withoutCiteId(note: BookNote): Omit<BookNote, 'citeId'> {
  const { citeId: _citeId, ...rest } = note;
  return rest;
}

// ---------------------------------------------------------------------------
// Minimal mocks required for Annotator to load
// ---------------------------------------------------------------------------

const annotatorMocks = vi.hoisted(() => {
  const appService = { isMobile: false, isAndroidApp: false };
  const dictionaryService = {
    upsertEntry: vi.fn(),
    createOccurrence: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntries: vi.fn().mockResolvedValue(undefined),
  };
  const quote = {
    id: 'cite-1',
    bookHash: 'book-1',
    bookTitle: 'Test Book',
    bookAuthor: 'Test Author',
    cfi: 'epubcfi(/6/2!/4/2)',
    sectionHref: 'ch1.xhtml',
    page: 1,
    text: 'serendipity',
    contextBefore: null,
    contextAfter: null,
    contentHash: 'hash-1',
    createdAt: 1000,
    updatedAt: null,
  };
  const citasService = { createQuote: vi.fn().mockResolvedValue(quote) };
  const createQuoteInStore = vi.fn().mockResolvedValue(quote);
  const router = { push: vi.fn() };
  const booknote: BookNote = {
    id: 'note-dict-1',
    type: 'annotation' as const,
    cfi: 'epubcfi(/6/2!/4/2)',
    style: 'highlight' as const,
    color: '#bae6fd',
    text: 'serendipity',
    note: '',
    dictionaryEntryId: 'entry-1',
    createdAt: 1000,
    updatedAt: 1000,
  };
  const config: { booknotes: BookNote[] } = { booknotes: [booknote] };
  const saveConfig = vi.fn();
  const updateBooknotes = vi.fn((_key, notes) => ({ booknotes: notes }));
  const addAnnotation = vi.fn();
  const getCFI = vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)');
  const removeBookNoteOverlays = vi.fn();
  const handleUpToPopup = vi.fn();
  const overlayerHitTest = vi.fn();
  const deleteCitasQuotes = vi.fn().mockResolvedValue(undefined);
  const removeQuotesFromState = vi.fn();
  const citasQuotes: (typeof quote)[] = [];
  const foliateHandlers: {
    current: Record<string, (event: CustomEvent<unknown>) => void | Promise<void>>;
  } = { current: {} };
  return {
    appService,
    dictionaryService,
    router,
    config,
    saveConfig,
    updateBooknotes,
    addAnnotation,
    getCFI,
    removeBookNoteOverlays,
    handleUpToPopup,
    overlayerHitTest,
    deleteCitasQuotes,
    removeQuotesFromState,
    citasQuotes,
    foliateHandlers,
    getDictionaryService: vi.fn().mockResolvedValue(dictionaryService),
    quote,
    citasService,
    createQuoteInStore,
    getCitasService: vi.fn().mockResolvedValue(citasService),
  };
});

vi.mock('@/app/reader/utils/citasCapture', async () => {
  const actual = await vi.importActual<typeof import('@/app/reader/utils/citasCapture')>(
    '@/app/reader/utils/citasCapture',
  );
  return {
    ...actual,
    softDeleteCitasHighlights: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => annotatorMocks.router,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: annotatorMocks.appService }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: vi.fn().mockReturnValue(annotatorMocks.config),
    saveConfig: annotatorMocks.saveConfig,
    updateBooknotes: annotatorMocks.updateBooknotes,
    getBookData: vi.fn().mockReturnValue({
      book: { hash: 'book-1', title: 'Test Book', author: 'Test Author', primaryLanguage: 'en' },
      bookDoc: { metadata: { language: 'en' } },
    }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        highlightStyle: 'highlight',
        highlightStyles: { highlight: 'yellow' },
      },
    },
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: vi.fn().mockReturnValue({ page: 1, sectionHref: 'ch1.xhtml', location: {} }),
    getView: vi.fn().mockReturnValue({
      getCFI: annotatorMocks.getCFI,
      addAnnotation: annotatorMocks.addAnnotation,
      renderer: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getContents: vi.fn().mockReturnValue([
          {
            index: 0,
            doc: document,
            overlayer: { hitTest: annotatorMocks.overlayerHitTest },
          },
        ]),
      },
      deselect: vi.fn(),
    }),
    getViewsById: vi.fn().mockReturnValue([{ addAnnotation: annotatorMocks.addAnnotation }]),
    getViewSettings: vi.fn().mockReturnValue({ vertical: false }),
  }),
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({ setNotebookVisible: vi.fn(), setNotebookNewAnnotation: vi.fn() }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ clearBooknotesNav: vi.fn() }),
}));

vi.mock('@/store/customDictionaryStore', () => ({
  useCustomDictionaryStore: () => ({
    loadCustomDictionaries: vi.fn().mockResolvedValue(undefined),
    settings: {},
  }),
}));

vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({ listenToNativeTouchEvents: vi.fn() }),
}));

vi.mock('@/services/dictionary/dictionaryServiceCache', () => ({
  getDictionaryService: annotatorMocks.getDictionaryService,
}));

vi.mock('@/services/citas/citasServiceCache', () => ({
  getCitasService: annotatorMocks.getCitasService,
}));

vi.mock('@/store/citasStore', () => ({
  useCitasStore: {
    getState: () => ({
      createQuote: annotatorMocks.createQuoteInStore,
      deleteQuotes: annotatorMocks.deleteCitasQuotes,
      removeQuotesFromState: annotatorMocks.removeQuotesFromState,
      quotes: annotatorMocks.citasQuotes,
    }),
  },
}));

vi.mock('@/services/dictionaries/registry', () => ({
  isSystemDictionaryEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: vi.fn().mockReturnValue(10),
}));

vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/utils/sel', () => ({
  getPopupPosition: vi.fn().mockReturnValue({ dir: 'up', point: { x: 100, y: 200 } }),
  getPosition: vi.fn().mockReturnValue({ dir: 'up', point: { x: 100, y: 200 }, rect: {} }),
  getRangeRectInWebview: vi.fn(),
  getRangeTextStyleInWebview: vi.fn(),
  getTextFromRange: vi.fn().mockReturnValue(''),
}));

vi.mock('../../hooks/useFoliateEvents', () => ({
  useFoliateEvents: vi.fn((_view, handlers) => {
    annotatorMocks.foliateHandlers.current = handlers;
  }),
}));
vi.mock('../../hooks/useReadwiseSync', () => ({ useReadwiseSync: vi.fn() }));
vi.mock('../../hooks/useHardcoverSync', () => ({ useHardcoverSync: vi.fn() }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({
  useFoliateEvents: vi.fn((_view, handlers) => {
    annotatorMocks.foliateHandlers.current = handlers;
  }),
}));
vi.mock('@/app/reader/hooks/useReadwiseSync', () => ({ useReadwiseSync: vi.fn() }));
vi.mock('@/app/reader/hooks/useHardcoverSync', () => ({ useHardcoverSync: vi.fn() }));

vi.mock('../../hooks/useTextSelector', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useTextSelector: (_bookKey: string, setSelection: (selection: unknown) => void) => {
      React.useEffect(() => {
        const text = document.createTextNode('the word serendipity appears');
        const range = new Range();
        range.setStart(text, 9);
        range.setEnd(text, 20);
        setSelection({
          key: 'book-1',
          text: 'serendipity',
          range,
          index: 0,
        });
      }, [setSelection]);

      return {
        isTextSelected: { current: false },
        isInstantAnnotating: { current: false },
        handleScroll: vi.fn(),
        handleTouchStart: vi.fn(),
        handleTouchMove: vi.fn(),
        handleTouchEnd: vi.fn(),
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerCancel: vi.fn(),
        handlePointerUp: vi.fn(),
        handleSelectionchange: vi.fn(),
        handleShowPopup: vi.fn(),
        handleUpToPopup: annotatorMocks.handleUpToPopup,
        handleContextmenu: vi.fn(),
      };
    },
  };
});

vi.mock('@/app/reader/hooks/useTextSelector', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useTextSelector: (_bookKey: string, setSelection: (selection: unknown) => void) => {
      React.useEffect(() => {
        const text = document.createTextNode('the word serendipity appears');
        const range = new Range();
        range.setStart(text, 9);
        range.setEnd(text, 20);
        setSelection({
          key: 'book-1',
          text: 'serendipity',
          range,
          index: 0,
        });
      }, [setSelection]);

      return {
        isTextSelected: { current: false },
        isInstantAnnotating: { current: false },
        handleScroll: vi.fn(),
        handleTouchStart: vi.fn(),
        handleTouchMove: vi.fn(),
        handleTouchEnd: vi.fn(),
        handlePointerDown: vi.fn(),
        handlePointerMove: vi.fn(),
        handlePointerCancel: vi.fn(),
        handlePointerUp: vi.fn(),
        handleSelectionchange: vi.fn(),
        handleShowPopup: vi.fn(),
        handleUpToPopup: annotatorMocks.handleUpToPopup,
        handleContextmenu: vi.fn(),
      };
    },
  };
});

vi.mock('@/services/transformService', () => ({
  transformContent: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/utils/misc', () => ({
  uniqueId: vi.fn().mockReturnValue('note-1'),
  getLocale: vi.fn().mockReturnValue('en'),
  getOSPlatform: vi.fn().mockReturnValue('unknown'),
  makeSafeFilename: vi.fn().mockReturnValue('test'),
  stubTranslation: (s: string) => s,
}));

vi.mock('@/utils/throttle', () => ({
  throttle: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

vi.mock('@/utils/simplecc', () => ({
  runSimpleCC: vi.fn().mockReturnValue(''),
}));

vi.mock('@/utils/cfi', () => ({
  getIndexFromCfi: vi.fn().mockReturnValue(0),
  isCfiInLocation: vi.fn().mockReturnValue(false),
}));

vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));

vi.mock('@/services/environment', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/environment')>('@/services/environment');
  return { ...actual, isTauriAppPlatform: () => false };
});

// Mock popup components to avoid dragging in complex deps
vi.mock('@/components/Popup', () => ({ default: () => null }));
vi.mock('@/components/Dialog', () => ({ default: () => null }));
vi.mock('@/components/Alert', () => ({
  default: ({
    onConfirm,
    onCancel,
    title,
    message,
  }: {
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
    message: string;
  }) => (
    <div data-testid='alert-dialog'>
      <h3>{title}</h3>
      <p>{message}</p>
      <button data-testid='alert-confirm' onClick={onConfirm}>
        Confirm
      </button>
      <button data-testid='alert-cancel' onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));
vi.mock('@/components/ModalPortal', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./AnnotationPopup', () => ({
  default: ({ buttons }: { buttons: Array<{ tooltipText: string; onClick: () => void }> }) => (
    <div data-testid='annotation-popup'>
      {buttons.map((button) => (
        <button key={button.tooltipText} type='button' onClick={button.onClick}>
          {button.tooltipText}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/app/reader/components/annotator/AnnotationPopup', () => ({
  default: ({ buttons }: { buttons: Array<{ tooltipText: string; onClick: () => void }> }) => (
    <div data-testid='annotation-popup'>
      {buttons.map((button) => (
        <button key={button.tooltipText} type='button' onClick={button.onClick}>
          {button.tooltipText}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('./DictionaryPopup', () => ({ default: () => null }));
vi.mock('./DictionarySheet', () => ({ default: () => null }));
vi.mock('./CapturePopup', () => ({
  default: ({ selectedText }: { selectedText: string }) => (
    <div data-testid='capture-popup'>Capture {selectedText}</div>
  ),
}));
vi.mock('@/app/reader/components/annotator/CapturePopup', () => ({
  default: ({ selectedText }: { selectedText: string }) => (
    <div data-testid='capture-popup'>Capture {selectedText}</div>
  ),
}));
vi.mock('./TranslatorPopup', () => ({ default: () => null }));
vi.mock('./ProofreadPopup', () => ({ default: () => null }));
vi.mock('./AnnotationRangeEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/AnnotationRangeEditor', () => ({ default: () => null }));
vi.mock('./ExportMarkdownDialog', () => ({ default: () => null }));

vi.mock('../../utils/annotatorUtil', () => ({
  getHighlightColorHex: vi.fn().mockReturnValue('#ffff00'),
  removeBookNoteOverlays: annotatorMocks.removeBookNoteOverlays,
}));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  getHighlightColorHex: vi.fn().mockReturnValue('#ffff00'),
  removeBookNoteOverlays: annotatorMocks.removeBookNoteOverlays,
}));

vi.mock('../../utils/deferredAction', () => ({
  createDeferredActionState: vi.fn().mockReturnValue({}),
  runOrDeferAction: vi.fn((_ref, _defer, action) => action()),
  cancelDeferredAction: vi.fn(),
  flushDeferredAction: vi.fn(),
}));

vi.mock('foliate-js/overlayer.js', () => ({
  Overlayer: {
    highlight: 'highlight',
    underline: 'underline',
    squiggly: 'squiggly',
    bubble: 'bubble',
  },
}));

vi.mock('foliate-js/epubcfi.js', () => ({
  default: { compare: vi.fn().mockReturnValue(0) },
  compare: vi.fn().mockReturnValue(0),
}));

vi.mock('react-icons/ri', () => ({
  RiDeleteBinLine: 'RiDeleteBinLine',
}));

import Annotator from '@/app/reader/components/annotator/Annotator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  annotatorMocks.config.booknotes = [
    {
      ...withoutCiteId(annotatorMocks.config.booknotes[0]!),
      id: 'note-dict-1',
      deletedAt: null,
      dictionaryEntryId: 'entry-1',
    },
  ];
  annotatorMocks.overlayerHitTest.mockReset();
  annotatorMocks.getCFI.mockReset();
  annotatorMocks.getCFI.mockReturnValue('epubcfi(/6/2!/4/2)');
  annotatorMocks.getCitasService.mockResolvedValue(annotatorMocks.citasService);
  annotatorMocks.citasService.createQuote.mockResolvedValue(annotatorMocks.quote);
  annotatorMocks.createQuoteInStore.mockResolvedValue(annotatorMocks.quote);
  annotatorMocks.deleteCitasQuotes.mockResolvedValue(undefined);
  annotatorMocks.removeQuotesFromState.mockReset();
  annotatorMocks.citasQuotes.length = 0;
});

describe('Annotator dictionary capture wiring', () => {
  it('opens CapturePopup when the reader dictionary action is clicked', async () => {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);

    render(<Annotator bookKey='book-1' />);

    fireEvent.click(await screen.findByRole('button', { name: 'Diccionario' }));

    await waitFor(() => {
      expect(screen.getByTestId('capture-popup').textContent).toBe('Capture serendipity');
    });
    expect(annotatorMocks.getDictionaryService).toHaveBeenCalledWith(annotatorMocks.appService);
  });
});

describe('Annotator Citas quote capture wiring', () => {
  it('persists a Cite and draws a cite-linked quote highlight when the C action is clicked', async () => {
    document.documentElement.style.setProperty('--citas-highlight', '#fca5a5');
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);

    render(<Annotator bookKey='book-1' />);

    fireEvent.click(await screen.findByRole('button', { name: 'Citas' }));

    await waitFor(() => {
      expect(annotatorMocks.getCitasService).toHaveBeenCalledWith(annotatorMocks.appService);
      expect(annotatorMocks.createQuoteInStore).toHaveBeenCalledWith(
        {
          bookHash: 'book-1',
          bookTitle: 'Test Book',
          bookAuthor: 'Test Author',
          cfi: 'epubcfi(/6/2!/4/2)',
          sectionHref: 'ch1.xhtml',
          page: 1,
          text: 'serendipity',
          contextBefore: null,
          contextAfter: null,
        },
        annotatorMocks.citasService,
      );
      expect(annotatorMocks.addAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'annotation',
          cfi: 'epubcfi(/6/2!/4/2)',
          style: 'highlight',
          color: '#fca5a5',
          citeId: 'cite-1',
          text: 'serendipity',
        }),
      );
      expect(annotatorMocks.updateBooknotes).toHaveBeenCalledWith(
        'book-1',
        expect.arrayContaining([expect.objectContaining({ citeId: 'cite-1', color: '#fca5a5' })]),
      );
      expect(annotatorMocks.saveConfig).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('capture-popup')).toBeNull();
    document.documentElement.style.removeProperty('--citas-highlight');
  });

  it('aborts without persistence or highlight when the selection has no CFI', async () => {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    annotatorMocks.getCFI.mockReturnValueOnce('');

    render(<Annotator bookKey='book-1' />);

    fireEvent.click(await screen.findByRole('button', { name: 'Citas' }));

    await waitFor(() => {
      expect(annotatorMocks.getCitasService).not.toHaveBeenCalled();
      expect(annotatorMocks.createQuoteInStore).not.toHaveBeenCalled();
      expect(annotatorMocks.addAnnotation).not.toHaveBeenCalledWith(
        expect.objectContaining({ citeId: expect.any(String) }),
      );
      expect(annotatorMocks.updateBooknotes).not.toHaveBeenCalledWith(
        'book-1',
        expect.arrayContaining([expect.objectContaining({ citeId: expect.any(String) })]),
      );
      expect(annotatorMocks.saveConfig).not.toHaveBeenCalled();
    });
  });

  it('does not draw an orphan quote highlight when Citas persistence reports a duplicate', async () => {
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);
    annotatorMocks.createQuoteInStore.mockRejectedValueOnce(
      new Error('UNIQUE constraint failed: quotes.book_hash, quotes.content_hash'),
    );

    render(<Annotator bookKey='book-1' />);

    fireEvent.click(await screen.findByRole('button', { name: 'Citas' }));

    await waitFor(() => {
      expect(annotatorMocks.createQuoteInStore).toHaveBeenCalled();
      expect(annotatorMocks.addAnnotation).not.toHaveBeenCalledWith(
        expect.objectContaining({ citeId: expect.any(String) }),
      );
      expect(annotatorMocks.updateBooknotes).not.toHaveBeenCalledWith(
        'book-1',
        expect.arrayContaining([expect.objectContaining({ citeId: expect.any(String) })]),
      );
      expect(annotatorMocks.saveConfig).not.toHaveBeenCalled();
    });
  });

  it('shows a quote × button on hover over a citeId highlight and routes clicks to normal annotation popup', async () => {
    annotatorMocks.config.booknotes = [
      {
        ...withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!),
        id: 'note-quote-1',
        citeId: 'cite-1',
        color: '#fca5a5',
      },
    ];
    render(<Annotator bookKey='book-1' />);
    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/2)',
      new Range(),
      { left: 20, top: 40, right: 80, bottom: 60 },
    ]);

    annotatorMocks.foliateHandlers.current['onLoad']?.(
      new CustomEvent('load', {
        detail: { doc: document, index: 0 },
      }),
    );
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });

    // Quote × appears on hover
    const removeButton = await screen.findByRole('button', {
      name: 'Remove quote highlight',
    });
    expect(removeButton).toBeTruthy();
    expect(document.body.style.cursor).toBe('pointer');

    // Dictionary × does NOT appear
    expect(screen.queryByRole('button', { name: 'Remove dictionary highlight' })).toBeNull();

    // Quote highlights navigate to Citas with the linked quote highlighted.
    annotatorMocks.foliateHandlers.current['onShowAnnotation']?.(
      new CustomEvent('show-annotation', {
        detail: {
          value: 'epubcfi(/6/2!/4/2)',
          index: 0,
          range: new Range(),
        },
      }),
    );

    expect(annotatorMocks.router.push).toHaveBeenCalledWith('/citas?highlight=cite-1');
    expect(annotatorMocks.dictionaryService.deleteEntries).not.toHaveBeenCalled();
    expect(annotatorMocks.removeBookNoteOverlays).not.toHaveBeenCalled();
    expect(annotatorMocks.handleUpToPopup).not.toHaveBeenCalled();
  });
});

describe('Annotator quote highlight hover × + delete modal', () => {
  it('opens the delete modal when the quote × is clicked', async () => {
    annotatorMocks.config.booknotes = [
      {
        ...withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!),
        id: 'note-quote-2',
        citeId: 'cite-99',
        color: '#fca5a5',
      },
    ];
    render(<Annotator bookKey='book-1' />);
    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/2)',
      new Range(),
      { left: 20, top: 40, right: 80, bottom: 60 },
    ]);

    annotatorMocks.foliateHandlers.current['onLoad']?.(
      new CustomEvent('load', { detail: { doc: document, index: 0 } }),
    );
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });

    const removeButton = await screen.findByRole('button', {
      name: 'Remove quote highlight',
    });
    fireEvent.click(removeButton);

    expect(screen.getByRole('dialog', { name: 'Confirmar borrado de Cita' })).toBeTruthy();
    expect(screen.getByText('¿Estás seguro de que quieres borrar esta cita?')).toBeTruthy();
  });

  it('confirming delete removes the highlight and calls deleteQuotes on citasStore', async () => {
    annotatorMocks.config.booknotes = [
      {
        ...withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!),
        id: 'note-quote-3',
        citeId: 'cite-42',
        color: '#fca5a5',
      },
    ];
    render(<Annotator bookKey='book-1' />);
    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/2)',
      new Range(),
      { left: 20, top: 40, right: 80, bottom: 60 },
    ]);

    annotatorMocks.foliateHandlers.current['onLoad']?.(
      new CustomEvent('load', { detail: { doc: document, index: 0 } }),
    );
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });

    const removeButton = await screen.findByRole('button', {
      name: 'Remove quote highlight',
    });
    fireEvent.click(removeButton);
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }));

    await waitFor(() => {
      expect(annotatorMocks.config.booknotes[0]!.deletedAt).toEqual(expect.any(Number));
      expect(annotatorMocks.removeBookNoteOverlays).toHaveBeenCalledWith(
        expect.anything(),
        annotatorMocks.config.booknotes[0],
      );
      expect(annotatorMocks.deleteCitasQuotes).toHaveBeenCalledWith(
        ['cite-42'],
        expect.any(Object),
      );
    });
    expect(annotatorMocks.saveConfig).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remove quote highlight' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show the quote × for highlights without citeId', async () => {
    annotatorMocks.config.booknotes = [
      {
        ...withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!),
        id: 'note-plain-1',
        color: '#fef08a',
      },
    ];
    render(<Annotator bookKey='book-1' />);
    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/2)',
      new Range(),
      { left: 20, top: 40, right: 80, bottom: 60 },
    ]);

    annotatorMocks.foliateHandlers.current['onLoad']?.(
      new CustomEvent('load', { detail: { doc: document, index: 0 } }),
    );
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });

    expect(screen.queryByRole('button', { name: 'Remove quote highlight' })).toBeNull();
    expect(document.body.style.cursor).toBe('');
  });
});

describe('Annotator dictionary highlight interaction', () => {
  it('routes dictionary highlights to the entry detail without opening annotation UI', async () => {
    render(<Annotator bookKey='book-1' />);

    annotatorMocks.foliateHandlers.current['onShowAnnotation']?.(
      new CustomEvent('show-annotation', {
        detail: {
          value: 'epubcfi(/6/2!/4/2)',
          index: 0,
          range: new Range(),
          rect: { left: 20, top: 40, right: 80, bottom: 60 },
        },
      }),
    );

    expect(annotatorMocks.router.push).toHaveBeenCalledWith('/dictionary/entry-1');
    expect(screen.queryByTestId('annotation-popup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove dictionary highlight' })).toBeNull();
  });

  it('keeps normal highlights on the existing annotation popup path', async () => {
    annotatorMocks.config.booknotes = [
      { ...withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!) },
    ];
    render(<Annotator bookKey='book-1' />);

    annotatorMocks.foliateHandlers.current['onShowAnnotation']?.(
      new CustomEvent('show-annotation', {
        detail: {
          value: 'epubcfi(/6/2!/4/2)',
          index: 0,
          range: new Range(),
        },
      }),
    );

    expect(annotatorMocks.router.push).not.toHaveBeenCalled();
    expect(annotatorMocks.handleUpToPopup).toHaveBeenCalled();
  });

  it('shows a close button on dictionary highlight hover and deletes note plus entry without navigation', async () => {
    render(<Annotator bookKey='book-1' />);
    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/2)',
      new Range(),
      { left: 20, top: 40, right: 80, bottom: 60 },
    ]);

    annotatorMocks.foliateHandlers.current['onLoad']?.(
      new CustomEvent('load', {
        detail: {
          doc: document,
          index: 0,
        },
      }),
    );
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });

    const removeButton = await screen.findByRole('button', {
      name: 'Remove dictionary highlight',
    });
    expect(annotatorMocks.router.push).not.toHaveBeenCalled();
    fireEvent.click(removeButton);
    expect(screen.getByRole('dialog', { name: 'Confirmar borrado de Diccionario' })).toBeTruthy();
    expect(screen.getByText('Serendipity')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }));

    await waitFor(() => {
      expect(annotatorMocks.config.booknotes[0]!.deletedAt).toEqual(expect.any(Number));
      expect(annotatorMocks.removeBookNoteOverlays).toHaveBeenCalledWith(
        expect.anything(),
        annotatorMocks.config.booknotes[0],
      );
      expect(annotatorMocks.dictionaryService.deleteEntries).toHaveBeenCalledWith(['entry-1']);
    });
    expect(annotatorMocks.saveConfig).toHaveBeenCalled();
    expect(annotatorMocks.router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remove dictionary highlight' })).toBeNull();
  });

  it('resets the cursor when the mouse leaves a dictionary highlight onto a non-dictionary value', async () => {
    render(<Annotator bookKey='book-1' />);

    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/2)',
      new Range(),
      { left: 20, top: 40, right: 80, bottom: 60 },
    ]);

    annotatorMocks.foliateHandlers.current['onLoad']?.(
      new CustomEvent('load', {
        detail: { doc: document, index: 0 },
      }),
    );

    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
    await screen.findByRole('button', { name: 'Remove dictionary highlight' });
    expect(document.body.style.cursor).toBe('pointer');

    // Move onto a hit that resolves to no annotation (no value at all)
    annotatorMocks.overlayerHitTest.mockReturnValue([] as unknown as never[]);
    fireEvent.mouseMove(document, { clientX: 200, clientY: 200 });

    expect(document.body.style.cursor).toBe('');
    expect(screen.queryByRole('button', { name: 'Remove dictionary highlight' })).toBeNull();
  });

  it('resets the cursor when the mouse moves from a dictionary highlight onto a non-dictionary annotation', async () => {
    render(<Annotator bookKey='book-1' />);

    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/2)',
      new Range(),
      { left: 20, top: 40, right: 80, bottom: 60 },
    ]);

    annotatorMocks.foliateHandlers.current['onLoad']?.(
      new CustomEvent('load', {
        detail: { doc: document, index: 0 },
      }),
    );

    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
    await screen.findByRole('button', { name: 'Remove dictionary highlight' });
    expect(document.body.style.cursor).toBe('pointer');

    // Now hover over a CFI that does not belong to any active annotation
    annotatorMocks.overlayerHitTest.mockReturnValue([
      'epubcfi(/6/2!/4/10)',
      new Range(),
      { left: 200, top: 200, right: 260, bottom: 220 },
    ]);
    fireEvent.mouseMove(document, { clientX: 230, clientY: 210 });

    expect(document.body.style.cursor).toBe('');
    expect(screen.queryByRole('button', { name: 'Remove dictionary highlight' })).toBeNull();
  });
});

describe('createDictionaryCaptureHighlight', () => {
  it('creates a BookNote highlight with correct fields', () => {
    const highlight = createDictionaryCaptureHighlight({
      selectedText: 'serendipity',
      cfi: 'epubcfi(/6/2!/4/2)',
      page: 12,
      style: 'highlight',
      color: 'yellow',
      dictionaryEntryId: 'entry-test-1',
      id: 'note-test-1',
      timestamp: 1000,
    });

    expect(highlight).toEqual({
      id: 'note-test-1',
      type: 'annotation',
      cfi: 'epubcfi(/6/2!/4/2)',
      style: 'highlight',
      color: 'yellow',
      dictionaryEntryId: 'entry-test-1',
      text: 'serendipity',
      note: '',
      page: 12,
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('handles word with hyphenation repair', () => {
    const highlight = createDictionaryCaptureHighlight({
      selectedText: 'con-\nnection',
      cfi: 'epubcfi(/6/2!/4/8,/1:0,/1:10)',
      page: 9,
      style: 'underline',
      color: 'blue',
      dictionaryEntryId: 'entry-hyphen-1',
      id: 'note-hyphen-1',
      timestamp: 2000,
    });

    expect(highlight.text).toBe('con-\nnection');
    expect(highlight.style).toBe('underline');
    expect(highlight.color).toBe('blue');
  });
});

describe('Annotator clear-annotations Citas sync', () => {
  it('calls removeQuotesFromState for each citeId annotation when clear-annotations is confirmed', async () => {
    annotatorMocks.config.booknotes = [
      {
        ...withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!),
        id: 'note-cite-a',
        citeId: 'cite-a',
        color: '#fca5a5',
      },
      {
        ...withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!),
        id: 'note-cite-b',
        citeId: 'cite-b',
        color: '#fca5a5',
      },
      {
        ...withoutCiteId(withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!)),
        id: 'note-plain-1',
        color: '#fef08a',
      },
      {
        ...withoutCiteId(annotatorMocks.config.booknotes[0]!),
        id: 'note-dict-1',
        dictionaryEntryId: 'entry-1',
        color: '#bae6fd',
      },
    ];
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);

    render(<Annotator bookKey='book-1' />);

    // Get the clear-annotations handler registered via eventDispatcher.on
    const onMock = vi.mocked(eventDispatcher.on);
    const clearCall = onMock.mock.calls.find(([eventName]) => eventName === 'clear-annotations');
    expect(clearCall).toBeTruthy();
    const handler = clearCall![1] as (event: CustomEvent) => void;
    handler(new CustomEvent('clear-annotations', { detail: { bookKey: 'book-1' } }));

    // The Alert confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByTestId('alert-dialog')).toBeTruthy();
    });

    // Click confirm
    fireEvent.click(screen.getByTestId('alert-confirm'));

    await waitFor(() => {
      expect(annotatorMocks.removeQuotesFromState).toHaveBeenCalledWith(['cite-a', 'cite-b']);
    });
  });

  it('does not call removeQuotesFromState when no citeId annotations are cleared', async () => {
    annotatorMocks.config.booknotes = [
      {
        ...withoutCiteId(withoutDictionaryEntryId(annotatorMocks.config.booknotes[0]!)),
        id: 'note-plain-2',
        color: '#fef08a',
      },
    ];
    const gridCell = document.createElement('div');
    gridCell.id = 'gridcell-book-1';
    document.body.appendChild(gridCell);

    render(<Annotator bookKey='book-1' />);

    const onMock = vi.mocked(eventDispatcher.on);
    const clearCall = onMock.mock.calls.find(([eventName]) => eventName === 'clear-annotations');
    expect(clearCall).toBeTruthy();
    const handler = clearCall![1] as (event: CustomEvent) => void;
    handler(new CustomEvent('clear-annotations', { detail: { bookKey: 'book-1' } }));

    await waitFor(() => {
      expect(screen.getByTestId('alert-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('alert-confirm'));

    await waitFor(() => {
      expect(annotatorMocks.removeQuotesFromState).not.toHaveBeenCalled();
    });
  });
});
