/**
 * localSyncUtils tests — RED phase.
 *
 * Tests: filterReachablePeers, createPeerTransport, runSyncCycle.
 * Run with: npx vitest run src/__tests__/services/sync/localSyncUtils.test.ts
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { useLocalSyncStore, peerKey } from '@/store/localSyncStore';
import type { PeerInfo } from '@/types/settings';
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import type { SyncCategory } from '@/types/settings';

// ---------------------------------------------------------------------------
// Mock stores for runSyncCycle testing
// ---------------------------------------------------------------------------

const mockAnotacionesStore = {
  applyRemoteAnnotation: vi.fn(),
  replicaOutbox: [] as ReplicaRow[],
};
const mockCitasStore = {
  applyRemoteQuote: vi.fn(),
  replicaOutbox: [] as ReplicaRow[],
};
const mockDictionaryStore = {
  applyRemoteDictionaryEntry: vi.fn(),
  applyRemoteDictionaryOccurrence: vi.fn(),
  replicaOutbox: [] as ReplicaRow[],
};
const mockSaveSettings = vi.fn().mockResolvedValue(undefined);

const mockSettingsState: {
  settings: { lastSyncedAtReplicas: Record<string, Hlc | undefined> };
  setSettings: (next: { lastSyncedAtReplicas: Record<string, Hlc | undefined> }) => void;
  saveSettings: typeof mockSaveSettings;
} = {
  settings: {
    lastSyncedAtReplicas: {} as Record<string, Hlc | undefined>,
  },
  setSettings: (next) => {
    mockSettingsState.settings = next;
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
// Imports under test (lazy — production code does NOT exist yet in RED phase)
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
    mockSettingsState.settings = { lastSyncedAtReplicas: {} };
    mockSaveSettings.mockClear();
    useLocalSyncStore.setState({ peers: [], peerHealth: {} });
  });

  // ── filterReachablePeers ──────────────────────────────────────────────

  describe('filterReachablePeers', () => {
    it('returns only peers with reachable=true in peerHealth', () => {
      const peers: PeerInfo[] = [
        { host: '192.168.1.5', port: 7878, deviceName: 'Device A', version: '1.0' },
        { host: '192.168.1.6', port: 7878, deviceName: 'Device B', version: '1.0' },
        { host: '192.168.1.7', port: 7878, deviceName: 'Device C', version: '1.0' },
      ];
      useLocalSyncStore.getState().addPeer(peers[0]!);
      useLocalSyncStore.getState().addPeer(peers[1]!);
      useLocalSyncStore.getState().addPeer(peers[2]!);
      useLocalSyncStore.getState().setPeerReachable(peerKey('192.168.1.5', 7878), true);
      useLocalSyncStore.getState().setPeerReachable(peerKey('192.168.1.6', 7878), false);
      // peer C — no health data, UNKNOWN

      const result = mod.filterReachablePeers(
        useLocalSyncStore.getState().peers,
        useLocalSyncStore.getState().peerHealth,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.host).toBe('192.168.1.5');
    });

    it('returns empty array when no peers are reachable', () => {
      const peers: PeerInfo[] = [
        { host: '10.0.0.1', port: 7878, deviceName: 'Device X', version: '1.0' },
      ];
      useLocalSyncStore.getState().addPeer(peers[0]!);
      useLocalSyncStore.getState().setPeerReachable(peerKey('10.0.0.1', 7878), false);

      const result = mod.filterReachablePeers(
        useLocalSyncStore.getState().peers,
        useLocalSyncStore.getState().peerHealth,
      );

      expect(result).toEqual([]);
    });

    it('excludes peers with unknown health (no entry in peerHealth)', () => {
      const peers: PeerInfo[] = [
        { host: '192.168.1.5', port: 7878, deviceName: 'Device A', version: '1.0' },
      ];
      useLocalSyncStore.getState().addPeer(peers[0]!);
      // Do NOT call setPeerReachable — health is unknown

      const result = mod.filterReachablePeers(
        useLocalSyncStore.getState().peers,
        useLocalSyncStore.getState().peerHealth,
      );

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
      useLocalSyncStore.getState().addPeer(peer);
      useLocalSyncStore.getState().setPeerReachable(peerKey('localhost', 7878), true);

      const result = mod.filterReachablePeers(
        useLocalSyncStore.getState().peers,
        useLocalSyncStore.getState().peerHealth,
      );

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
      useLocalSyncStore.getState().addPeer(peer);
      useLocalSyncStore.getState().setPeerReachable(peerKey('127.0.0.1', 7878), true);

      const result = mod.filterReachablePeers(
        useLocalSyncStore.getState().peers,
        useLocalSyncStore.getState().peerHealth,
      );

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
      useLocalSyncStore.getState().addPeer(peer);
      useLocalSyncStore.getState().setPeerReachable(peerKey('::1', 7878), true);

      const result = mod.filterReachablePeers(
        useLocalSyncStore.getState().peers,
        useLocalSyncStore.getState().peerHealth,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.kind).toBe('usb');
    });

    it('WiFi peer with normal IP still passes through (behavior unchanged)', () => {
      const peer: PeerInfo = {
        host: '192.168.1.100',
        port: 7878,
        deviceName: 'WiFi Tablet',
        version: '1.0',
        kind: 'wifi',
        reachable: true,
      };
      useLocalSyncStore.getState().addPeer(peer);
      useLocalSyncStore.getState().setPeerReachable(peerKey('192.168.1.100', 7878), true);

      const result = mod.filterReachablePeers(
        useLocalSyncStore.getState().peers,
        useLocalSyncStore.getState().peerHealth,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.host).toBe('192.168.1.100');
    });
  });

  // ── createPeerTransport ───────────────────────────────────────────────

  describe('createPeerTransport', () => {
    it('creates a WiFiHttpTransport for peers with kind "wifi"', () => {
      const peer: PeerInfo = {
        host: '192.168.1.5',
        port: 7878,
        deviceName: 'Device',
        version: '1.0',
        kind: 'wifi',
      };

      const transport = mod.createPeerTransport(peer);

      expect(transport.kind).toBe('wifi');
    });

    it('creates a WiFiHttpTransport for peers without kind (backward compat)', () => {
      const peer: PeerInfo = {
        host: '192.168.1.5',
        port: 7878,
        deviceName: 'Device',
        version: '1.0',
      };

      const transport = mod.createPeerTransport(peer);

      expect(transport.kind).toBe('wifi');
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

  // ── runSyncCycle ──────────────────────────────────────────────────────

  describe('runSyncCycle', () => {
    const SYNC_KINDS: SyncCategory[] = ['annotation', 'quote', 'dictionary-entry'];

    it('calls transport.pull for each configured kind', async () => {
      const transport = createMockTransport();

      await mod.runSyncCycle(transport, SYNC_KINDS);

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

      await mod.runSyncCycle(transport, SYNC_KINDS);

      expect(mockAnotacionesStore.applyRemoteAnnotation).toHaveBeenCalledTimes(1);
      expect(mockAnotacionesStore.applyRemoteAnnotation).toHaveBeenCalledWith(row);
    });

    it('applies pulled quote rows to the quote store', async () => {
      const transport = createMockTransport();
      const row = makeQuoteRow('q1', HLC_A);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await mod.runSyncCycle(transport, SYNC_KINDS);

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

      await mod.runSyncCycle(transport, SYNC_KINDS);

      expect(mockDictionaryStore.applyRemoteDictionaryEntry).toHaveBeenCalledTimes(1);
      expect(mockDictionaryStore.applyRemoteDictionaryEntry).toHaveBeenCalledWith(row);
      expect(mockDictionaryStore.applyRemoteDictionaryOccurrence).toHaveBeenCalledTimes(1);
      expect(mockDictionaryStore.applyRemoteDictionaryOccurrence).toHaveBeenCalledWith(row);
    });

    it('drains the annotation outbox and pushes to transport', async () => {
      const transport = createMockTransport();
      const outboxRow = makeAnnotationRow('out-1', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];

      await mod.runSyncCycle(transport, SYNC_KINDS);

      // Outbox should be cleared
      expect(mockAnotacionesStore.replicaOutbox).toEqual([]);
      // Transport push should have been called with the outbox row
      expect(transport.pushedRows).toContainEqual(outboxRow);
    });

    it('drains the quote outbox and pushes to transport', async () => {
      const transport = createMockTransport();
      const outboxRow = makeQuoteRow('out-q', HLC_B);
      mockCitasStore.replicaOutbox = [outboxRow];

      await mod.runSyncCycle(transport, SYNC_KINDS);

      expect(mockCitasStore.replicaOutbox).toEqual([]);
      expect(transport.pushedRows).toContainEqual(outboxRow);
    });

    it('does not call push when outbox is empty for all kinds', async () => {
      const transport = createMockTransport();

      await mod.runSyncCycle(transport, SYNC_KINDS);

      expect(transport.push).not.toHaveBeenCalled();
    });

    it('continues to next kind even when pull fails for one kind', async () => {
      const transport = createMockTransport();
      (transport.pull as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue([])
        .mockResolvedValue([]);

      // Should not throw
      await expect(mod.runSyncCycle(transport, SYNC_KINDS)).resolves.toBeUndefined();

      // Should still have called pull for all kinds (quote and dictionary still attempted)
      expect(transport.pull).toHaveBeenCalledTimes(3);
    });

    it('puts outbox rows back on push failure (retry safety)', async () => {
      const transport = createMockTransport();
      const outboxRow = makeAnnotationRow('retry-1', HLC_B);
      mockAnotacionesStore.replicaOutbox = [outboxRow];
      (transport.push as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Push failed'));

      await mod.runSyncCycle(transport, SYNC_KINDS);

      // The outbox row should be restored
      expect(mockAnotacionesStore.replicaOutbox).toContainEqual(outboxRow);
    });

    it('advances the HLC cursor after a successful sync', async () => {
      const transport = createMockTransport();
      const row = makeAnnotationRow('cursor-1', HLC_B);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      (transport.pull as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await mod.runSyncCycle(transport, SYNC_KINDS);

      // The cursor for annotation should be updated to HLC_B
      const cursor = mockSettingsState.settings.lastSyncedAtReplicas['annotation'];
      expect(cursor).toBe(HLC_B);
    });
  });

  // ── runSyncCycle — sync kinds gating ──────────────────────────────────

  describe('runSyncCycle with gated kinds', () => {
    it('does not sync annotation when it is not in the kinds list', async () => {
      const transport = createMockTransport();
      const kinds: SyncCategory[] = ['quote', 'dictionary-entry'];

      await mod.runSyncCycle(transport, kinds);

      expect(transport.pull).toHaveBeenCalledTimes(2);
      expect(transport.pull).toHaveBeenCalledWith('quote', undefined);
      expect(transport.pull).toHaveBeenCalledWith('dictionary-entry', undefined);
      // Annotation should NOT have been called
      expect(transport.pull).not.toHaveBeenCalledWith('annotation', expect.anything());
    });
  });
});
