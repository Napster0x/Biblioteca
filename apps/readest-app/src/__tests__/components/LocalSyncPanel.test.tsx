import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLocalSyncStore } from '@/store/localSyncStore';
import type { SyncResult, SyncStep } from '@/types/replica';

const { mockRunSyncCycle, mockCreatePeerTransport, mockInvoke, mockIsTauri } = vi.hoisted(() => ({
  mockRunSyncCycle: vi.fn(),
  mockCreatePeerTransport: vi.fn(() => ({ kind: 'usb' })),
  mockInvoke: vi.fn(),
  mockIsTauri: vi.fn<[], boolean>().mockReturnValue(true),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: vi.fn().mockResolvedValue({}) } }),
}));

const mockUseSettingsStore = vi.fn();
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) => {
    const state = mockUseSettingsStore();
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/services/sync/localSyncUtils', () => ({
  createPeerTransport: mockCreatePeerTransport,
  runSyncCycle: mockRunSyncCycle,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => mockIsTauri(),
}));

type InvokeArgs = Record<string, unknown> | undefined;

function defaultSettings(localSync: Record<string, unknown> = {}) {
  return {
    localSync: { enabled: false, port: 7878, deviceName: 'desktop', ...localSync },
  };
}

function mockStoreReturn(localSync: Record<string, unknown> = {}) {
  mockUseSettingsStore.mockReturnValue({
    settings: defaultSettings(localSync),
    setSettings: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  });
}

function mockUsbReadyFlow() {
  mockInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
    if (cmd === 'check_adb') return undefined;
    if (cmd === 'list_usb_devices_detailed') {
      return [{ serial: 'USB123', state: 'device', model: 'Pixel Tablet' }];
    }
    if (cmd === 'setup_usb_tunnel') {
      expect(args).toEqual({ serial: 'USB123', port: 7878 });
      return undefined;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

function mockHealthOk(deviceName = 'Pixel Tablet') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ deviceName, version: '1.0.0' }),
    }),
  );
}

function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    peerId: 'usb:localhost:7878',
    kinds: {
      annotation: { kind: 'annotation', pulled: 3, pushed: 1, conflicts: 0 },
      quote: { kind: 'quote', pulled: 2, pushed: 0, conflicts: 1 },
      'dictionary-entry': { kind: 'dictionary-entry', pulled: 0, pushed: 1, conflicts: 0 },
    },
    errors: [],
    startedAt: Date.now() - 200,
    finishedAt: Date.now(),
    ...overrides,
  };
}

function mockSyncThatCallsOnStep(result: SyncResult) {
  mockRunSyncCycle.mockImplementationOnce(
    (_transport: unknown, _kinds: unknown, _peerId?: string, onStep?: (step: SyncStep) => void) => {
      onStep?.({ phase: 'connecting' });
      onStep?.({ phase: 'pulling', kind: 'annotation', current: 3, detail: 'Pulling annotations' });
      onStep?.({ phase: 'finalizing' });
      return Promise.resolve(result);
    },
  );
}

describe('LocalSyncPanel USB-only', () => {
  let LocalSyncPanel: React.FC<{ onBack: () => void }>;

  beforeAll(async () => {
    const mod = await import('@/components/settings/integrations/LocalSyncPanel');
    LocalSyncPanel = mod.default;
  });

  beforeEach(() => {
    mockStoreReturn();
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    mockRunSyncCycle.mockReset();
    mockCreatePeerTransport.mockClear();
    mockHealthOk();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useLocalSyncStore.getState().resetUsbSync();
  });

  it('renders USB-only copy and no WiFi messaging while off', () => {
    render(<LocalSyncPanel onBack={vi.fn()} />);

    expect(
      screen.getAllByText('Connect your Android device with USB and enable ADB debugging.').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/same WiFi network/i)).toBeNull();
    expect(screen.queryByText(/Discovered Devices/i)).toBeNull();
  });

  it('checks ADB, lists devices, configures tunnel, health-checks localhost and reaches ready', async () => {
    mockUsbReadyFlow();
    mockStoreReturn({ enabled: false, port: 7878, deviceName: 'desktop' });

    render(<LocalSyncPanel onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(await screen.findByText('USB device ready')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Sync Now' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(mockInvoke).toHaveBeenCalledWith('check_adb');
    expect(mockInvoke).toHaveBeenCalledWith('list_usb_devices_detailed');
    expect(mockInvoke).toHaveBeenCalledWith('setup_usb_tunnel', { serial: 'USB123', port: 7878 });
    expect(fetch).toHaveBeenCalledWith('http://localhost:7878/health');
  });

  it.each([
    [
      'adb-missing',
      async () => mockInvoke.mockRejectedValueOnce(new Error('adb not found')),
      'ADB is not installed or not available in PATH.',
      'Install Android Platform Tools and restart Biblioteca.',
    ],
    [
      'no-device',
      async () => mockInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]),
      'No Android device detected over USB.',
      'Connect your Android device with USB and enable USB debugging.',
    ],
    [
      'unauthorized',
      async () =>
        mockInvoke
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce([{ serial: 'USB123', state: 'unauthorized' }]),
      'USB debugging is not authorized yet.',
      'Accept the RSA fingerprint prompt on Android.',
    ],
  ])('shows %s state with an actionable recovery message', async (_state, arrange, message, action) => {
    await arrange();
    mockStoreReturn({ enabled: false, port: 7878 });

    render(<LocalSyncPanel onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(await screen.findByText(message)).toBeDefined();
    expect(screen.getByText(action)).toBeDefined();
    expect((screen.getByRole('button', { name: 'Sync Now' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mockRunSyncCycle).not.toHaveBeenCalled();
  });

  it('shows server-unreachable when tunnel succeeds but localhost health fails', async () => {
    mockUsbReadyFlow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: vi.fn() }));
    mockStoreReturn({ enabled: false, port: 7878 });

    render(<LocalSyncPanel onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(await screen.findByText('Android sync server is not reachable.')).toBeDefined();
    expect(
      screen.getByText('Open Biblioteca on Android and enable Local Sync there.'),
    ).toBeDefined();
    expect((screen.getByRole('button', { name: 'Sync Now' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('does not call WiFi discovery, scanner, self-IP, or peer event APIs', async () => {
    mockUsbReadyFlow();
    mockStoreReturn({ enabled: false, port: 7878 });

    render(<LocalSyncPanel onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));

    await screen.findByText('USB device ready');
    const commandNames = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commandNames).not.toContain('get_local_ip');
    expect(commandNames).not.toContain('start_discovery');
    expect(commandNames).not.toContain('stop_discovery');
    expect(commandNames).not.toContain('get_discovered_peers');
  });

  it('runs manual USB sync with a stable USB peer id and shows success summary', async () => {
    mockUsbReadyFlow();
    mockSyncThatCallsOnStep(makeSyncResult());
    mockStoreReturn({ enabled: false, port: 7878 });

    render(<LocalSyncPanel onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    await screen.findByText('USB device ready');

    fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));

    expect(await screen.findByText(/Transferencia CRDT completada/i)).toBeDefined();
    expect(screen.getByText(/convergencia visible pendiente/i)).toBeDefined();
    expect(screen.queryByText(/Sincronización completada/i)).toBeNull();
    expect(screen.getByText(/recibido.*5/i)).toBeDefined();
    expect(screen.getByText(/enviado.*2/i)).toBeDefined();
    expect(screen.getByText(/conflictos.*1/i)).toBeDefined();
    expect(mockRunSyncCycle).toHaveBeenCalledWith(
      expect.anything(),
      ['annotation', 'quote', 'dictionary-entry'],
      'usb:localhost:7878',
      expect.any(Function),
    );
  });

  it('keeps Sync disabled while syncing and shows sync errors with retry', async () => {
    mockUsbReadyFlow();
    mockRunSyncCycle.mockRejectedValueOnce(new Error('HTTP 500'));
    mockStoreReturn({ enabled: false, port: 7878 });

    render(<LocalSyncPanel onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    await screen.findByText('USB device ready');

    fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));

    expect(await screen.findByText(/Error al sincronizar/)).toBeDefined();
    expect(screen.getAllByText('HTTP 500').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
  });

  it('renders checking-adb and configuring-tunnel transitional states', async () => {
    let releaseCheckAdb: () => void = () => {};
    let releaseTunnel: () => void = () => {};
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_adb')
        return new Promise<void>((resolve) => {
          releaseCheckAdb = resolve;
        });
      if (cmd === 'list_usb_devices_detailed')
        return Promise.resolve([{ serial: 'USB123', state: 'device' }]);
      if (cmd === 'setup_usb_tunnel')
        return new Promise<void>((resolve) => {
          releaseTunnel = resolve;
        });
      return Promise.resolve(undefined);
    });
    mockStoreReturn({ enabled: false, port: 7878 });

    render(<LocalSyncPanel onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(await screen.findByText('Checking ADB…')).toBeDefined();
    releaseCheckAdb();
    expect(await screen.findByText('Configuring USB tunnel…')).toBeDefined();
    releaseTunnel();
    expect(await screen.findByText('USB device ready')).toBeDefined();
  });
});
