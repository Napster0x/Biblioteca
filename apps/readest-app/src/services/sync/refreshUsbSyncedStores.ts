import environmentConfig from '@/services/environment';
import { getAnotacionesService } from '@/services/annotations/annotacionesServiceCache';
import { getCitasService } from '@/services/citas/citasServiceCache';
import { getDictionaryService } from '@/services/dictionary/dictionaryServiceCache';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useCitasStore } from '@/store/citasStore';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useLibraryStore } from '@/store/libraryStore';

/**
 * Reload UI stores whose backing databases/files may have been changed by the
 * USB peer server, outside this WebView's Zustand state graph.
 */
export async function refreshUsbSyncedStores(): Promise<void> {
  const appService = await environmentConfig.getAppService().catch((err: unknown) => {
    console.warn('[refreshUsbSyncedStores] app service unavailable:', err);
    return null;
  });
  if (!appService) return;

  const tasks = [
    async () => {
      const service = await getCitasService(appService);
      await useCitasStore.getState().loadQuotes(service);
    },
    async () => {
      const service = await getAnotacionesService(appService);
      await useAnotacionesStore.getState().loadAnnotations(service);
    },
    async () => {
      const service = await getDictionaryService(appService);
      await useDictionaryStore.getState().loadEntries(service);
    },
    async () => {
      const books = await appService.loadLibraryBooks();
      useLibraryStore.getState().setLibrary(books);
    },
  ];

  const results = await Promise.allSettled(tasks.map((task) => task()));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[refreshUsbSyncedStores] store refresh failed:', result.reason);
    }
  }
}
