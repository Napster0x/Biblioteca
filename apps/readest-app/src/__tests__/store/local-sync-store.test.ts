import { beforeEach, describe, expect, it } from 'vitest';
import { useLocalSyncStore } from '@/store/localSyncStore';
import type { PeerInfo } from '@/types/settings';

const usbPeer: PeerInfo = {
  host: 'localhost',
  port: 7878,
  deviceName: 'USB Phone',
  version: '1.0.0',
  kind: 'usb',
  reachable: true,
};

describe('localSyncStore USB-only state', () => {
  beforeEach(() => {
    useLocalSyncStore.getState().resetUsbSync();
  });

  it('starts in the off state without a peer or discovery flags', () => {
    const state = useLocalSyncStore.getState();

    expect(state.usbState).toBe('off');
    expect(state.usbPeer).toBeNull();
    expect('isDiscovering' in state).toBe(false);
    expect('peers' in state).toBe(false);
  });

  it('stores exactly one USB peer for the active ADB tunnel', () => {
    useLocalSyncStore.getState().setUsbPeer(usbPeer);

    expect(useLocalSyncStore.getState().usbPeer).toEqual(usbPeer);
  });

  it('resetUsbSync clears USB-only runtime state', () => {
    useLocalSyncStore.getState().setUsbState('ready');
    useLocalSyncStore.getState().setUsbPeer(usbPeer);
    useLocalSyncStore.getState().setSyncPort(9999);

    useLocalSyncStore.getState().resetUsbSync();

    expect(useLocalSyncStore.getState().usbState).toBe('off');
    expect(useLocalSyncStore.getState().usbPeer).toBeNull();
    expect(useLocalSyncStore.getState().syncPort).toBe(7878);
  });
});
