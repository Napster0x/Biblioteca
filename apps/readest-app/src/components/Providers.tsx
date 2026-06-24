'use client';

import '@/utils/polyfill';
import i18n from '@/i18n/i18n';
import { useEffect } from 'react';
import { IconContext } from 'react-icons';
import { useEnv } from '@/context/EnvContext';

import { initSystemThemeListener, loadDataTheme } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useEinkMode } from '@/hooks/useEinkMode';
import { getLocale } from '@/utils/misc';
import { getDirFromUILanguage } from '@/utils/rtl';
import { getAndroidPatchedViewportContent } from '@/utils/viewport';
import { DropdownProvider } from '@/context/DropdownContext';
import { CommandPaletteProvider, CommandPalette } from '@/components/command-palette';
import AtmosphereOverlay from '@/components/AtmosphereOverlay';
import AppLockScreen from '@/components/AppLockScreen';
import AppLockDialog from '@/components/settings/AppLockDialog';
import { useAppLockStore } from '@/store/appLockStore';
import { useReplicaSync } from '@/hooks/useReplicaSync';
import { DebugSyncTrigger, type DebugSyncTriggerEnv } from '@/components/DebugSyncTrigger';

/** Wraps useReplicaSync so WebDAV sync polls on every page, not only in settings. */
function ReplicaSyncProvider({ children }: { children: React.ReactNode }) {
  useReplicaSync();
  return <>{children}</>;
}

const Providers = ({ children }: { children: React.ReactNode }) => {
  const { envConfig, appService } = useEnv();
  const { applyUILanguage } = useSettingsStore();
  const { applyBackgroundTexture } = useBackgroundTexture();
  const { applyEinkMode } = useEinkMode();
  const {
    isInitialized: isLockInitialized,
    isUnlocked,
    initialize: initializeAppLock,
  } = useAppLockStore();
  const iconSize = useDefaultIconSize();
  useSafeAreaInsets(); // Initialize safe area insets

  useEffect(() => {
    const handlerLanguageChanged = (lng: string) => {
      document.documentElement.lang = lng;
      // Set RTL class on document for targeted styling without affecting layout
      const dir = getDirFromUILanguage();
      if (dir === 'rtl') {
        document.documentElement.classList.add('ui-rtl');
      } else {
        document.documentElement.classList.remove('ui-rtl');
      }
    };

    const locale = getLocale();
    handlerLanguageChanged(locale);
    i18n.on('languageChanged', handlerLanguageChanged);
    return () => {
      i18n.off('languageChanged', handlerLanguageChanged);
    };
  }, []);

  useEffect(() => {
    loadDataTheme();
    if (appService) {
      initSystemThemeListener(appService);
      appService.loadSettings().then((settings) => {
        const globalViewSettings = settings.globalViewSettings;
        applyUILanguage(globalViewSettings.uiLanguage);
        // Seed the customTextureStore with the disk-loaded textures (preserving
        // their saved ids) so the boot-time applyBackgroundTexture below can
        // resolve a custom textureId.
        if (settings.customTextures?.length) {
          useCustomTextureStore.getState().setTextures(settings.customTextures);
        }
        applyBackgroundTexture(envConfig, globalViewSettings);
        if (globalViewSettings.isEink) {
          applyEinkMode(true);
        }
        // Initialize the app-lock gate from on-disk settings. Until
        // this runs, the gate renders nothing — guarantees the
        // library can't flash on screen before the lock screen does.
        initializeAppLock({
          enabled: !!settings.pinCodeEnabled,
          hash: settings.pinCodeHash,
          salt: settings.pinCodeSalt,
        });
      });
    }
  }, [
    envConfig,
    appService,
    applyUILanguage,
    applyBackgroundTexture,
    applyEinkMode,
    initializeAppLock,
  ]);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const updated = getAndroidPatchedViewportContent(navigator.userAgent, meta.content);
    if (updated) meta.content = updated;
  }, []);

  // Make sure appService is available in all children components
  if (!appService) return;

  // App-lock gate. While the lock store is uninitialized we render
  // nothing — without this guard the library would flash on screen
  // for a few hundred ms before `loadSettings` resolved and let the
  // lock store decide whether to lock.
  const showAppLockScreen = isLockInitialized && !isUnlocked;
  const appShellHidden = !isLockInitialized || !isUnlocked;
  const debugSyncEnv: DebugSyncTriggerEnv = {
    nodeEnv: process.env.NODE_ENV,
    devHarness: process.env.NEXT_PUBLIC_BIBLIOTECA_DEV_SYNC_HARNESS,
  };
  const shouldMountDebugSyncTrigger =
    debugSyncEnv.nodeEnv === 'development' || debugSyncEnv.devHarness === '1';

  return (
    <IconContext.Provider value={{ size: `${iconSize}px` }}>
      <DropdownProvider>
        <CommandPaletteProvider>
          <ReplicaSyncProvider>
            {shouldMountDebugSyncTrigger && <DebugSyncTrigger env={debugSyncEnv} />}
            <div
              aria-hidden={appShellHidden}
              style={appShellHidden ? { display: 'none' } : undefined}
            >
              {children}
              <CommandPalette />
              <AtmosphereOverlay />
            </div>
          </ReplicaSyncProvider>
          <AppLockDialog />
          {showAppLockScreen && <AppLockScreen />}
        </CommandPaletteProvider>
      </DropdownProvider>
    </IconContext.Provider>
  );
};

export default Providers;
// 1781719693
// force-reload 1781723436.274979210
// hmr-poke 1781723768
// poke 1781781516.131813

// poke 1781781980.729009
