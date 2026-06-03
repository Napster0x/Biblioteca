'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { getCitasService } from '@/services/citas/citasServiceCache';
import type { CitasService } from '@/services/citas/CitasService';
import CitasGrid from './CitasGrid';

export default function CitasPage() {
  const { appService } = useEnv();
  const _ = useTranslation();
  const [service, setService] = useState<CitasService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;

    getCitasService(appService)
      .then((svc) => {
        if (!cancelled) {
          setService(svc);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open Citas');
        }
      });

    return () => {
      cancelled = true;
    };
    // `appService` and `retryNonce` are the only deps that should re-trigger
    // the open attempt. We deliberately omit the translation function: under
    // jsdom + the test mock, `useTranslation` returns a fresh closure on
    // every render, which would loop the effect and exhaust the mock queue.
    // In production the i18n hook is stable; we only need `_` for JSX
    // literals (handled by the JSX path, not the effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <h2 className='text-lg font-semibold'>{_('Could not open Citas')}</h2>
          <p className='text-base-content/60 mt-1 text-sm'>{error}</p>
          <button type='button' className='btn btn-primary' onClick={handleRetry}>
            {_('Retry')}
          </button>
        </section>
      </main>
    );
  }

  if (!service) {
    return (
      <main className='text-base-content full-height flex flex-col bg-base-200'>
        <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6'>
          <p className='text-base-content/60'>{_('Initializing quotes…')}</p>
        </section>
      </main>
    );
  }

  return <CitasGrid service={service} appService={appService} />;
}
