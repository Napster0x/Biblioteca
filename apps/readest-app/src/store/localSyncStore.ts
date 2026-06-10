import { create } from 'zustand';
import { stubTranslation as _ } from '@/utils/misc';
import type { PeerInfo } from '@/types/settings';

/**
 * i18n keys registered for scanner extraction. These labels are consumed
 * by the LocalSyncPanel React component (Phase 6); the stubTranslation
 * calls here ensure the extraction tool discovers them during
 * `pnpm i18n:extract`.
 */
_('Local Sync');
_('Not connected');
_('Connected');
_('Syncing…');
_('Sync Now');
_('Connect via USB or make sure both devices are on the same WiFi network');

interface LocalSyncState {
  /** mDNS-discovered peers. Upserted keyed on host+port. */
  peers: PeerInfo[];
  /** Whether mDNS discovery is currently browsing. */
  isDiscovering: boolean;

  /** Add or update a peer (upsert by host:port). */
  addPeer: (peer: PeerInfo) => void;
  /** Remove a peer by host. */
  removePeer: (host: string) => void;
  /** Clear all discovered peers. */
  clearPeers: () => void;
  /** Signal that discovery has started. */
  startDiscovery: () => void;
  /** Signal that discovery has stopped. */
  stopDiscovery: () => void;
}

export const useLocalSyncStore = create<LocalSyncState>((set) => ({
  peers: [],
  isDiscovering: false,

  addPeer: (peer) =>
    set((state) => {
      const idx = state.peers.findIndex((p) => p.host === peer.host && p.port === peer.port);
      if (idx >= 0) {
        const peers = [...state.peers];
        peers[idx] = peer;
        return { peers };
      }
      return { peers: [...state.peers, peer] };
    }),

  removePeer: (host) =>
    set((state) => ({
      peers: state.peers.filter((p) => p.host !== host),
    })),

  clearPeers: () => set({ peers: [] }),

  startDiscovery: () => set({ isDiscovering: true }),

  stopDiscovery: () => set({ isDiscovering: false }),
}));
