/**
 * localSyncUtils tests.
 *
 * Tests: filterReachablePeers, createPeerTransport, runSyncCycle (seed +
 * incremental + SyncResult + onStep).
 * Run with: npx vitest run src/__tests__/services/sync/localSyncUtils.test.ts
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { peerKey } from '@/store/localSyncStore';
import type { PeerInfo } from '@/types/settings';
import type { ReplicaRow, Hlc, SyncError, SyncStep } from '@/types/replica';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import type { SyncCategory } from '@/types/settings';
import type { VisibleSeedProvider } from '@/services/sync/visibleSeedRepository';

const mockDefaultVisibleSeedProvider = vi.hoisted(() => vi.fn<VisibleSeedProvider>());

vi.mock('@/services/sync/visibleSeedRepository', () => ({
  defaultVisibleSeedProvider: mockDefaultVisibleSeedProvider,
}));

// ---------------------------------------------------------------------------
// Mock stores for runSyncCycle testing
// ---------------------------------------------------------------------------

const mockGetAllAnnotations = vi.fn<() => ReplicaRow[]>(() => []);
const mockGetAllQuotes = vi.fn<() => ReplicaRow[]>(() => []);
const mockGetAllDictionaryEntries = vi.fn<() => ReplicaRow[]>(() => []);

const mockAnotacionesStore = {
  applyRemoteAnnotation: vi.fn(),
  replicaOutbox: [] as ReplicaRow[],
  getAllReplicas: mockGetAllAnnotations,
};
const mockCitasStore = {
  applyRemoteQuote: vi.fn(),
  replicaOutbox: [] as ReplicaRow[],
  getAllReplicas: mockGetAllQuotes,
};
const mockDictionaryStore = {
  applyRemoteDictionaryEntry: vi.fn(),
  applyRemoteDictionaryOccurrence: vi.fn(),
  replicaOutbox: [] as ReplicaRow[],
  getAllReplicas: mockGetAllDictionaryEntries,
};
const mockSaveSettings = vi.fn().mockResolvedValue(undefined);

const mockSettingsState: {
  settings: {
    lastSyncedAtReplicas: Record<string, Hlc | undefined>;
    localSyncCursors: Record<string, Record<string, string>>;
    replicaDeviceId: string;
  };
  setSettings: (next: {
    lastSyncedAtReplicas: Record<string, Hlc | undefined>;
    localSyncCursors?: Record<string, Record<string, string>>;
    replicaDeviceId?: string;
  }) => void;
  saveSettings: typeof mockSaveSettings;
} = {
  settings: {
    lastSyncedAtReplicas: {} as Record<string, Hlc | undefined>,
    localSyncCursors: {} as Record<string, Record<string, string>>,
    replicaDeviceId: 'test-dev',
  },
  setSettings: (next) => {
    mockSettingsState.settings = { ...mockSettingsState.settings, ...next };
  },
  saveSettings: mockSaveSettings,
};

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
    setState: vi.fn((_partial: unknown) => {}),
  },
}));

vi.mock('@/store/annotacionesStore', () => ({
  useAnotacionesStore: {
    getState: () => mockAnotacionesStore,
    setState: vi.fn((partial: Partial<typeof mockAnotacionesStore>) => {
      Object.assign(mockAnotacionesStore, partial);
    }),
  },
}));

vi.mock('@/store/citasStore', () => ({
  useCitasStore: {
    getState: () => mockCitasStore,
    setState: vi.fn((partial: Partial<typeof mockCitasStore>) => {
      Object.assign(mockCitasStore, partial);
    }),
  },
}));

vi.mock('@/store/dictionaryStore', () => ({
  useDictionaryStore: {
    getState: () => mockDictionaryStore,
    setState: vi.fn((partial: Partial<typeof mockDictionaryStore>) => {
      Object.assign(mockDictionaryStore, partial);
    }),
  },
}));

vi.mock('@/services/environment', () => ({
  default: {
    getAppService: vi.fn().mockResolvedValue({
      readFile: vi.fn().mockRejectedValue(new Error('not found')),
      writeFile: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Replica helpers
// ---------------------------------------------------------------------------

const HLC_A = '0000000000001-00000001-test-dev' as Hlc;
const HLC_B = '0000000000002-00000001-test-dev' as Hlc;
const HLC_C = '0000000000003-00000001-test-dev' as Hlc;

function makeAnnotationRow(id: string, hlc: Hlc): ReplicaRow {
  return {
    user_id: '',
    kind: 'annotation',
    replica_id: `annotation:${id}`,
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

function makeQuoteRow(id: string, hlc: Hlc): ReplicaRow {
  return {
    user_id: '',
    kind: 'quote',
    replica_id: `quote:${id}`,
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

/** Create a mock SyncTransport that returns specific rows and records pushes. */
function createMockTransport(
  overrides: Partial<SyncTransport> = {},
): SyncTransport & { pushedRows: ReplicaRow[] } {
  const pushedRows: ReplicaRow[] = [];
  return {
    kind: 'wifi',
    pull: vi.fn().mockResolvedValue([]),
    push: vi.fn(async (_kind: SyncCategory, rows: ReplicaRow[]) => {
      pushedRows.push(...rows);
    }),
    pullDictionaryImage: vi.fn().mockResolvedValue(null),
    pushDictionaryImage: vi.fn().mockResolvedValue({ uploaded: true }),
    ...overrides,
    pushedRows,
  };
}

// ---------------------------------------------------------------------------
// Imports under test (lazy)
// ---------------------------------------------------------------------------

type PeerSyncModule = typeof import('@/services/sync/localSyncUtils');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('localSyncUtils', () => {
  let mod: PeerSyncModule;

  beforeAll(async () => {
    mod = await import('@/services/sync/localSyncUtils');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnotacionesStore.replicaOutbox = [];
    mockAnotacionesStore.applyRemoteAnnotation.mockClear();
    mockCitasStore.replicaOutbox = [];
    mockCitasStore.applyRemoteQuote.mockClear();
    mockDictionaryStore.replicaOutbox = [];
    mockDictionaryStore.applyRemoteDictionaryEntry.mockClear();
    mockDictionaryStore.applyRemoteDictionaryOccurrence.mockClear();
    mockGetAllAnnotations.mockReturnValue([]);
    mockGetAllQuotes.mockReturnValue([]);
    mockGetAllDictionaryEntries.mockReturnValue([]);
    mockDefaultVisibleSeedProvider.mockReset();
    mockDefaultVisibleSeedProvider.mockResolvedValue([]);
    mockSettingsState.settings = {
      lastSyncedAtReplicas: {},
      localSyncCursors: {},
      replicaDeviceId: 'test-dev',
    };
    mockSaveSettings.mockClear();
  });

  // ── filterReachablePeers ──────────────────────────────────────────────

  describe('filterReachablePeers', () => {
    it('returns only USB peers with reachable=true in peerHealth', () => {
      const peers: PeerInfo[] = [
        { host: 'localhost', port: 7878, deviceName: 'USB Device A', version: '1.0', kind: 'usb' },
        { host: '127.0.0.1', port: 7879, deviceName: 'USB Device B', version: '1.0', kind: 'usb' },
        {
          host: '192.168.1.7',
          port: 7878,
          deviceName: 'WiFi Device C',
          version: '1.0',
          kind: 'wifi',
        },
      ];
      const peerHealth = {
        [peerKey('localhost', 7878)]: { reachable: true },
        [peerKey('127.0.0.1', 7879)]: { reachable: false },
        [peerKey('192.168.1.7', 7878)]: { reachable: true },
      };

      const result = mod.filterReachablePeers(peers, peerHealth);

      expect(result).toHaveLength(1);
      expect(result[0]!.host).toBe('localhost');
      expect(result[0]!.kind).toBe('usb');
    });

    it('returns empty array when no peers are reachable', () => {
      const peers: PeerInfo[] = [
        { host: '10.0.0.1', port: 7878, deviceName: 'Device X', version: '1.0' },
      ];
      const peerHealth = { [peerKey('10.0.0.1', 7878)]: { reachable: false } };

      const result = mod.filterReachablePeers(peers, peerHealth);

      expect(result).toEqual([]);
    });

    it('excludes peers with unknown health (no entry in peerHealth)', () => {
      const peers: PeerInfo[] = [
        { host: '192.168.1.5', port: 7878, deviceName: 'Device A', version: '1.0' },
      ];
      // Do NOT call setPeerReachable — health is unknown

      const result = mod.filterReachablePeers(peers, {});

      expect(result).toEqual([]);
    });

    // ── USB peer filter (Task 1.1 RED — new test cases) ──────────────

    it('includes USB peer on localhost when reachable (R6)', () => {
      const peer: PeerInfo = {
        host: 'localhost',
        port: 7878,
        deviceName: 'USB Phone',
        version: '1.0',
        kind: 'usb',
        reachable: true,
      };
      const peerHealth = { [peerKey('localhost', 7878)]: { reachable: true } };

      const result = mod.filterReachablePeers([peer], peerHealth);

      expect(result).toHaveLength(1);
      expect(result[0]!.host).toBe('localhost');
      expect(result[0]!.kind).toBe('usb');
    });

    it('excludes WiFi peer on localhost even when reachable (R7)', () => {
      const peer: PeerInfo = {
        host: '127.0.0.1',
        port: 7878,
        deviceName: 'Self WiFi',
        version: '1.0',
        kind: 'wifi',
        reachable: true,
      };
      const peerHealth = { [peerKey('127.0.0.1', 7878)]: { reachable: true } };

      const result = mod.filterReachablePeers([peer], peerHealth);

      expect(result).toEqual([]);
    });

    it('includes USB peer on IPv6 loopback when reachable', () => {
      const peer: PeerInfo = {
        host: '::1',
        port: 7878,
        deviceName: 'USB Tablet IPv6',
        version: '1.0',
        kind: 'usb',
        reachable: true,
      };
      const peerHealth = { [peerKey('::1', 7878)]: { reachable: true } };

      const result = mod.filterReachablePeers([peer], peerHealth);

      expect(result).toHaveLength(1);
      expect(result[0]!.kind).toBe('usb');
    });

    it('excludes WiFi peer with normal IP because local sync is USB-only', () => {
      const peer: PeerInfo = {
        host: '192.168.1.100',
        port: 7878,
        deviceName: 'WiFi Tablet',
        version: '1.0',
        kind: 'wifi',
        reachable: true,
      };
      const peerHealth = { [peerKey('192.168.1.100', 7878)]: { reachable: true } };

      const result = mod.filterReachablePeers([peer], peerHealth);

      expect(result).toEqual([]);
    });
  });

  // ── createPeerTransport ───────────────────────────────────────────────

  describe('createPeerTransport', () => {
    it('rejects peers with kind "wifi" because local sync is USB-only', () => {
      const peer: PeerInfo = {
        host: '192.168.1.5',
        port: 7878,
        deviceName: 'Device',
        version: '1.0',
        kind: 'wifi',
      };

      expect(() => mod.createPeerTransport(peer)).toThrow('USB-only');
    });

    it('rejects peers without kind because implicit WiFi fallback is disabled', () => {
      const peer: PeerInfo = {
        host: '192.168.1.5',
        port: 7878,
        deviceName: 'Device',
        version: '1.0',
      };

      expect(() => mod.createPeerTransport(peer)).toThrow('USB-only');
    });

    it('creates a USBHttpTransport for peers with kind "usb"', () => {
      const peer: PeerInfo = {
        host: 'localhost',
        port: 7878,
        deviceName: 'Device',
        version: '1.0',
        kind: 'usb',
      };

      const transport = mod.createPeerTransport(peer);

      expect(transport.kind).toBe('usb');
    });

    it('creates a USBHttpTransport for 127.0.0.1 peer with kind usb', () => {
      const peer: PeerInfo = {
        host: '127.0.0.1',
        port: 7878,
        deviceName: 'Device',
        version: '1.0',
        kind: 'usb',
      };

      const transport = mod.createPeerTransport(peer);

      expect(transport.kind).toBe('usb');
    });

    it('creates a USBHttpTransport for ::1 peer with kind usb', () => {
      const peer: PeerInfo = {
        host: '::1',
        port: 7878,
        deviceName: 'Device',
        version: '1.0',
        kind: 'usb',
      };

      const transport = mod.createPeerTransport(peer);

      expect(transport.kind).toBe('usb');
    });
  });

  // ── runSyncCycle — incremental sync (backward compat, existing behavior) ──

  describe('runSyncCycle', () => {
    const SYNC_KINDS: SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];
    const PEER_ID = '192.168.1.41:7878';

    it('pushes local USB outbox rows before pulling full remote rows', async () => {
      const order: string[] = [];
      const localDelete = {
        ...makeAnnotationRow('deleted-before-pull', HLC_C),
        deleted_at_ts: HLC_C,
      };
      const staleRemoteLive = makeAnnotationRow('deleted-before-pull', HLC_A);
      mockAnotacionesStore.replicaOutbox = [localDelete];
      const transport = createMockTransport({
        kind: 'usb',
        push: vi.fn(async (_kind: SyncCategory, rows: ReplicaRow[]) => {
          order.push(`push:${rows[0]!.deleted_at_ts ?? 'live'}`);
        }),
        pull: vi.fn(async () => {
          order.push('pull');
          return [staleRemoteLive];
        }),
      });

      await mod.runSyncCycle(transport, ['annotation'], PEER_ID);

      expect(order).toEqual([`push:${HLC_C}`, 'pull']);
      expect(mockAnotacionesStore.applyRemoteAnnotation).toHaveBeenCalledWith(staleRemoteLive);
      expect(mockAnotacionesStore.replicaOutbox).toEqual([]);
    });

    it('does not push the same outbox row again when retrying after a USB pull failure', async () => {
      const outboxRow = makeAnnotationRow('push-survives-pull-failure', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];
      const firstTransport = createMockTransport({
        kind: 'usb',
        pull: vi.fn().mockRejectedValueOnce(new Error('Pull failed after local push')),
      });

      const firstResult = await mod.runSyncCycle(firstTransport, ['annotation'], PEER_ID);

      expect(firstTransport.push).toHaveBeenCalledTimes(1);
      expect(firstTransport.push).toHaveBeenCalledWith('annotation', [outboxRow]);
      expect(firstResult.errors[0]!.message).toContain('Pull failed after local push');
      expect(mockAnotacionesStore.replicaOutbox).toEqual([]);

      const retryTransport = createMockTransport({ kind: 'usb' });
      await mod.runSyncCycle(retryTransport, ['annotation'], PEER_ID);

      expect(retryTransport.push).not.toHaveBeenCalled();
    });

    it('calls transport.pull for each configured kind', async () => {
      const transport = createMockTransport();

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      expect(transport.pull).toHaveBeenCalledTimes(3);
      expect(transport.pull).toHaveBeenCalledWith('annotation', undefined);
      expect(transport.pull).toHaveBeenCalledWith('quote', undefined);
      expect(transport.pull).toHaveBeenCalledWith('dictionary-entry', undefined);
    });

    it('applies pulled annotation rows to the annotation store', async () => {
      const transport = createMockTransport();
      const row = makeAnnotationRow('a1', HLC_A);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      expect(mockAnotacionesStore.applyRemoteAnnotation).toHaveBeenCalledTimes(1);
      expect(mockAnotacionesStore.applyRemoteAnnotation).toHaveBeenCalledWith(row);
    });

    it('applies pulled quote rows to the quote store', async () => {
      const transport = createMockTransport();
      const row = makeQuoteRow('q1', HLC_A);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      expect(mockCitasStore.applyRemoteQuote).toHaveBeenCalledTimes(1);
      expect(mockCitasStore.applyRemoteQuote).toHaveBeenCalledWith(row);
    });

    it('applies pulled dictionary-entry rows to both entry and occurrence methods', async () => {
      const transport = createMockTransport();
      const row: ReplicaRow = {
        user_id: '',
        kind: 'dictionary-entry',
        replica_id: 'dictionary-entry:dict-1',
        fields_jsonb: {
          term: { v: 'hello', t: HLC_A, s: 'dev' },
        },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: HLC_A,
        schema_version: 1,
      };
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      expect(mockDictionaryStore.applyRemoteDictionaryEntry).toHaveBeenCalledTimes(1);
      expect(mockDictionaryStore.applyRemoteDictionaryEntry).toHaveBeenCalledWith(row);
      expect(mockDictionaryStore.applyRemoteDictionaryOccurrence).toHaveBeenCalledTimes(1);
      expect(mockDictionaryStore.applyRemoteDictionaryOccurrence).toHaveBeenCalledWith(row);
    });

    it('drains the annotation outbox and pushes to transport', async () => {
      const transport = createMockTransport();
      const outboxRow = makeAnnotationRow('out-1', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      // Outbox should be cleared
      expect(mockAnotacionesStore.replicaOutbox).toEqual([]);
      // Transport push should have been called with the outbox row
      expect(transport.pushedRows).toContainEqual(outboxRow);
    });

    it('drains the quote outbox and pushes to transport', async () => {
      const transport = createMockTransport();
      const outboxRow = makeQuoteRow('out-q', HLC_B);
      mockCitasStore.replicaOutbox = [outboxRow];

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      expect(mockCitasStore.replicaOutbox).toEqual([]);
      expect(transport.pushedRows).toContainEqual(outboxRow);
    });

    it('does not call push when outbox is empty for all kinds', async () => {
      const transport = createMockTransport();

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      expect(transport.push).not.toHaveBeenCalled();
    });

    // ── PR3: dictionary-occurrence outbox routing ───────────────────────

    it('drainOutboxRows for dictionary-entry filters out occurrence rows (PR3)', async () => {
      const entryRow: ReplicaRow = {
        ...makeAnnotationRow('not-used', HLC_A),
        kind: 'dictionary-entry',
        replica_id: 'dictionary-entry:entry-1',
        fields_jsonb: { term: { v: 'hello', t: HLC_A, s: 'dev' } },
      };
      const occurrenceRow: ReplicaRow = {
        ...makeAnnotationRow('not-used', HLC_B),
        kind: 'dictionary-occurrence',
        replica_id: 'dictionary-occurrence:occ-1',
        fields_jsonb: { entryId: { v: 'entry-1', t: HLC_B, s: 'dev' } },
      };
      // Both rows in the dictionary outbox
      mockDictionaryStore.replicaOutbox = [entryRow, occurrenceRow];

      const transport = createMockTransport({ kind: 'usb' });

      await mod.runSyncCycle(transport, ['dictionary-entry', 'dictionary-occurrence'], PEER_ID);

      // dictionary-entry push should contain only the entry row
      expect(transport.push).toHaveBeenCalledWith('dictionary-entry', [entryRow]);
      // dictionary-occurrence push should contain only the occurrence row
      expect(transport.push).toHaveBeenCalledWith('dictionary-occurrence', [occurrenceRow]);
      // Total pushes: 2 (one per kind)
      expect(transport.push).toHaveBeenCalledTimes(2);
    });

    it('drainOutboxRows for dictionary-entry re-queues occurrence rows in outbox (PR3)', async () => {
      const entryRow: ReplicaRow = {
        ...makeAnnotationRow('not-used', HLC_A),
        kind: 'dictionary-entry',
        replica_id: 'dictionary-entry:entry-1',
        fields_jsonb: { term: { v: 'hello', t: HLC_A, s: 'dev' } },
      };
      const occurrenceRow: ReplicaRow = {
        ...makeAnnotationRow('not-used', HLC_B),
        kind: 'dictionary-occurrence',
        replica_id: 'dictionary-occurrence:occ-1',
        fields_jsonb: { entryId: { v: 'entry-1', t: HLC_B, s: 'dev' } },
      };
      // Only run dictionary-entry sync — occurrence rows should remain
      mockDictionaryStore.replicaOutbox = [entryRow, occurrenceRow];

      const transport = createMockTransport({ kind: 'usb' });
      await mod.runSyncCycle(transport, ['dictionary-entry'], PEER_ID);

      // Entry was pushed
      expect(transport.push).toHaveBeenCalledWith('dictionary-entry', [entryRow]);
      // Occurrence was NOT pushed (not in kinds) and stayed in outbox
      expect(mockDictionaryStore.replicaOutbox).toContainEqual(occurrenceRow);
      expect(mockDictionaryStore.replicaOutbox).not.toContainEqual(entryRow);
    });

    it('applies pulled dictionary-occurrence rows via applyRemoteDictionaryOccurrence only (PR3)', async () => {
      const transport = createMockTransport();
      const occRow: ReplicaRow = {
        ...makeAnnotationRow('not-used', HLC_C),
        kind: 'dictionary-occurrence',
        replica_id: 'dictionary-occurrence:occ-pulled',
        fields_jsonb: {
          entryId: { v: 'entry-pulled', t: HLC_C, s: 'dev' },
          selectedText: { v: 'pulled text', t: HLC_C, s: 'dev' },
        },
      };
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([occRow]);

      await mod.runSyncCycle(transport, ['dictionary-occurrence'], PEER_ID);

      expect(mockDictionaryStore.applyRemoteDictionaryOccurrence).toHaveBeenCalledTimes(1);
      expect(mockDictionaryStore.applyRemoteDictionaryOccurrence).toHaveBeenCalledWith(occRow);
      // applyRemoteDictionaryEntry should NOT be called for occurrence rows
      expect(mockDictionaryStore.applyRemoteDictionaryEntry).not.toHaveBeenCalled();
    });

    it('continues to next kind even when pull fails for one kind (errors in SyncResult)', async () => {
      const transport = createMockTransport();
      (transport.pull as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue([])
        .mockResolvedValue([]);

      // Should not throw
      const result = await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);
      expect(result).toBeDefined();

      // Should still have called pull for all kinds (quote and dictionary still attempted)
      expect(transport.pull).toHaveBeenCalledTimes(3);

      // Error should be captured in result.errors[]
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.peerId).toBe(PEER_ID);
      expect(result.errors[0]!.kind).toBe('annotation');
      expect(result.errors[0]!.message).toContain('Network error');
    });

    it('puts outbox rows back on push failure (retry safety)', async () => {
      const transport = createMockTransport();
      const outboxRow = makeAnnotationRow('retry-1', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];
      (transport.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Push failed'));

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      // The outbox row should be restored
      expect(mockAnotacionesStore.replicaOutbox).toContainEqual(outboxRow);
    });

    it('advances the HLC cursor for the peer after a successful sync (R4)', async () => {
      const transport = createMockTransport();
      const row = makeAnnotationRow('cursor-1', HLC_B);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await mod.runSyncCycle(transport, SYNC_KINDS, PEER_ID);

      // The cursor for annotation should be updated in localSyncCursors[peerId]
      const cursors = mockSettingsState.settings.localSyncCursors[PEER_ID];
      expect(cursors).toBeDefined();
      expect(cursors!['annotation']).toBe(HLC_B);
    });

    it('does not sync annotation when it is not in the kinds list', async () => {
      const transport = createMockTransport();
      const kinds: SyncCategory[] = ['quote', 'dictionary-entry'];

      await mod.runSyncCycle(transport, kinds, PEER_ID);

      expect(transport.pull).toHaveBeenCalledTimes(2);
      expect(transport.pull).toHaveBeenCalledWith('quote', undefined);
      expect(transport.pull).toHaveBeenCalledWith('dictionary-entry', undefined);
      expect(transport.pull).not.toHaveBeenCalledWith('annotation', expect.anything());
    });

    it('mid-batch interruption: retry does not re-push already-successful outbox rows', async () => {
      const annRow = makeAnnotationRow('ann-midbatch', HLC_B);
      const quoteRow = makeQuoteRow('quote-midbatch', HLC_B);
      mockAnotacionesStore.replicaOutbox = [annRow];
      mockCitasStore.replicaOutbox = [quoteRow];

      // First cycle: annotation push succeeds, quote push fails (connection drop mid-batch)
      const firstTransport = createMockTransport({
        kind: 'usb',
        push: vi.fn(async (kind: SyncCategory) => {
          if (kind === 'quote') {
            throw new Error('Connection dropped mid-batch');
          }
        }),
      });

      const firstResult = await mod.runSyncCycle(firstTransport, ['annotation', 'quote'], PEER_ID);

      // Annotation was drained and pushed successfully
      expect(mockAnotacionesStore.replicaOutbox).toEqual([]);
      expect(firstTransport.push).toHaveBeenCalledWith('annotation', [annRow]);

      // Quote was drained, push failed, rows restored for retry
      expect(mockCitasStore.replicaOutbox).toContainEqual(quoteRow);
      expect(firstTransport.push).toHaveBeenCalledWith('quote', [quoteRow]);

      // Error from the quote push is captured in the result
      expect(firstResult.errors.length).toBeGreaterThan(0);
      expect(firstResult.errors.some((e) => e.message.includes('mid-batch'))).toBe(true);

      // ── Retry ──────────────────────────────────────────────
      const retryTransport = createMockTransport({ kind: 'usb' });
      await mod.runSyncCycle(retryTransport, ['annotation', 'quote'], PEER_ID);

      // Annotation outbox was already drained — must NOT be re-pushed
      expect(retryTransport.push).not.toHaveBeenCalledWith('annotation', expect.anything());

      // Quote rows were restored and should be pushed on retry
      expect(retryTransport.push).toHaveBeenCalledWith('quote', [quoteRow]);
    });
  });

  // ── runSyncCycle — SyncResult structure ────────────────────────────────

  describe('runSyncCycle SyncResult', () => {
    const PEER_ID = 'another-peer:7878';

    it('returns SyncResult with peerId, kinds, errors, timestamps', async () => {
      const transport = createMockTransport();

      const result = await mod.runSyncCycle(transport, ['annotation'], PEER_ID);

      expect(result.peerId).toBe(PEER_ID);
      expect(result.kinds).toBeDefined();
      expect(result.kinds['annotation']).toBeDefined();
      expect(result.kinds['annotation']!.kind).toBe('annotation');
      expect(typeof result.kinds['annotation']!.pulled).toBe('number');
      expect(typeof result.kinds['annotation']!.pushed).toBe('number');
      expect(typeof result.kinds['annotation']!.conflicts).toBe('number');
      expect(result.kinds['annotation']!.conflicts).toBe(0);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.startedAt).toBe('number');
      expect(typeof result.finishedAt).toBe('number');
      expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
    });

    it('SyncResult.kinds reports correct pull/push counts', async () => {
      const transport = createMockTransport();
      const annRow = makeAnnotationRow('a1', HLC_A);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([annRow]);

      const outboxRow = makeAnnotationRow('out-1', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];

      const result = await mod.runSyncCycle(transport, ['annotation'], PEER_ID);

      expect(result.kinds['annotation']!.pulled).toBe(1);
      expect(result.kinds['annotation']!.pushed).toBe(1);
    });

    it('SyncResult includes errors from a failed pull (R16, R18)', async () => {
      const transport = createMockTransport();
      (transport.pull as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      const result = await mod.runSyncCycle(transport, ['annotation'], PEER_ID);

      expect(result.errors).toHaveLength(1);
      const err: SyncError = result.errors[0]!;
      expect(err.peerId).toBe(PEER_ID);
      expect(err.kind).toBe('annotation');
      expect(err.message).toContain('Connection refused');
      expect(typeof err.timestamp).toBe('number');
    });

    it('preserves message from object-shaped SyncError instead of rendering [object Object]', async () => {
      const transport = createMockTransport();
      (transport.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
        peerId: PEER_ID,
        kind: 'quote',
        timestamp: Date.now(),
        message: 'HTTP 500: visible repo insert failed',
      } satisfies SyncError);
      mockCitasStore.replicaOutbox = [makeQuoteRow('object-error', HLC_B)];

      const result = await mod.runSyncCycle(transport, ['quote'], PEER_ID);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toBe('HTTP 500: visible repo insert failed');
      expect(result.errors[0]!.message).not.toBe('[object Object]');
    });

    it('continues syncing other kinds after a pull error on one kind', async () => {
      const transport = createMockTransport();
      const quoteRow = makeQuoteRow('q1', HLC_B);
      (transport.pull as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Annotation pull failed')) // annotation
        .mockResolvedValueOnce([quoteRow]) // quote — succeeds
        .mockResolvedValueOnce([]); // dictionary-entry

      const result = await mod.runSyncCycle(
        transport,
        ['annotation', 'quote', 'dictionary-entry'],
        PEER_ID,
      );

      // Annotation failed, quote succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.kind).toBe('annotation');
      expect(result.kinds['annotation']!.pulled).toBe(0);
      expect(result.kinds['quote']!.pulled).toBe(1);
      // Quote was applied
      expect(mockCitasStore.applyRemoteQuote).toHaveBeenCalledTimes(1);
    });
  });

  // ── runSyncCycle — Seed (isFirstSync) ──────────────────────────────────

  describe('runSyncCycle seed behavior', () => {
    const SEED_PEER = '192.168.1.100:7878';
    const SYNC_KINDS: SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];

    beforeEach(() => {
      // Ensure no cursor exists for this peer → isFirstSync
      delete mockSettingsState.settings.localSyncCursors[SEED_PEER];
    });

    it('pulls without ?since= when no cursor exists for peer (R1, R2)', async () => {
      const transport = createMockTransport();

      await mod.runSyncCycle(transport, SYNC_KINDS, SEED_PEER);

      // Pull should have been called WITHOUT a since parameter
      expect(transport.pull).toHaveBeenCalledWith('annotation', undefined);
      expect(transport.pull).toHaveBeenCalledWith('quote', undefined);
      expect(transport.pull).toHaveBeenCalledWith('dictionary-entry', undefined);
    });

    it('pushes seed rows from the visible seed provider on first sync (R3)', async () => {
      const transport = createMockTransport();
      const seedRow1 = makeAnnotationRow('seed-a', HLC_A);
      const seedRow2 = makeAnnotationRow('seed-b', HLC_B);
      const seedProvider = vi.fn<VisibleSeedProvider>().mockResolvedValue([seedRow1, seedRow2]);

      // outbox and store are empty — proves push comes from visible seed provider
      mockAnotacionesStore.replicaOutbox = [];
      mockGetAllAnnotations.mockReturnValue([]);

      await mod.runSyncCycle(transport, ['annotation'], SEED_PEER, undefined, seedProvider);

      // The two seed rows should have been pushed
      expect(transport.push).toHaveBeenCalledTimes(1);
      expect(transport.pushedRows).toContainEqual(seedRow1);
      expect(transport.pushedRows).toContainEqual(seedRow2);
      expect(transport.pushedRows).toHaveLength(2);
      expect(mockGetAllAnnotations).not.toHaveBeenCalled();

      // SyncResult should report pushed count
    });

    it('pushes visible DB seed rows when Zustand stores are empty on first sync', async () => {
      const transport = createMockTransport();
      const visibleSeedRow = makeAnnotationRow('visible-db-a', HLC_A);
      const seedProvider = vi.fn<VisibleSeedProvider>().mockResolvedValue([visibleSeedRow]);
      mockGetAllAnnotations.mockReturnValue([]);
      mockAnotacionesStore.replicaOutbox = [];

      const result = await mod.runSyncCycle(
        transport,
        ['annotation'],
        SEED_PEER,
        undefined,
        seedProvider,
      );

      expect(seedProvider).toHaveBeenCalledWith('annotation', 'test-dev');
      expect(mockGetAllAnnotations).not.toHaveBeenCalled();
      expect(transport.push).toHaveBeenCalledTimes(1);
      expect(transport.pushedRows).toEqual([visibleSeedRow]);
      expect(result.kinds['annotation']!.pushed).toBe(1);
    });

    it('pushes outbox rows (incremental) on subsequent syncs when cursor exists (R4)', async () => {
      // Pre-set a cursor so this is NOT the first sync
      mockSettingsState.settings.localSyncCursors[SEED_PEER] = {
        annotation: HLC_A,
      };

      const transport = createMockTransport();
      const outboxRow = makeAnnotationRow('out-inc', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];

      // getAllReplicas has seed rows — should NOT be pushed (incremental sync)
      const seedRow = makeAnnotationRow('seed-x', HLC_A);
      mockGetAllAnnotations.mockReturnValue([seedRow]);

      await mod.runSyncCycle(transport, ['annotation'], SEED_PEER);

      // Only outbox row should be pushed, NOT the seed row
      expect(transport.push).toHaveBeenCalledTimes(1);
      expect(transport.pushedRows).toContainEqual(outboxRow);
      expect(transport.pushedRows).not.toContainEqual(seedRow);
      expect(transport.pushedRows).toHaveLength(1);
    });

    it('does not call the visible seed provider on subsequent syncs when cursor exists', async () => {
      mockSettingsState.settings.localSyncCursors[SEED_PEER] = {
        annotation: HLC_A,
      };
      const transport = createMockTransport();
      const outboxRow = makeAnnotationRow('out-inc-visible', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];
      const seedProvider = vi
        .fn<VisibleSeedProvider>()
        .mockResolvedValue([makeAnnotationRow('visible-db-ignored', HLC_C)]);

      await mod.runSyncCycle(transport, ['annotation'], SEED_PEER, undefined, seedProvider);

      expect(seedProvider).not.toHaveBeenCalled();
      expect(transport.pushedRows).toEqual([outboxRow]);
    });

    it('still seeds kinds that do not have a cursor when another kind already has one', async () => {
      mockSettingsState.settings.localSyncCursors[SEED_PEER] = {
        annotation: HLC_A,
      };
      const transport = createMockTransport();
      const quoteSeed = makeQuoteRow('quote-visible-seed', HLC_B);
      const seedProvider = vi.fn<VisibleSeedProvider>().mockImplementation(async (kind) => {
        if (kind === 'quote') return [quoteSeed];
        return [];
      });

      const result = await mod.runSyncCycle(
        transport,
        ['annotation', 'quote'],
        SEED_PEER,
        undefined,
        seedProvider,
      );

      expect(seedProvider).not.toHaveBeenCalledWith('annotation', expect.any(String));
      expect(seedProvider).toHaveBeenCalledWith('quote', 'test-dev');
      expect(transport.push).toHaveBeenCalledTimes(1);
      expect(transport.pushedRows).toEqual([quoteSeed]);
      expect(result.kinds['quote']!.pushed).toBe(1);
    });

    it('pull uses cursor since= for incremental sync when cursor exists', async () => {
      // Pre-set a cursor
      mockSettingsState.settings.localSyncCursors[SEED_PEER] = {
        annotation: HLC_A,
        quote: HLC_B,
        'dictionary-entry': HLC_C,
      };

      const transport = createMockTransport();

      await mod.runSyncCycle(transport, SYNC_KINDS, SEED_PEER);

      expect(transport.pull).toHaveBeenCalledWith('annotation', HLC_A);
      expect(transport.pull).toHaveBeenCalledWith('quote', HLC_B);
      expect(transport.pull).toHaveBeenCalledWith('dictionary-entry', HLC_C);
    });

    it('stores cursor after seed for subsequent incremental syncs', async () => {
      const transport = createMockTransport();
      const row = makeAnnotationRow('seed-cursor', HLC_B);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

      // First sync (seed)
      await mod.runSyncCycle(transport, ['annotation'], SEED_PEER);

      // Cursor should now exist
      const cursors = mockSettingsState.settings.localSyncCursors[SEED_PEER];
      expect(cursors).toBeDefined();
      expect(cursors!['annotation']).toBe(HLC_B);

      // Second sync should use the cursor
      const transport2 = createMockTransport();
      await mod.runSyncCycle(transport2, ['annotation'], SEED_PEER);

      expect(transport2.pull).toHaveBeenCalledWith('annotation', HLC_B);
    });

    it('stores cursor from successfully pushed seed rows even when remote is empty', async () => {
      const transport = createMockTransport();
      const seedRow = makeAnnotationRow('seed-only-cursor', HLC_C);
      const seedProvider = vi.fn<VisibleSeedProvider>().mockResolvedValue([seedRow]);

      await mod.runSyncCycle(transport, ['annotation'], SEED_PEER, undefined, seedProvider);

      const cursors = mockSettingsState.settings.localSyncCursors[SEED_PEER];
      expect(cursors).toBeDefined();
      expect(cursors!['annotation']).toBe(HLC_C);
    });
  });

  // ── runSyncCycle — onStep callback ─────────────────────────────────────

  describe('runSyncCycle onStep', () => {
    const PEER_ID = '192.168.1.50:7878';

    it('invokes onStep callback for connecting, pulling, merging, pushing, finalizing phases', async () => {
      const transport = createMockTransport();
      const row = makeAnnotationRow('step-a', HLC_A);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

      const steps: SyncStep[] = [];
      const onStep = (step: SyncStep) => {
        steps.push(step);
      };

      await mod.runSyncCycle(transport, ['annotation'], PEER_ID, onStep);

      // Should have at least connecting, pulling, merging, pushing, finalizing
      const phases = steps.map((s) => s.phase);
      expect(phases).toContain('connecting');
      expect(phases).toContain('pulling');
      expect(phases).toContain('merging');
      expect(phases).toContain('pushing');
      expect(phases).toContain('finalizing');
    });

    it('includes kind and count in pulling/pushing steps', async () => {
      const transport = createMockTransport();
      const row1 = makeAnnotationRow('count-1', HLC_A);
      const row2 = makeAnnotationRow('count-2', HLC_B);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row1, row2]);

      const pullingStep: SyncStep[] = [];
      const onStep = (step: SyncStep) => {
        if (step.phase === 'pulling') pullingStep.push(step);
      };

      await mod.runSyncCycle(transport, ['annotation'], PEER_ID, onStep);

      expect(pullingStep.length).toBeGreaterThan(0);
      const step = pullingStep[0]!;
      expect(step.kind).toBe('annotation');
      expect(step.current).toBe(2);
    });

    it('does not throw if onStep is not provided', async () => {
      const transport = createMockTransport();

      // Should not throw — onStep is optional
      await expect(mod.runSyncCycle(transport, ['annotation'], PEER_ID)).resolves.toBeDefined();
    });
  });

  // ── Dictionary image manifest validation ─────────────────────────────

  describe('dictionary-image manifest validation', () => {
    const PEER_ID = '192.168.1.50:7878';

    it('surfaces error when pulled image bytes do not match expected byteSize from manifest', async () => {
      const transport = createMockTransport();
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer;
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (transport.pullDictionaryImage as ReturnType<typeof vi.fn>).mockResolvedValue(pngBytes);

      const row: ReplicaRow = {
        user_id: '',
        kind: 'dictionary-entry',
        replica_id: 'dictionary-entry:entry-1',
        fields_jsonb: {
          imagePath: { v: 'entry-1/image.png', t: HLC_C, s: 'dev' },
        },
        manifest_jsonb: {
          files: [{ filename: 'image.png', byteSize: 999999, partialMd5: 'abc' }],
          schemaVersion: 1,
        },
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: HLC_C,
        schema_version: 1,
      };
      // Single kind → single pull call
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

      const result = await mod.runSyncCycle(transport, ['dictionary-entry'], PEER_ID);

      // Size mismatch should produce an error (not silent)
      const hasSizeError = result.errors.some(
        (e) => e.kind === 'dictionary-entry' && e.message.toLowerCase().includes('size'),
      );
      expect(hasSizeError).toBe(true);
    });

    it('surfaces retryable error when image pull returns null for a row with imagePath', async () => {
      const transport = createMockTransport();
      // pullDictionaryImage returns null (image missing on remote)
      (transport.pullDictionaryImage as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const row: ReplicaRow = {
        user_id: '',
        kind: 'dictionary-entry',
        replica_id: 'dictionary-entry:entry-missing-img',
        fields_jsonb: {
          imagePath: { v: 'entry-missing-img/image.png', t: HLC_C, s: 'dev' },
        },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: HLC_C,
        schema_version: 1,
      };
      // No local file exists
      const appService = await (await import('@/services/environment')).default.getAppService();
      (appService.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValue([row]);

      const result = await mod.runSyncCycle(transport, ['dictionary-entry'], PEER_ID);

      // Missing image should be captured as an error
      const hasMissingImageError = result.errors.some(
        (e) => e.kind === 'dictionary-entry' && e.message.toLowerCase().includes('image'),
      );
      expect(hasMissingImageError).toBe(true);
    });
  });
});
