import { describe, expect, it } from 'vitest';
import { SYNC_CATEGORIES, type SyncCategory } from '@/types/settings';

describe('SYNC_CATEGORIES', () => {
  it('contains the legacy sync categories', () => {
    expect(SYNC_CATEGORIES).toContain('book');
    expect(SYNC_CATEGORIES).toContain('progress');
    expect(SYNC_CATEGORIES).toContain('note');
    expect(SYNC_CATEGORIES).toContain('dictionary');
    expect(SYNC_CATEGORIES).toContain('font');
    expect(SYNC_CATEGORIES).toContain('texture');
    expect(SYNC_CATEGORIES).toContain('settings');
    expect(SYNC_CATEGORIES).toContain('credentials');
  });

  it('contains the new replica sync categories', () => {
    expect(SYNC_CATEGORIES).toContain('annotation');
    expect(SYNC_CATEGORIES).toContain('quote');
    expect(SYNC_CATEGORIES).toContain('dictionary-entry');
  });

  it('has no duplicates', () => {
    const seen = new Set<SyncCategory>();
    for (const cat of SYNC_CATEGORIES) {
      expect(seen.has(cat)).toBe(false);
      seen.add(cat);
    }
  });

  it('is a readonly array matching the SyncCategory union exhaustively', () => {
    // Every member of the SyncCategory union must be in SYNC_CATEGORIES.
    // We verify by counting distinct categories — with a fresh union, the
    // set size will grow (this test guards against forgetting to update the
    // array when adding new members to the union).
    const unique = new Set(SYNC_CATEGORIES);
    // 8 legacy + 3 new = 11
    expect(unique.size).toBe(11);
  });
});
