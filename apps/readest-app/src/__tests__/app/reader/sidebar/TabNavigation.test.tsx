import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const settingsState = vi.hoisted(() => ({ current: { settings: {} as Record<string, unknown> } }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: undefined }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => settingsState.current,
}));

import TabNavigation from '@/app/reader/components/sidebar/TabNavigation';

afterEach(() => {
  cleanup();
  settingsState.current = { settings: {} };
});

describe('TabNavigation', () => {
  it('exposes TOC and Annotations tabs and never a Bookmarks tab (AI disabled)', () => {
    render(<TabNavigation activeTab='toc' onTabChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'TOC' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Annotate' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bookmark' })).toBeNull();
  });

  it('adds the Chat (history) tab when AI is enabled and still does not show Bookmarks', () => {
    settingsState.current = { settings: { aiSettings: { enabled: true } } };

    render(<TabNavigation activeTab='toc' onTabChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bookmark' })).toBeNull();
  });
});
