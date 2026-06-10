import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncTransport } from '@/services/sync/SyncTransport';

// ---------------------------------------------------------------------------
// Mocks — must be defined before the dynamic import
// ---------------------------------------------------------------------------

// Shared mock functions used across both the WebDAVTransport mock and the
// custom transport tests.
const mockPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
const mockPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
const mockPullDictImage = vi.fn<(entryId: string) => Promise<ArrayBuffer | null>>();
const mockPushDictImage =
  vi.fn<(entryId: string, imageBytes: ArrayBuffer) => Promise<{ uploaded: boolean }>>();

// Mock WebDAVTransport — the default fallback when no transport is provided.
vi.mock('@/services/sync/WebDAVTransport', () => ({
  WebDAVTransport: vi.fn(function (this: {
    kind: string;
    pull: typeof mockPull;
    push: typeof mockPush;
    pullDictionaryImage: typeof mockPullDictImage;
    pushDictionaryImage: typeof mockPushDictImage;
  }) {
    this.kind = 'webdav';
    this.pull = mockPull;
    this.push = mockPush;
    this.pullDictionaryImage = mockPullDictImage;
    this.pushDictionaryImage = mockPushDictImage;
  }),
}));

// Store mocks — capturing calls for verification
let mockApplyAnnotationCalls: ReplicaRow[] = [];
let mockApplyQuoteCalls: ReplicaRow[] = [];
let mockApplyDictEntryCalls: ReplicaRow[] = [];
let mockApplyDictOccurrenceCalls: ReplicaRow[] = [];
let mockAnnotationOutbox: ReplicaRow[] = [];
let mockQuoteOutbox: ReplicaRow[] = [];
let mockDictOutbox: ReplicaRow[] = [];

function resetStoreMocks() {
  mockApplyAnnotationCalls = [];
  mockApplyQuoteCalls = [];
  mockApplyDictEntryCalls = [];
  mockApplyDictOccurrenceCalls = [];
  mockAnnotationOutbox = [];
  mockQuoteOutbox = [];
  mockDictOutbox = [];
}

vi.mock('@/store/annotacionesStore', () => ({
  useAnotacionesStore: {
    getState: () => ({
      applyRemoteAnnotation: (row: ReplicaRow) => {
        mockApplyAnnotationCalls.push(row);
      },
      replicaOutbox: mockAnnotationOutbox,
    }),
    setState: (state: { replicaOutbox: ReplicaRow[] }) => {
      mockAnnotationOutbox = state.replicaOutbox;
    },
  },
}));

vi.mock('@/store/citasStore', () => ({
  useCitasStore: {
    getState: () => ({
      applyRemoteQuote: (row: ReplicaRow) => {
        mockApplyQuoteCalls.push(row);
      },
      replicaOutbox: mockQuoteOutbox,
    }),
    setState: (state: { replicaOutbox: ReplicaRow[] }) => {
      mockQuoteOutbox = state.replicaOutbox;
    },
  },
}));

vi.mock('@/store/dictionaryStore', () => ({
  useDictionaryStore: {
    getState: () => ({
      applyRemoteDictionaryEntry: (row: ReplicaRow) => {
        mockApplyDictEntryCalls.push(row);
      },
      applyRemoteDictionaryOccurrence: (row: ReplicaRow) => {
        mockApplyDictOccurrenceCalls.push(row);
      },
      replicaOutbox: mockDictOutbox,
    }),
    setState: (state: { replicaOutbox: ReplicaRow[] }) => {
      mockDictOutbox = state.replicaOutbox;
    },
  },
}));

// Settings store — returns configurable settings
let settingState: {
  webdav?: {
    enabled?: boolean;
    serverUrl?: string;
    username?: string;
    password?: string;
    rootPath?: string;
  };
  replicaDeviceId?: string;
  lastSyncedAtReplicas?: Record<string, string>;
  syncCategories?: Partial<Record<string, boolean>>;
} = {};

function setSettings(s: typeof settingState) {
  settingState = s;
}

function mockSettingsStoreState() {
  return {
    settings: {
      webdav: settingState.webdav ?? {},
      replicaDeviceId: settingState.replicaDeviceId,
      lastSyncedAtReplicas: settingState.lastSyncedAtReplicas ?? {},
      syncCategories: settingState.syncCategories ?? {},
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsStoreState(),
  },
}));

// Mock environmentConfig.getAppService for dictionary image sync tests
const mockReadFile = vi.fn<(path: string, scope: string, mode: string) => Promise<unknown>>();
const mockWriteFile = vi.fn<(path: string, scope: string, data: unknown) => Promise<void>>();

vi.mock('@/services/environment', () => ({
  default: {
    getAppService: vi.fn().mockResolvedValue({
      readFile: mockReadFile,
      writeFile: mockWriteFile,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HLC_A = '0000000000001-00000001-test-dev' as Hlc;
const HLC_B = '0000000000002-00000001-test-dev' as Hlc;

function makeRow(id: string, hlc: Hlc, kind: string = 'annotation'): ReplicaRow {
  return {
    user_id: '',
    kind,
    replica_id: `${kind}:${id}`,
    fields_jsonb: {
      text: { v: `text-${id}`, t: hlc, s: 'dev' },
    },
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: hlc,
    schema_version: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReplicaSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreMocks();
    setSettings({
      webdav: {
        enabled: true,
        serverUrl: 'https://dav.example.com',
        username: 'user',
        password: 'pass',
        rootPath: '/',
      },
      replicaDeviceId: 'test-dev',
      lastSyncedAtReplicas: {},
      syncCategories: {
        annotation: true,
        quote: true,
        'dictionary-entry': true,
      },
    });
    mockPull.mockResolvedValue([]);
    mockPush.mockResolvedValue(undefined);
    mockPullDictImage.mockResolvedValue(null);
    mockPushDictImage.mockResolvedValue({ uploaded: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pulls replicas for each enabled kind on mount', async () => {
    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // Should pull all 3 supported kinds
    expect(mockPull).toHaveBeenCalledWith('annotation', undefined);
    expect(mockPull).toHaveBeenCalledWith('quote', undefined);
    expect(mockPull).toHaveBeenCalledWith('dictionary-entry', undefined);
  });

  it('applies remote rows from pull to the stores', async () => {
    const remoteRow = makeRow('annot-remote', HLC_B, 'annotation');
    mockPull.mockImplementation((kind) => {
      if (kind === 'annotation') return Promise.resolve([remoteRow]);
      return Promise.resolve([]);
    });

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // The remote annotation row should have been applied
    expect(mockApplyAnnotationCalls).toHaveLength(1);
    expect(mockApplyAnnotationCalls[0]!.replica_id).toBe('annotation:annot-remote');
  });

  it('pushes outbox rows after applying remote rows', async () => {
    const outboxRow = makeRow('annot-local', HLC_A, 'annotation');
    mockAnnotationOutbox.push(outboxRow);

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // After apply + drain, the outbox should be pushed
    expect(mockPush).toHaveBeenCalledWith('annotation', [outboxRow]);
  });

  it('skips disabled kinds based on syncCategories', async () => {
    setSettings({
      webdav: {
        enabled: true,
        serverUrl: 'https://dav.example.com',
        username: 'user',
        password: 'pass',
        rootPath: '/',
      },
      syncCategories: {
        annotation: true,
        quote: false, // quote disabled
        'dictionary-entry': false, // dictionary-entry disabled
      },
    });

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // Only annotation should be pulled
    expect(mockPull).toHaveBeenCalledTimes(1);
    expect(mockPull).toHaveBeenCalledWith('annotation', undefined);
    expect(mockPull).not.toHaveBeenCalledWith('quote', expect.anything());
    expect(mockPull).not.toHaveBeenCalledWith('dictionary-entry', expect.anything());
  });

  it('does nothing when WebDAV is not configured', async () => {
    setSettings({
      webdav: { enabled: false },
    });

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    expect(mockPull).not.toHaveBeenCalled();
  });

  it('clears outbox after successful push', async () => {
    const outboxRow = makeRow('annot-local', HLC_A, 'annotation');
    mockAnnotationOutbox.push(outboxRow);

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // After push, outbox should be cleared
    expect(mockAnnotationOutbox).toEqual([]);
  });

  it('handles pull failures without breaking other kinds', async () => {
    mockPull.mockImplementation((kind) => {
      if (kind === 'annotation') return Promise.reject(new Error('network error'));
      return Promise.resolve([]);
    });

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    // Should not throw
    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // Quote and dictionary-entry pulls should still happen
    expect(mockPull).toHaveBeenCalledTimes(3);
  });

  it('returns isSyncing and lastError state', async () => {
    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    let result: { current: { isSyncing: boolean; lastError: Error | null } };
    await act(async () => {
      const rendered = renderHook(() => useReplicaSync());
      result = rendered.result;
    });

    // After sync completes, isSyncing should be false
    expect(result!.current.isSyncing).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Transport parameter — custom transport support
  // ---------------------------------------------------------------------------

  it('uses the provided transport instead of the default WebDAV transport', async () => {
    const customPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
    const customPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
    customPull.mockResolvedValue([]);
    customPush.mockResolvedValue(undefined);

    const customTransport: SyncTransport = {
      kind: 'wifi',
      pull: customPull,
      push: customPush,
    };

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync({ transport: customTransport }));
    });

    // Custom transport's pull should be called for all 3 enabled kinds
    expect(customPull).toHaveBeenCalledWith('annotation', undefined);
    expect(customPull).toHaveBeenCalledWith('quote', undefined);
    expect(customPull).toHaveBeenCalledWith('dictionary-entry', undefined);

    // Default WebDAV transport's pull should NOT be called
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('falls back to WebDAVTransport when no transport is provided', async () => {
    mockPull.mockResolvedValue([]);
    mockPush.mockResolvedValue(undefined);

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // Default WebDAV transport should be used
    expect(mockPull).toHaveBeenCalled();
  });

  it('applies remote rows pulled via the custom transport', async () => {
    const remoteRow = makeRow('annot-custom', HLC_B, 'annotation');
    const customPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
    customPull.mockImplementation((kind) => {
      if (kind === 'annotation') return Promise.resolve([remoteRow]);
      return Promise.resolve([]);
    });
    const customPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
    customPush.mockResolvedValue(undefined);

    const customTransport: SyncTransport = {
      kind: 'wifi',
      pull: customPull,
      push: customPush,
    };

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync({ transport: customTransport }));
    });

    // The remote row should have been applied to the store
    expect(mockApplyAnnotationCalls).toHaveLength(1);
    expect(mockApplyAnnotationCalls[0]!.replica_id).toBe('annotation:annot-custom');
  });

  it('pushes outbox rows through the custom transport', async () => {
    const outboxRow = makeRow('annot-local', HLC_A, 'annotation');
    mockAnnotationOutbox.push(outboxRow);

    const customPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
    customPull.mockResolvedValue([]);
    const customPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
    customPush.mockResolvedValue(undefined);

    const customTransport: SyncTransport = {
      kind: 'usb',
      pull: customPull,
      push: customPush,
    };

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync({ transport: customTransport }));
    });

    // Custom transport's push should be called with the outbox row
    expect(customPush).toHaveBeenCalledWith('annotation', [outboxRow]);
  });

  it('updates cursor after sync via custom transport', async () => {
    const remoteRow = makeRow('annot-cursor', HLC_B, 'annotation');

    const customPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
    customPull.mockImplementation((kind) => {
      if (kind === 'annotation') return Promise.resolve([remoteRow]);
      return Promise.resolve([]);
    });
    const customPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
    customPush.mockResolvedValue(undefined);

    const customTransport: SyncTransport = {
      kind: 'wifi',
      pull: customPull,
      push: customPush,
    };

    // Spy on setSettings to verify cursor advancement
    const setSettingsSpy = vi.fn();
    const saveSettingsSpy = vi.fn().mockResolvedValue(undefined);

    // Override the settings store mock for this test
    const originalGetState = vi.mocked(
      (await import('@/store/settingsStore')).useSettingsStore,
    ).getState;
    vi.mocked((await import('@/store/settingsStore')).useSettingsStore).getState = () => ({
      ...originalGetState(),
      setSettings: setSettingsSpy,
      saveSettings: saveSettingsSpy,
    });

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync({ transport: customTransport }));
    });

    // Cursor should have been advanced
    expect(setSettingsSpy).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Dictionary image sync — pullDictionaryImage / pushDictionaryImage
  // ---------------------------------------------------------------------------

  it('calls pullDictionaryImage when remote dictionary entry has an imagePath', async () => {
    const dictRow = makeRow('dict-img', HLC_B, 'dictionary-entry');
    dictRow.fields_jsonb['imagePath'] = { v: 'dict-images/entry.png', t: HLC_B, s: 'dev' };

    const customPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
    customPull.mockImplementation((kind) => {
      if (kind === 'dictionary-entry') return Promise.resolve([dictRow]);
      return Promise.resolve([]);
    });
    const customPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
    customPush.mockResolvedValue(undefined);
    const customPullDictImage = vi.fn<(entryId: string) => Promise<ArrayBuffer | null>>();
    customPullDictImage.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const customPushDictImage =
      vi.fn<(entryId: string, bytes: ArrayBuffer) => Promise<{ uploaded: boolean }>>();
    customPushDictImage.mockResolvedValue({ uploaded: true });

    // readFile should report the local file doesn't exist (triggers pull)
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const customTransport: SyncTransport = {
      kind: 'wifi',
      pull: customPull,
      push: customPush,
      pullDictionaryImage: customPullDictImage,
      pushDictionaryImage: customPushDictImage,
    };

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync({ transport: customTransport }));
    });

    // pullDictionaryImage should be called for the entry with imagePath
    expect(customPullDictImage).toHaveBeenCalledWith('dict-img');
  });

  it('calls pushDictionaryImage when outbox has dictionary entry with imagePath', async () => {
    const outboxRow = makeRow('dict-outbox', HLC_A, 'dictionary-entry');
    outboxRow.fields_jsonb['imagePath'] = { v: 'dict-images/outbox.png', t: HLC_A, s: 'dev' };
    mockDictOutbox.push(outboxRow);

    const imageBytes = new Uint8Array([10, 20, 30, 40]).buffer;
    mockReadFile.mockResolvedValue(imageBytes);

    const customPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
    customPull.mockResolvedValue([]);
    const customPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
    customPush.mockResolvedValue(undefined);
    const customPushDictImage =
      vi.fn<(entryId: string, bytes: ArrayBuffer) => Promise<{ uploaded: boolean }>>();
    customPushDictImage.mockResolvedValue({ uploaded: true });

    const customTransport: SyncTransport = {
      kind: 'usb',
      pull: customPull,
      push: customPush,
      pushDictionaryImage: customPushDictImage,
    };

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync({ transport: customTransport }));
    });

    // pushDictionaryImage should be called with the entry's image bytes
    expect(customPushDictImage).toHaveBeenCalledWith('dict-outbox', imageBytes);
  });

  it('does not crash when transport lacks binary methods', async () => {
    const dictRow = makeRow('dict-no-bin', HLC_B, 'dictionary-entry');
    dictRow.fields_jsonb['imagePath'] = { v: 'dict-images/missing.png', t: HLC_B, s: 'dev' };

    const customPull = vi.fn<(kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
    customPull.mockImplementation((kind) => {
      if (kind === 'dictionary-entry') return Promise.resolve([dictRow]);
      return Promise.resolve([]);
    });
    const customPush = vi.fn<(kind: string, rows: ReplicaRow[]) => Promise<void>>();
    customPush.mockResolvedValue(undefined);

    // readFile fails — but pullDictionaryImage is undefined, so the
    // hook should skip the image pull gracefully without crashing.
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    // Minimal transport WITHOUT binary methods
    const customTransport: SyncTransport = {
      kind: 'wifi',
      pull: customPull,
      push: customPush,
      // No pullDictionaryImage / pushDictionaryImage
    };

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    // Should not throw
    await act(async () => {
      renderHook(() => useReplicaSync({ transport: customTransport }));
    });

    // Should still have applied the dictionary entry row
    expect(mockApplyDictEntryCalls).toHaveLength(1);
  });
});
