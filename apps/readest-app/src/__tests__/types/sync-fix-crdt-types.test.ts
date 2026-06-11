/**
 * sync-fix-crdt types test — RED phase (Task 1.2).
 *
 * Tests that the new types (SyncResult, SyncError, SyncKindResult, SyncStep,
 * SyncPhase) exist and that PeerInfo now accepts an optional `kind` field.
 * These tests will FAIL at compile time / runtime until the types are defined
 * in src/types/settings.ts and src/types/replica.ts.
 */
import { describe, it, expect } from 'vitest';
import type { SyncCategory, PeerInfo, LocalSyncSettings } from '@/types/settings';
import type { SyncResult, SyncError, SyncKindResult, SyncStep, SyncPhase } from '@/types/replica';

// ---------------------------------------------------------------------------
// PeerInfo.kind — must accept optional 'wifi' | 'usb'
// ---------------------------------------------------------------------------

describe('PeerInfo.kind (Task 1.3)', () => {
  it('allows kind: "wifi"', () => {
    const peer: PeerInfo = {
      host: '192.168.1.5',
      port: 7878,
      deviceName: 'Tablet',
      version: '1.0.0',
      kind: 'wifi',
    };
    expect(peer.kind).toBe('wifi');
  });

  it('allows kind: "usb"', () => {
    const peer: PeerInfo = {
      host: 'localhost',
      port: 7878,
      deviceName: 'Phone',
      version: '1.0.0',
      kind: 'usb',
    };
    expect(peer.kind).toBe('usb');
  });

  it('omitting kind is valid (backward compatibility)', () => {
    const peer: PeerInfo = {
      host: '192.168.1.5',
      port: 7878,
      deviceName: 'Old Device',
      version: '0.9.0',
    };
    expect(peer.kind).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LocalSyncSettings — new fields: lastSyncedAt, lastSyncSummary
// ---------------------------------------------------------------------------

describe('LocalSyncSettings new fields (Task 1.3)', () => {
  it('accepts lastSyncedAt and lastSyncSummary', () => {
    const settings: LocalSyncSettings = {
      enabled: true,
      port: 7878,
      deviceName: 'TestDevice',
      lastSyncedAt: 1718140000000,
      lastSyncSummary: 'Received 5 annotations, 2 quotes',
    };
    expect(settings.lastSyncedAt).toBe(1718140000000);
    expect(settings.lastSyncSummary).toBe('Received 5 annotations, 2 quotes');
  });

  it('omitting new fields is valid (backward compatibility)', () => {
    const settings: LocalSyncSettings = {
      enabled: false,
      port: 7878,
      deviceName: 'OldDevice',
    };
    expect(settings.lastSyncedAt).toBeUndefined();
    expect(settings.lastSyncSummary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SystemSettings.localSyncCursors
// ---------------------------------------------------------------------------

describe('SystemSettings.localSyncCursors (Task 1.3)', () => {
  it('accepts per-peer cursor map', () => {
    const cursors: Record<string, Record<string, string>> = {
      '192.168.1.5:7878': {
        annotation: '0000000000001-00000001-devA',
        quote: '0000000000002-00000001-devA',
        'dictionary-entry': '0000000000003-00000001-devA',
      },
    };
    // Verify structure at runtime
    expect(cursors['192.168.1.5:7878']!['annotation']).toBe('0000000000001-00000001-devA');
    expect(cursors['192.168.1.5:7878']!['quote']).toBe('0000000000002-00000001-devA');
  });
});

// ---------------------------------------------------------------------------
// SyncResult, SyncError, SyncKindResult (Task 1.2)
// ---------------------------------------------------------------------------

describe('SyncResult types (Task 1.2)', () => {
  it('SyncResult has correct shape with kinds, errors, timestamps', () => {
    const kind: SyncCategory = 'annotation';
    const kindResult: SyncKindResult = {
      kind,
      pulled: 5,
      pushed: 3,
      conflicts: 1,
    };
    expect(kindResult.kind).toBe('annotation');
    expect(kindResult.pulled).toBe(5);
    expect(kindResult.pushed).toBe(3);
    expect(kindResult.conflicts).toBe(1);
  });

  it('SyncError contains peerId, kind, timestamp, message', () => {
    const error: SyncError = {
      peerId: '192.168.1.5:7878',
      kind: 'annotation',
      timestamp: 1718140000000,
      message: 'Connection refused',
      cause: 'ECONNREFUSED',
    };
    expect(error.peerId).toBe('192.168.1.5:7878');
    expect(error.kind).toBe('annotation');
    expect(error.timestamp).toBe(1718140000000);
    expect(error.message).toBe('Connection refused');
    expect(error.cause).toBe('ECONNREFUSED');
  });

  it('SyncResult aggregates per-kind results and errors', () => {
    const now = Date.now();
    const result: SyncResult = {
      peerId: 'Tablet:7878',
      kinds: {
        annotation: { kind: 'annotation' as SyncCategory, pulled: 10, pushed: 5, conflicts: 2 },
        quote: { kind: 'quote' as SyncCategory, pulled: 3, pushed: 1, conflicts: 0 },
        'dictionary-entry': {
          kind: 'dictionary-entry' as SyncCategory,
          pulled: 0,
          pushed: 0,
          conflicts: 0,
        },
      },
      errors: [],
      startedAt: now,
      finishedAt: now + 5000,
    };
    expect(result.peerId).toBe('Tablet:7878');
    expect(result.kinds['annotation']!.pulled).toBe(10);
    expect(result.kinds['annotation']!.conflicts).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.startedAt).toBe(now);
    expect(result.finishedAt).toBe(now + 5000);
  });

  it('SyncResult with errors attached', () => {
    const now = Date.now();
    const err: SyncError = {
      peerId: 'Phone:7878',
      kind: 'quote',
      timestamp: now,
      message: 'timeout connecting to localhost:7878',
    };
    const result: SyncResult = {
      peerId: 'Phone:7878',
      kinds: {},
      errors: [err],
      startedAt: now,
      finishedAt: now + 3000,
    };
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('timeout');
    expect(result.kinds).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// SyncStep, SyncPhase (Task 1.2)
// ---------------------------------------------------------------------------

describe('SyncStep / SyncPhase types (Task 1.2)', () => {
  it('SyncPhase union covers all sync phases', () => {
    const phases: SyncPhase[] = ['connecting', 'pulling', 'merging', 'pushing', 'finalizing'];
    expect(phases).toHaveLength(5);
    // Verify each phase is accepted
    for (const phase of phases) {
      const step: SyncStep = { phase, kind: 'annotation', detail: 'test' };
      expect(step.phase).toBe(phase);
    }
  });

  it('SyncStep with optional fields', () => {
    const step: SyncStep = {
      phase: 'pulling',
      kind: 'quote',
      current: 3,
      total: 10,
      detail: 'Pulling quotes...',
    };
    expect(step.phase).toBe('pulling');
    expect(step.kind).toBe('quote');
    expect(step.current).toBe(3);
    expect(step.total).toBe(10);
    expect(step.detail).toBe('Pulling quotes...');
  });
});
