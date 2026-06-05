'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { getAnotacionesService } from '@/services/annotations/annotacionesServiceCache';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import AnotacionesGrid from './AnotacionesGrid';

export default function AnotacionesPage() {
  const { appService } = useEnv();
  const _ = useTranslation();
  const [service, setService] = useState<AnotacionesService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;

    getAnotacionesService(appService)
      .then((svc) => {
        if (!cancelled) {
          setService(svc);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open Anotaciones');
        }
      });

    return () => {
      cancelled = true;
    };
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
          <h2 className='text-lg font-semibold'>{_('Could not open Anotaciones')}</h2>
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
          <p className='text-base-content/60'>{_('Initializing annotations\u2026')}</p>
        </section>
      </main>
    );
  }

  return <AnotacionesGrid service={service} />;
}
