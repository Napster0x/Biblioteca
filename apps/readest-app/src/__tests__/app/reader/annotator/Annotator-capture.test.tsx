import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createDictionaryCaptureHighlight } from '@/app/reader/utils/dictionaryCapture';

// ---------------------------------------------------------------------------
// Minimal mocks required for Annotator to load
// ---------------------------------------------------------------------------

const annotatorMocks = vi.hoisted(() => {
  const appService = { isMobile: false, isAndroidApp: false };
  const dictionaryService = {
    upsertEntry: vi.fn(),
    createOccurrence: vi.fn(),
    updateEntry: vi.fn(),
  };
  return {
    appService,
    dictionaryService,
    getDictionaryService: vi.fn().mockResolvedValue(dictionaryService),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: annotatorMocks.appService }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: vi.fn().mockReturnValue({ booknotes: [] }),
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn((_key, notes) => notes),
    getBookData: vi.fn().mockReturnValue({
      book: { hash: 'book-1', primaryLanguage: 'en' },
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
      getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2)'),
      addAnnotation: vi.fn(),
      deselect: vi.fn(),
    }),
    getViewsById: vi.fn().mockReturnValue([]),
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

vi.mock('../../hooks/useFoliateEvents', () => ({ useFoliateEvents: vi.fn() }));
vi.mock('../../hooks/useReadwiseSync', () => ({ useReadwiseSync: vi.fn() }));
vi.mock('../../hooks/useHardcoverSync', () => ({ useHardcoverSync: vi.fn() }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: vi.fn() }));
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
        handleUpToPopup: vi.fn(),
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
        handleUpToPopup: vi.fn(),
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
vi.mock('@/components/Alert', () => ({ default: () => null }));
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
vi.mock('./ExportMarkdownDialog', () => ({ default: () => null }));

vi.mock('../../utils/annotatorUtil', () => ({
  getHighlightColorHex: vi.fn().mockReturnValue('#ffff00'),
  removeBookNoteOverlays: vi.fn(),
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

describe('createDictionaryCaptureHighlight', () => {
  it('creates a BookNote highlight with correct fields', () => {
    const highlight = createDictionaryCaptureHighlight({
      selectedText: 'serendipity',
      cfi: 'epubcfi(/6/2!/4/2)',
      page: 12,
      style: 'highlight',
      color: 'yellow',
      id: 'note-test-1',
      timestamp: 1000,
    });

    expect(highlight).toEqual({
      id: 'note-test-1',
      type: 'annotation',
      cfi: 'epubcfi(/6/2!/4/2)',
      style: 'highlight',
      color: 'yellow',
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
      id: 'note-hyphen-1',
      timestamp: 2000,
    });

    expect(highlight.text).toBe('con-\nnection');
    expect(highlight.style).toBe('underline');
    expect(highlight.color).toBe('blue');
  });
});
