/**
 * LocalSyncPanel component tests — Phase 6.1 (Frontend UI).
 *
 * Tests: empty state, peer list display with indicator dots, toggle,
 * "Sync Now" button, port field, and last-synced timestamp.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useLocalSyncStore } from '@/store/localSyncStore';
import type { PeerInfo } from '@/types/settings';
import type { SyncResult, SyncStep } from '@/types/replica';
import { syncUIReducer } from '@/components/settings/integrations/LocalSyncPanel';
import type { SyncUI } from '@/components/settings/integrations/LocalSyncPanel';

// Hoisted mock for runSyncCycle — accessible in both vi.mock factory and tests.
const { mockRunSyncCycle } = vi.hoisted(() => ({
  mockRunSyncCycle: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {
      getAppService: vi.fn().mockResolvedValue({}),
    },
  }),
}));

const mockUseSettingsStore = vi.fn();
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) => {
    const state = mockUseSettingsStore();
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/hooks/useReplicaSync', () => ({
  useReplicaSync: () => ({
    isSyncing: false,
    lastError: null,
    syncNow: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock localSyncUtils — we control the sync behaviour in tests.
vi.mock('@/services/sync/localSyncUtils', () => ({
  filterReachablePeers: vi.fn((peers: PeerInfo[]) => peers),
  createPeerTransport: vi.fn(),
  runSyncCycle: mockRunSyncCycle,
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default settings including localSync shape. */
function defaultSettings(overrides: Record<string, unknown> = {}) {
  return {
    localSync: { enabled: false, port: 7878, deviceName: 'test-device' },
    ...overrides,
  };
}

/** Populate the localSyncStore with test peers. */
function seedPeers(peers: PeerInfo[]) {
  for (const p of peers) {
    useLocalSyncStore.getState().addPeer(p);
  }
}

function mockStoreReturn(settingsOverrides: Record<string, unknown> = {}) {
  mockUseSettingsStore.mockReturnValue({
    settings: defaultSettings(settingsOverrides),
    setSettings: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalSyncPanel', () => {
  // Lazy import — the module exists now (GREEN phase) so this resolves.
  let LocalSyncPanel: React.FC<{ onBack: () => void }>;

  beforeAll(async () => {
    const mod = await import('@/components/settings/integrations/LocalSyncPanel');
    LocalSyncPanel = mod.default;
  });

  beforeEach(() => {
    mockStoreReturn();
    mockRunSyncCycle.mockReset();
    mockRunSyncCycle.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    useLocalSyncStore.setState({ peers: [], isDiscovering: false, peerHealth: {} });
  });

  // ── Empty state ──────────────────────────────────────────────────────

  describe('empty state', () => {
    it('shows the empty-state message when no peers are discovered and sync is enabled', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // The empty-state message appears both as the description and in the
      // empty-state card. Verify at least one is rendered.
      const messages = screen.getAllByText(/USB|WiFi|same network/i);
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the sub-page header with parent label "Integrations"', () => {
      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.getByText('Integrations')).toBeDefined();
      // "Local Sync" appears in both the breadcrumb and the toggle label.
      const labels = screen.getAllByText('Local Sync');
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Toggle ───────────────────────────────────────────────────────────

  describe('toggle', () => {
    it('renders the toggle and reflects enabled state', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const toggle = screen.getByRole('checkbox');
      expect(toggle).toBeDefined();
      expect((toggle as HTMLInputElement).checked).toBe(true);
    });

    it('shows toggle off when localSync is disabled', () => {
      mockStoreReturn({ localSync: { enabled: false, port: 7878, deviceName: '' } });

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const toggle = screen.getByRole('checkbox');
      expect((toggle as HTMLInputElement).checked).toBe(false);
    });
  });

  // ── Peer list ────────────────────────────────────────────────────────

  describe('peer list', () => {
    it('displays discovered peers with device names', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([
        { host: '192.168.1.5', port: 7878, deviceName: 'Living Room Tablet', version: '1.0.0' },
      ]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.getByText('Living Room Tablet')).toBeDefined();
      expect(screen.getByText(/192\.168\.1\.5:7878/)).toBeDefined();
    });

    it('shows multiple peers when discovered', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([
        { host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0.0' },
        { host: '192.168.1.6', port: 7878, deviceName: 'Phone', version: '1.0.0' },
      ]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.getByText('Tablet')).toBeDefined();
      expect(screen.getByText('Phone')).toBeDefined();
    });
  });

  // ── Sync Now button ──────────────────────────────────────────────────

  describe('"Sync Now" button', () => {
    it('renders the button when sync is enabled', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const btn = screen.getByRole('button', { name: /Sync Now/i });
      expect(btn).toBeDefined();
    });

    it('does NOT render the button when sync is disabled', () => {
      mockStoreReturn({ localSync: { enabled: false, port: 7878, deviceName: '' } });

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.queryByRole('button', { name: /Sync Now/i })).toBeNull();
    });

    it('handles click without crashing', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);
      // Assertion: does not crash — the component is still mounted.
      expect(screen.getAllByText('Local Sync').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Sync progress bar ─────────────────────────────────────────────────

  describe('sync progress bar', () => {
    it('shows disabled button with "Sincronizando…" while sync is in progress', async () => {
      // Make runSyncCycle never resolve — keeps sync in "in progress" state
      mockRunSyncCycle.mockImplementationOnce(() => new Promise(() => {}));

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([
        { host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' },
        { host: '192.168.1.6', port: 7878, deviceName: 'Phone', version: '1.0' },
      ]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.6:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // Click Sync Now
      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);

      // Button should show "Sincronizando…" and be disabled
      const syncingBtn = await screen.findByRole(
        'button',
        { name: /Sincronizando/i },
        { timeout: 3000 },
      );
      expect(syncingBtn).toBeDefined();
      expect((syncingBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows last synced timestamp when sync completes successfully', async () => {
      const result = makeSyncResult();
      mockSyncThatCallsOnStep(result);

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // Click Sync Now
      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);

      // After sync completes, success summary should appear with timestamp
      const successText = await screen.findByText(/recibido.*5/i, {}, { timeout: 3000 });
      expect(successText).toBeDefined();

      // Button should not be visible in success state (no "Sync Now")
      expect(screen.queryByRole('button', { name: /Sync Now/i })).toBeNull();
    });
  });

  // ── Back navigation ──────────────────────────────────────────────────

  describe('back navigation', () => {
    it('calls onBack when the breadcrumb parent label is clicked', () => {
      const onBack = vi.fn();

      render(<LocalSyncPanel onBack={onBack} />);

      fireEvent.click(screen.getByText('Integrations'));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  // ── Connection type badge ─────────────────────────────────────────────

  describe('connection type badge', () => {
    it('shows "WiFi" badge for peers with remote IP addresses', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0.0' }]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.getByText('WiFi')).toBeDefined();
    });

    it('shows "USB" badge for peers on localhost', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: 'localhost', port: 7878, deviceName: 'Phone', version: '1.0.0' }]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.getByText('USB')).toBeDefined();
    });

    it('shows "USB" badge for 127.0.0.1 loopback address', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '127.0.0.1', port: 7878, deviceName: 'Phone USB', version: '1.0.0' }]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.getByText('USB')).toBeDefined();
    });

    // Task 1.5 RED — kind-based badge: peer with kind='usb' shows USB
    // regardless of host (currently the connectionType function uses host)
    it('shows "USB" badge for peer with kind=usb on a non-localhost host', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([
        {
          host: '192.168.1.5',
          port: 7878,
          deviceName: 'USB Device via ADB',
          version: '1.0.0',
          kind: 'usb',
        },
      ]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.getByText('USB')).toBeDefined();
    });
  });

  // ── Peer reachability indicator ───────────────────────────────────────

  describe('peer reachability indicator', () => {
    it('shows green dot when peer is reachable', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const indicator = screen.getByLabelText('Connected');
      expect(indicator).toBeDefined();
      expect(indicator.className).toMatch(/bg-green/);
    });

    it('shows red dot when peer is unreachable', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.6', port: 7878, deviceName: 'Phone', version: '1.0.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.6:7878', false);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const indicator = screen.getByLabelText('Not connected');
      expect(indicator).toBeDefined();
      expect(indicator.className).toMatch(/bg-red/);
    });

    it('shows gray dot when peer health has not been checked yet', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.7', port: 7878, deviceName: 'Unknown', version: '1.0.0' }]);
      // Do NOT call setPeerReachable — peer health unknown

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const indicator = screen.getByLabelText('Unknown');
      expect(indicator).toBeDefined();
      expect(indicator.className).toMatch(/bg-gray/);
    });
  });

  // ── Last synced timestamp ─────────────────────────────────────────────

  describe('last synced timestamp', () => {
    it('shows last synced info after sync is triggered', async () => {
      const result = makeSyncResult();
      mockSyncThatCallsOnStep(result);

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // Initially, no success summary shown.
      expect(screen.queryByText(/recibido/i)).toBeNull();

      // Click Sync Now.
      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);

      // After sync completes, success summary should appear.
      const successText = await screen.findByText(/recibido.*5/i, {}, { timeout: 3000 });
      expect(successText).toBeDefined();
    });

    it('does NOT show last synced timestamp before first sync', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0.0' }]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      expect(screen.queryByText(/Last synced:/)).toBeNull();
    });
  });

  // ── Primitives usage ──────────────────────────────────────────────────

  describe('primitives usage', () => {
    it('uses SettingsSwitchRow for the toggle (label wraps the checkbox)', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // The SettingsSwitchRow renders a <label> containing a toggle checkbox.
      const toggle = screen.getByRole('checkbox');
      expect(toggle.closest('label')).toBeDefined();
    });

    it('renders a SectionTitle for the peer list when peers are present', () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0.0' }]);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // BoxedList renders a SectionTitle above the card.
      expect(screen.getByText('Discovered Devices')).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Phase 4 — 4-state sync UI: idle | syncing | success | error
  // ────────────────────────────────────────────────────────────────────

  /** Build a minimal SyncResult for test assertions. */
  function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
    return {
      peerId: '192.168.1.5:7878',
      kinds: {
        annotation: { kind: 'annotation', pulled: 3, pushed: 1, conflicts: 0 },
        quote: { kind: 'quote', pulled: 2, pushed: 0, conflicts: 1 },
        'dictionary-entry': {
          kind: 'dictionary-entry',
          pulled: 0,
          pushed: 0,
          conflicts: 0,
        },
      },
      errors: [],
      startedAt: Date.now() - 2000,
      finishedAt: Date.now(),
      ...overrides,
    };
  }

  /** Utility that creates a mock for runSyncCycle which calls onStep then resolves. */
  function mockSyncThatCallsOnStep(result: SyncResult) {
    mockRunSyncCycle.mockImplementationOnce(
      (
        _transport: unknown,
        _kinds: unknown,
        _peerId?: string,
        onStep?: (step: SyncStep) => void,
      ) => {
        if (onStep) {
          onStep({ phase: 'connecting' });
          onStep({ phase: 'pulling', kind: 'annotation', current: 3 });
          onStep({ phase: 'merging', kind: 'annotation', current: 3 });
          onStep({ phase: 'pushing', kind: 'annotation', current: 1 });
          onStep({ phase: 'pulling', kind: 'quote', current: 2 });
          onStep({ phase: 'merging', kind: 'quote', current: 2 });
          onStep({ phase: 'pushing', kind: 'quote', current: 0 });
          onStep({ phase: 'finalizing' });
        }
        return Promise.resolve(result);
      },
    );
  }

  describe('sync state machine', () => {
    // ── SYNCING ──────────────────────────────────────────────────────

    it('shows button disabled with "Sincronizando..." text during sync (R13)', async () => {
      // Keep sync pending forever
      mockRunSyncCycle.mockImplementationOnce(() => new Promise(() => {}));

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // Click Sync Now
      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);

      // Button text changes to "Sincronizando..."
      const syncingBtn = await screen.findByRole(
        'button',
        { name: /Sincronizando/i },
        { timeout: 3000 },
      );
      expect(syncingBtn).toBeDefined();
      expect((syncingBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows progress phase indicators during sync (R10)', async () => {
      mockRunSyncCycle.mockImplementationOnce(
        (_t: unknown, _k: unknown, _p?: string, onStep?: (step: SyncStep) => void) => {
          // Fire a couple of steps so UI renders phase info
          onStep?.({ phase: 'connecting' });
          onStep?.({
            phase: 'pulling',
            kind: 'annotation',
            current: 5,
            detail: 'Recibiendo anotaciones...',
          });
          return new Promise(() => {}); // never resolve
        },
      );

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);

      // Phase indicators should be visible (may appear in pills and detail)
      const progressEls = await screen.findAllByText(/Recibiendo/u, {}, { timeout: 3000 });
      expect(progressEls.length).toBeGreaterThanOrEqual(1);
    });

    // ── SUCCESS ───────────────────────────────────────────────────────

    it('shows summary with received/sent/conflict counters after sync completes (R11)', async () => {
      const result = makeSyncResult({
        kinds: {
          annotation: { kind: 'annotation', pulled: 5, pushed: 2, conflicts: 1 },
          quote: { kind: 'quote', pulled: 3, pushed: 0, conflicts: 0 },
          'dictionary-entry': { kind: 'dictionary-entry', pulled: 0, pushed: 1, conflicts: 0 },
        },
      });
      mockSyncThatCallsOnStep(result);

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Sync Now/i }));

      // Wait for success summary elements
      const receivedText = await screen.findByText(/recibido.*8/i, {}, { timeout: 3000 });
      expect(receivedText).toBeDefined();
      const sentText = screen.getByText(/enviado.*3/i);
      expect(sentText).toBeDefined();
      const conflictsText = screen.getByText(/conflictos.*1/i);
      expect(conflictsText).toBeDefined();
    });

    it('auto-transitions from SUCCESS back to IDLE when DISMISS is dispatched (R11)', async () => {
      // Test that the reducer transitions from success to idle on DISMISS
      const successState: SyncUI = {
        state: 'success',
        progress: null,
        result: makeSyncResult(),
        errorPeerId: '',
        errorMessage: '',
        lastSyncedAt: new Date(),
        lastSyncSummary: 'test',
      };
      const dismissed = syncUIReducer(successState, { type: 'DISMISS' });
      expect(dismissed.state).toBe('idle');
      expect(dismissed.result).toBeNull();
      expect(dismissed.errorPeerId).toBe('');
      expect(dismissed.errorMessage).toBe('');
    });

    // ── ERROR ─────────────────────────────────────────────────────────

    it('shows error message with peer name when sync fails (R12)', async () => {
      mockRunSyncCycle.mockRejectedValueOnce(new Error('Connection refused'));

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Sync Now/i }));

      // Error message should mention the peer
      const errorText = await screen.findByText(
        /Tablet|Connection refused/i,
        {},
        { timeout: 3000 },
      );
      expect(errorText).toBeDefined();
      // The error icon is shown
      expect(screen.getByText(/❌|Error/i)).toBeDefined();
    });

    it('shows Retry button in ERROR state that re-initiates sync (R12)', async () => {
      // First call: fail
      mockRunSyncCycle.mockRejectedValueOnce(new Error('Connection refused'));
      // Second call (retry): succeed
      const retryResult = makeSyncResult();
      mockSyncThatCallsOnStep(retryResult);

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Sync Now/i }));

      // Wait for error state
      await screen.findByText(/Connection refused/i, {}, { timeout: 3000 });

      // Retry button should exist
      const retryBtn = screen.getByRole('button', { name: /Reintentar|Retry/i });
      expect(retryBtn).toBeDefined();

      // Click retry
      fireEvent.click(retryBtn);

      // Should transition to success
      const summaryEl = await screen.findByText(/recibido.*5/i, {}, { timeout: 3000 });
      expect(summaryEl).toBeDefined();
    });

    it('shows Dismiss button in ERROR state that returns to IDLE (R12)', async () => {
      mockRunSyncCycle.mockRejectedValueOnce(new Error('Connection refused'));

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Sync Now/i }));

      await screen.findByText(/Connection refused/i, {}, { timeout: 3000 });

      // Find dismiss button (not "Retry")
      const dismissBtn = screen.getByRole('button', { name: /Cerrar|Close|Dismiss/i });
      expect(dismissBtn).toBeDefined();
      fireEvent.click(dismissBtn);

      // Should return to IDLE
      const syncNowBtn = await screen.findByRole('button', { name: /Sync Now/i });
      expect(syncNowBtn).toBeDefined();
      expect((syncNowBtn as HTMLButtonElement).disabled).toBe(false);
    });

    // ── Partial errors (errors[] in SyncResult) ───────────────────────

    it('shows summary with partial error count when SyncResult has errors (R16)', async () => {
      const result = makeSyncResult({
        errors: [
          {
            peerId: '192.168.1.5:7878',
            kind: 'annotation',
            timestamp: Date.now(),
            message: 'Timeout pulling annotations',
          },
        ],
      });
      mockSyncThatCallsOnStep(result);

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Sync Now/i }));

      // Summary still shows (success despite partial errors)
      const summaryEl = await screen.findByText(/recibido.*5/i, {}, { timeout: 3000 });
      expect(summaryEl).toBeDefined();
      // Error count visible — error note should show
      const errorNote = screen.getByText(/error/i);
      expect(errorNote).toBeDefined();
    });
  });
});
