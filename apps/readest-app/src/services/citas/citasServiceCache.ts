/**
 * Singleton cache for CitasService open promises.
 *
 * Ensures only ONE database connection is opened per AppService lifetime.
 * Prevents StrictMode double-open issues with Turso WASM shared state.
 *
 * The WeakMap key guarantees the connection is garbage-collected
 * when the AppService instance is released.
 */
import type { AppService } from '@/types/system';
import { CitasService } from './CitasService';

const connections = new WeakMap<AppService, Promise<CitasService>>();

export async function getCitasService(appService: AppService): Promise<CitasService> {
  let svc = connections.get(appService);
  if (svc) return svc;

  svc = CitasService.open(appService).catch((err: unknown) => {
    connections.delete(appService);
    throw err;
  });
  connections.set(appService, svc);
  return svc;
}
