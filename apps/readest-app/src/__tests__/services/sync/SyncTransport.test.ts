import { describe, expect, it } from 'vitest';
import type { SyncTransport } from '@/services/sync/SyncTransport';
import type { ReplicaRow, Hlc } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HLC_A = '0000000000001-00000001-test-dev' as Hlc;

function makeRow(id: string, hlc: Hlc, kind: string = 'annotation'): ReplicaRow {
  return {
    user_id: '',
    kind,
    replica_id: `${kind}:${id}`,
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

function makeBytes(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

// ---------------------------------------------------------------------------
// Contract validation
// ---------------------------------------------------------------------------

describe('SyncTransport interface', () => {
  it('allows a concrete class to implement the interface contract', async () => {
    // This test verifies the interface shape by constructing an object
    // that satisfies SyncTransport and calling its methods.
    const transport: SyncTransport = {
      kind: 'webdav',
      pull: async (_kind: SyncCategory, _since?: Hlc) => [],
      push: async (_kind: SyncCategory, _rows: ReplicaRow[]) => undefined,
      pullDictionaryImage: async (_entryId: string) => null,
      pushDictionaryImage: async (_entryId: string, _imageBytes: ArrayBuffer) => ({
        uploaded: true,
      }),
      isReachable: async () => true,
    };

    // pull — empty result
    expect(await transport.pull('annotation')).toEqual([]);

    // pull — with since cursor, returns filtered rows
    const row = makeRow('annot-1', HLC_A, 'annotation');
    transport.pull = async (_kind, _since?) => [row];
    const pulled = await transport.pull('annotation', HLC_A);
    expect(pulled).toHaveLength(1);
    expect(pulled[0]!.replica_id).toBe('annotation:annot-1');
    expect(pulled[0]!.schema_version).toBe(1);

    // push
    transport.push = async (_kind, _rows) => undefined;
    await transport.push('annotation', [row]);
    // Should not throw

    // pullDictionaryImage — nullable result
    expect(await transport.pullDictionaryImage('entry-1')).toBeNull();
    const bytes = makeBytes();
    transport.pullDictionaryImage = async (_entryId) => bytes;
    expect(await transport.pullDictionaryImage('entry-1')).toBe(bytes);

    // pushDictionaryImage
    transport.pushDictionaryImage = async (_entryId, _imageBytes) => ({ uploaded: true });
    const result = await transport.pushDictionaryImage('entry-1', bytes);
    expect(result.uploaded).toBe(true);

    // isReachable
    expect(await transport.isReachable!()).toBe(true);
    transport.isReachable = async () => false;
    expect(await transport.isReachable!()).toBe(false);
  });

  it('requires optional methods to be callable with correct signatures', async () => {
    // Optional methods (pullDictionaryImage, pushDictionaryImage, isReachable)
    // must accept the right argument types and return the expected types
    // when implemented.
    const transport: SyncTransport = {
      kind: 'wifi',
      pull: async (_kind: SyncCategory, _since?: Hlc) => [],
      push: async (_kind: SyncCategory, _rows: ReplicaRow[]) => undefined,
      pullDictionaryImage: async (_entryId: string) => new Uint8Array([5, 6, 7]).buffer,
      pushDictionaryImage: async (_entryId: string, _imageBytes: ArrayBuffer) => ({
        uploaded: false,
      }),
      isReachable: async () => false,
    };

    // Verify optional methods return correct types
    const pulled = await transport.pullDictionaryImage('entry-2');
    expect(pulled).toBeInstanceOf(ArrayBuffer);

    const pushed = await transport.pushDictionaryImage!('entry-2', makeBytes());
    expect(pushed).toEqual({ uploaded: false });

    const reachable = await transport.isReachable!();
    expect(reachable).toBe(false);
  });

  it('allows transport without optional methods (implemented via class)', () => {
    // A minimal transport with only required methods should satisfy the interface.
    // Optional methods are truly optional at the type level.
    class MinimalTransport implements SyncTransport {
      readonly kind = 'usb' as const;

      async pull(_kind: SyncCategory, _since?: Hlc): Promise<ReplicaRow[]> {
        return [];
      }

      async push(_kind: SyncCategory, _rows: ReplicaRow[]): Promise<void> {
        // no-op
      }
    }

    const t: SyncTransport = new MinimalTransport();
    expect(t.kind).toBe('usb');
    expect(t.pullDictionaryImage).toBeUndefined();
    expect(t.pushDictionaryImage).toBeUndefined();
    expect(t.isReachable).toBeUndefined();
  });

  it('enforces kind to be one of the three allowed literal values', () => {
    // Type-level check: SyncTransport['kind'] must be 'webdav' | 'wifi' | 'usb'
    const validKinds: SyncTransport['kind'][] = ['webdav', 'wifi', 'usb'];
    expect(validKinds).toHaveLength(3);
  });
});
