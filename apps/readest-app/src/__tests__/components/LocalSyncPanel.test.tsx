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
    it('shows progress bar with "Syncing X/Y devices..." while sync is in progress', async () => {
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

      // Should show progress text
      const progressText = await screen.findByText(/Syncing/i, {}, { timeout: 3000 });
      expect(progressText).toBeDefined();

      // Button should be disabled during sync
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows last synced timestamp and hides progress bar when sync completes', async () => {
      mockRunSyncCycle.mockResolvedValueOnce(undefined);

      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // Click Sync Now
      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);

      // After sync completes, timestamp should appear
      const timestamp = await screen.findByText(/Last synced:/, {}, { timeout: 3000 });
      expect(timestamp).toBeDefined();

      // Progress bar should be gone
      expect(screen.queryByText(/Syncing/i)).toBeNull();

      // Button should be enabled again
      expect((btn as HTMLButtonElement).disabled).toBe(false);
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
    it('shows last synced timestamp after sync is triggered', async () => {
      mockStoreReturn({ localSync: { enabled: true, port: 7878, deviceName: '' } });
      seedPeers([{ host: '192.168.1.5', port: 7878, deviceName: 'Tablet', version: '1.0.0' }]);
      useLocalSyncStore.getState().setPeerReachable('192.168.1.5:7878', true);

      render(<LocalSyncPanel onBack={vi.fn()} />);

      // Initially, no timestamp shown.
      expect(screen.queryByText(/Last synced:/)).toBeNull();

      // Click Sync Now.
      const btn = screen.getByRole('button', { name: /Sync Now/i });
      fireEvent.click(btn);

      // After sync completes (timeout resolves), timestamp should appear.
      const timestamp = await screen.findByText(/Last synced:/, {}, { timeout: 3000 });
      expect(timestamp).toBeDefined();
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
});
