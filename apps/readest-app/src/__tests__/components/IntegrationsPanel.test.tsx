import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IntegrationsPanel from '@/components/settings/IntegrationsPanel';

const { mockStartSearching, mockCancelSearching, mockStartSync } = vi.hoisted(() => ({
  mockStartSearching: vi.fn(),
  mockCancelSearching: vi.fn(),
  mockStartSync: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useUsbDiscovery', () => ({
  useUsbDiscovery: () => ({
    state: 'idle',
    device: null,
    progress: 0,
    startSearching: mockStartSearching,
    cancelSearching: mockCancelSearching,
    startSync: mockStartSync,
  }),
}));

describe('IntegrationsPanel USB maintenance', () => {
  it('shows maintenance copy and disables USB Sync interactions', () => {
    render(<IntegrationsPanel />);

    const card = screen.getByRole('group', { name: 'USB Sync maintenance' });
    const button = screen.getByRole('button', { name: 'USB Sync' });

    expect(screen.getByText('In development')).toBeDefined();
    expect(
      screen.getByText(
        'USB Sync is temporarily in maintenance while we prepare a more stable experience.',
      ),
    ).toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.click(button);

    expect(mockStartSearching).not.toHaveBeenCalled();
    expect(mockCancelSearching).not.toHaveBeenCalled();
    expect(mockStartSync).not.toHaveBeenCalled();
  });
});
