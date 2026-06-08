import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReplicaRow, Hlc } from '@/types/replica';

// ---------------------------------------------------------------------------
// Mocks — must be defined before the dynamic import
// ---------------------------------------------------------------------------

const mockPullReplicas =
  vi.fn<(config: unknown, rootPath: string, kind: string, since?: Hlc) => Promise<ReplicaRow[]>>();
const mockPushReplicas =
  vi.fn<(config: unknown, rootPath: string, kind: string, rows: ReplicaRow[]) => Promise<void>>();

vi.mock('@/services/sync/replicaTransport', () => ({
  pullReplicas: mockPullReplicas,
  pushReplicas: mockPushReplicas,
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
    mockPullReplicas.mockResolvedValue([]);
    mockPushReplicas.mockResolvedValue(undefined);
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
    expect(mockPullReplicas).toHaveBeenCalledWith(expect.any(Object), '/', 'annotation', undefined);
    expect(mockPullReplicas).toHaveBeenCalledWith(expect.any(Object), '/', 'quote', undefined);
    expect(mockPullReplicas).toHaveBeenCalledWith(
      expect.any(Object),
      '/',
      'dictionary-entry',
      undefined,
    );
  });

  it('applies remote rows from pull to the stores', async () => {
    const remoteRow = makeRow('annot-remote', HLC_B, 'annotation');
    mockPullReplicas.mockImplementation((_c, _r, kind) => {
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
    expect(mockPushReplicas).toHaveBeenCalledWith(expect.any(Object), '/', 'annotation', [
      outboxRow,
    ]);
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
    expect(mockPullReplicas).toHaveBeenCalledTimes(1);
    expect(mockPullReplicas).toHaveBeenCalledWith(expect.any(Object), '/', 'annotation', undefined);
    expect(mockPullReplicas).not.toHaveBeenCalledWith(
      expect.any(Object),
      '/',
      'quote',
      expect.anything(),
    );
    expect(mockPullReplicas).not.toHaveBeenCalledWith(
      expect.any(Object),
      '/',
      'dictionary-entry',
      expect.anything(),
    );
  });

  it('does nothing when WebDAV is not configured', async () => {
    setSettings({
      webdav: { enabled: false },
    });

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    expect(mockPullReplicas).not.toHaveBeenCalled();
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
    mockPullReplicas.mockImplementation((_c, _r, kind) => {
      if (kind === 'annotation') return Promise.reject(new Error('network error'));
      return Promise.resolve([]);
    });

    const { useReplicaSync } = await import('@/hooks/useReplicaSync');

    // Should not throw
    await act(async () => {
      renderHook(() => useReplicaSync());
    });

    // Quote and dictionary-entry pulls should still happen
    expect(mockPullReplicas).toHaveBeenCalledTimes(3);
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
});
