import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ── Hoisted variables — safe to reference inside vi.mock factories ──
const { mockLoadSettings } = vi.hoisted(() => ({
  mockLoadSettings: vi.fn().mockResolvedValue({ globalViewSettings: {} }),
}));

// ── Mock DebugSyncTrigger to render a visible test element ──
vi.mock('@/components/DebugSyncTrigger', () => ({
  DebugSyncTrigger: () => React.createElement('div', { 'data-testid': 'debug-sync-trigger' }),
  shouldEnableDebugSyncTrigger: vi.fn(),
}));

// ── Mock EnvContext ──
vi.mock('@/context/EnvContext', () => ({
  useEnv: vi.fn(() => ({
    envConfig: { getAppService: vi.fn().mockResolvedValue({}) },
    appService: { loadSettings: mockLoadSettings, hasSafeAreaInset: false },
  })),
}));

// ── Mock Zustand stores ──
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn((s?: (st: unknown) => unknown) => {
    const state = { applyUILanguage: vi.fn(), settings: { customTextures: [] } };
    return s ? s(state) : state;
  }),
}));

vi.mock('@/store/customTextureStore', () => {
  const store = Object.assign(
    vi.fn((s?: (st: unknown) => unknown) => {
      const state = { textures: [] };
      return s ? s(state) : state;
    }),
    {
      getState: vi.fn(() => ({
        setTextures: vi.fn(),
        addTexture: vi.fn(),
        applyTexture: vi.fn(),
      })),
    },
  );
  return { useCustomTextureStore: store };
});

vi.mock('@/store/themeStore', () => ({
  initSystemThemeListener: vi.fn(),
  loadDataTheme: vi.fn(),
  useThemeStore: vi.fn((s?: (st: unknown) => unknown) => {
    const state = { updateSafeAreaInsets: vi.fn() };
    return s ? s(state) : state;
  }),
}));

vi.mock('@/store/appLockStore', () => ({
  useAppLockStore: vi.fn(() => ({
    isInitialized: false,
    isUnlocked: false,
    initialize: vi.fn(),
  })),
}));

// ── Mock hooks ──
vi.mock('@/hooks/useSafeAreaInsets', () => ({
  useSafeAreaInsets: vi.fn(),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useDefaultIconSize: vi.fn(() => 20),
}));

vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: vi.fn(() => ({ applyBackgroundTexture: vi.fn() })),
}));

vi.mock('@/hooks/useEinkMode', () => ({
  useEinkMode: vi.fn(() => ({ applyEinkMode: vi.fn() })),
}));

vi.mock('@/hooks/useReplicaSync', () => ({
  useReplicaSync: vi.fn(),
}));

// ── Mock utilities ──
vi.mock('@/utils/misc', () => ({
  getLocale: vi.fn(() => 'en'),
  getOSPlatform: vi.fn(() => 'linux'),
}));

vi.mock('@/utils/rtl', () => ({
  getDirFromUILanguage: vi.fn(() => 'ltr'),
}));

vi.mock('@/utils/viewport', () => ({
  getAndroidPatchedViewportContent: vi.fn(() => null),
}));

// ── Mock i18n ──
vi.mock('@/i18n/i18n', () => ({
  default: { on: vi.fn(), off: vi.fn() },
}));

// ── Mock UI components rendered by Providers ──
vi.mock('@/components/command-palette', () => ({
  CommandPaletteProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  CommandPalette: () => null,
}));

vi.mock('@/components/AtmosphereOverlay', () => ({
  default: () => null,
}));

vi.mock('@/components/AppLockScreen', () => ({
  default: () => null,
}));

vi.mock('@/components/settings/AppLockDialog', () => ({
  default: () => null,
}));

vi.mock('@/context/DropdownContext', () => ({
  DropdownProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('@/utils/polyfill', () => ({}));

// ── Actual test ──
import Providers from '@/components/Providers';

const envOriginal = { ...process.env };

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('NEXT_PUBLIC_BIBLIOTECA_DEV_SYNC_HARNESS', '');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const key of Object.keys(envOriginal)) {
    process.env[key] = envOriginal[key];
  }
});

describe('Providers DebugSyncTrigger mount boundary', () => {
  it('does not mount DebugSyncTrigger in production without dev harness', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BIBLIOTECA_DEV_SYNC_HARNESS', '');

    render(<Providers>child content</Providers>);

    expect(screen.queryByTestId('debug-sync-trigger')).toBeNull();
  });

  it('mounts DebugSyncTrigger when NODE_ENV is development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_BIBLIOTECA_DEV_SYNC_HARNESS', '');

    render(<Providers>child content</Providers>);

    expect(screen.queryByTestId('debug-sync-trigger')).toBeTruthy();
  });

  it('mounts DebugSyncTrigger when dev harness is explicitly enabled in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BIBLIOTECA_DEV_SYNC_HARNESS', '1');

    render(<Providers>child content</Providers>);

    expect(screen.queryByTestId('debug-sync-trigger')).toBeTruthy();
  });
});
