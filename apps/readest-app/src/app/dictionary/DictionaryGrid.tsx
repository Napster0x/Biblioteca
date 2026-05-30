'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiBookBookmark, PiCaretLeft, PiMagnifyingGlass, PiSpinner } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { navigateToLibrary } from '@/utils/nav';
import DictionaryTile from './DictionaryTile';

interface DictionaryGridProps {
  service: DictionaryService;
}

export default function DictionaryGrid({ service }: DictionaryGridProps) {
  const _ = useTranslation();
  const router = useRouter();
  const entries = useDictionaryStore((s) => s.entries);
  const isLoading = useDictionaryStore((s) => s.isLoading);
  const loadEntries = useDictionaryStore((s) => s.loadEntries);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadEntries(service);
  }, [loadEntries, service]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(
      (entry) =>
        entry.displayTerm.toLowerCase().includes(query) ||
        (entry.definition ?? '').toLowerCase().includes(query),
    );
  }, [entries, search]);

  if (isLoading && entries.length === 0) {
    return (
      <main className='text-base-content full-height flex flex-col bg-base-200'>
        <section className='mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6'>
          <PiSpinner aria-hidden className='mb-4 size-10 animate-spin' />
          <p className='text-base-content/60'>{_('Cargando…')}</p>
        </section>
      </main>
    );
  }

  return (
    <main className='text-base-content full-height flex flex-col bg-base-200'>
      <section className='mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6'>
        <div className='mb-6 flex items-center gap-3'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered gap-1'
            onClick={() => navigateToLibrary(router)}
            aria-label={_('Volver')}
          >
            <PiCaretLeft aria-hidden className='size-4' />
            {_('Volver')}
          </button>
          <PiBookBookmark aria-hidden className='text-base-content/60 size-7' />
          <h1 className='text-2xl font-semibold tracking-tight'>{_('Diccionario')}</h1>
        </div>

        <div className='relative mb-4'>
          <PiMagnifyingGlass
            aria-hidden
            className='text-base-content/40 pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2'
          />
          <input
            type='text'
            className='eink-bordered input input-sm w-full bg-base-100 pl-9'
            placeholder={_('Buscar…')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={_('Buscar')}
          />
        </div>

        {isLoading && (
          <div className='mb-4 flex items-center gap-2 text-sm text-base-content/60'>
            <PiSpinner aria-hidden className='size-4 animate-spin' />
            {_('Actualizando…')}
          </div>
        )}

        {filteredEntries.length === 0 && !isLoading ? (
          <div className='eink-bordered bg-base-100 flex flex-1 flex-col items-center justify-center rounded-2xl p-8 text-center'>
            <PiBookBookmark aria-hidden className='text-base-content/60 mb-6 size-16' />
            {search ? (
              <>
                <h2 className='mb-2 text-xl font-semibold'>{_('Sin resultados')}</h2>
                <p className='text-base-content/70 max-w-md text-pretty text-sm'>
                  {_('No hay entradas que coincidan con tu búsqueda.')}
                </p>
              </>
            ) : (
              <>
                <h2 className='mb-2 text-xl font-semibold'>{_('Tu diccionario está vacío')}</h2>
                <p className='text-base-content/70 max-w-md text-pretty text-sm'>
                  {_(
                    'Selecciona una palabra mientras lees y guárdala con «Diccionario». Las palabras que guardes aparecerán aquí.',
                  )}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5'>
            {filteredEntries.map((entry) => (
              <DictionaryTile key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
