'use client';

import { useCallback, useEffect, useState } from 'react';
import { PiWarningCircle } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { getDictionaryService } from '@/services/dictionary/dictionaryServiceCache';
import DictionaryGrid from './DictionaryGrid';

export default function DictionaryPage() {
  const { appService } = useEnv();
  const [service, setService] = useState<Awaited<ReturnType<typeof getDictionaryService>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;

    getDictionaryService(appService)
      .then((svc) => {
        if (!cancelled) {
          setService(svc);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al abrir el diccionario');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appService, retryNonce]);

  const handleRetry = useCallback(() => {
    setError(null);
    setService(null);
    setRetryNonce((value) => value + 1);
  }, []);

  if (error) {
    return (
      <main className='text-base-content full-height flex flex-col bg-base-200'>
        <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center sm:px-6'>
          <PiWarningCircle aria-hidden className='text-error size-10' />
          <div>
            <h2 className='text-lg font-semibold'>Error al abrir el diccionario</h2>
            <p className='text-base-content/60 mt-1 text-sm'>{error}</p>
          </div>
          <button type='button' className='btn btn-primary' onClick={handleRetry}>
            Reintentar
          </button>
        </section>
      </main>
    );
  }

  if (!service) {
    return (
      <main className='text-base-content full-height flex flex-col bg-base-200'>
        <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6'>
          <p className='text-base-content/60'>Inicializando diccionario…</p>
        </section>
      </main>
    );
  }

  return <DictionaryGrid service={service} appService={appService} />;
}
