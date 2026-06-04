import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnotacionesShelfItem } from '@/types/annotaciones';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  navigateToAnotaciones: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/utils/nav', () => ({
  navigateToAnotaciones: mocks.navigateToAnotaciones,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import AnotacionesShelfCard from '@/app/library/components/AnotacionesShelfCard';

const mockItem: AnotacionesShelfItem = {
  type: 'anotaciones-shelf-item',
  id: 'anotaciones',
  title: 'Anotaciones',
};

describe('AnotacionesShelfCard', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.navigateToAnotaciones.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the cover image with the correct alt text in grid mode', () => {
    const { container } = render(<AnotacionesShelfCard item={mockItem} mode='grid' />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/images/annotaciones-cover.png');
    expect(img!.getAttribute('alt')).toBe('Anotaciones');
  });

  it('renders the item title', () => {
    render(<AnotacionesShelfCard item={mockItem} mode='grid' />);

    expect(screen.getByText('Anotaciones')).toBeTruthy();
  });

  it('shows fallback icon when cover image errors', () => {
    const { container } = render(<AnotacionesShelfCard item={mockItem} mode='grid' />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    fireEvent.error(img!);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders in list mode with correct structure', () => {
    const { container } = render(<AnotacionesShelfCard item={mockItem} mode='list' />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('anotaciones-shelf-card');
    expect(wrapper.className).toContain('h-28');
    expect(wrapper.className).toContain('flex-row');
  });

  it('applies anotaciones-shelf-card CSS class', () => {
    const { container } = render(<AnotacionesShelfCard item={mockItem} mode='grid' />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('anotaciones-shelf-card');
  });
});
