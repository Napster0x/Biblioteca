/**
 * Singleton cache for AnotacionesService open promises.
 *
 * Ensures only ONE database connection is opened per AppService lifetime.
 * Prevents StrictMode double-open issues with Turso WASM shared state.
 *
 * The WeakMap key guarantees the connection is garbage-collected
 * when the AppService instance is released.
 */
import type { AppService } from '@/types/system';
import { AnotacionesService } from './AnotacionesService';

const connections = new WeakMap<AppService, Promise<AnotacionesService>>();

export async function getAnotacionesService(appService: AppService): Promise<AnotacionesService> {
  let svc = connections.get(appService);
  if (svc) return svc;

  svc = AnotacionesService.open(appService).catch((err: unknown) => {
    connections.delete(appService);
    throw err;
  });
  connections.set(appService, svc);
  return svc;
}
