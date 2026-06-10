import { describe, expect, it, beforeEach } from 'vitest';
import { useLocalSyncStore } from '@/store/localSyncStore';
import type { PeerInfo } from '@/types/settings';

const makePeer = (host: string): PeerInfo => ({
  host,
  port: 7878,
  deviceName: `Device-${host}`,
  version: '1.0.9',
});

describe('localSyncStore', () => {
  beforeEach(() => {
    useLocalSyncStore.setState({
      peers: [],
      isDiscovering: false,
    });
  });

  describe('peers management', () => {
    it('starts with an empty peers array', () => {
      expect(useLocalSyncStore.getState().peers).toEqual([]);
    });

    it('adds a peer to the list', () => {
      const peer = makePeer('192.168.1.5');
      useLocalSyncStore.getState().addPeer(peer);
      expect(useLocalSyncStore.getState().peers).toEqual([peer]);
    });

    it('adds multiple peers', () => {
      const peer1 = makePeer('192.168.1.5');
      const peer2 = makePeer('192.168.1.6');
      useLocalSyncStore.getState().addPeer(peer1);
      useLocalSyncStore.getState().addPeer(peer2);
      expect(useLocalSyncStore.getState().peers).toEqual([peer1, peer2]);
    });

    it('upserts peer by host+port (deduplication)', () => {
      const peer1 = makePeer('192.168.1.5');
      const peer2 = { ...peer1, deviceName: 'Updated' };
      useLocalSyncStore.getState().addPeer(peer1);
      useLocalSyncStore.getState().addPeer(peer2);
      expect(useLocalSyncStore.getState().peers).toHaveLength(1);
      expect(useLocalSyncStore.getState().peers[0].deviceName).toBe('Updated');
    });

    it('removes a peer by host', () => {
      const peer1 = makePeer('192.168.1.5');
      const peer2 = makePeer('192.168.1.6');
      useLocalSyncStore.setState({ peers: [peer1, peer2] });
      useLocalSyncStore.getState().removePeer('192.168.1.5');
      expect(useLocalSyncStore.getState().peers).toEqual([peer2]);
    });

    it('removing a non-existent peer is a no-op', () => {
      const peer = makePeer('192.168.1.5');
      useLocalSyncStore.setState({ peers: [peer] });
      useLocalSyncStore.getState().removePeer('no-such-host');
      expect(useLocalSyncStore.getState().peers).toEqual([peer]);
    });

    it('clears all peers', () => {
      useLocalSyncStore.setState({
        peers: [makePeer('192.168.1.5'), makePeer('192.168.1.6')],
      });
      useLocalSyncStore.getState().clearPeers();
      expect(useLocalSyncStore.getState().peers).toEqual([]);
    });
  });

  describe('discovery state', () => {
    it('starts with isDiscovering set to false', () => {
      expect(useLocalSyncStore.getState().isDiscovering).toBe(false);
    });

    it('startDiscovery sets isDiscovering to true', () => {
      useLocalSyncStore.getState().startDiscovery();
      expect(useLocalSyncStore.getState().isDiscovering).toBe(true);
    });

    it('stopDiscovery sets isDiscovering to false', () => {
      useLocalSyncStore.getState().startDiscovery();
      useLocalSyncStore.getState().stopDiscovery();
      expect(useLocalSyncStore.getState().isDiscovering).toBe(false);
    });

    it('stopDiscovery does not clear peers', () => {
      const peer = makePeer('192.168.1.5');
      useLocalSyncStore.setState({ peers: [peer], isDiscovering: true });
      useLocalSyncStore.getState().stopDiscovery();
      expect(useLocalSyncStore.getState().peers).toEqual([peer]);
      expect(useLocalSyncStore.getState().isDiscovering).toBe(false);
    });
  });
});
