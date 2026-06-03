'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiBookBookmark, PiMagnifyingGlass, PiSelectionAll, PiTrash, PiX } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { CitasService } from '@/services/citas/CitasService';
import { useCitasStore } from '@/store/citasStore';
import { navigateToLibrary } from '@/utils/nav';
import CitasTile from './CitasTile';

interface CitasGridProps {
  service: CitasService;
}

export default function CitasGrid({ service }: CitasGridProps) {
  const _ = useTranslation();
  const router = useRouter();
  const quotes = useCitasStore((s) => s.quotes);
  const isSelectMode = useCitasStore((s) => s.isSelectMode);
  const selectedQuoteIds = useCitasStore((s) => s.selectedQuoteIds);
  const loadQuotes = useCitasStore((s) => s.loadQuotes);
  const searchQuotes = useCitasStore((s) => s.searchQuotes);
  const enterSelectMode = useCitasStore((s) => s.enterSelectMode);
  const cancelSelectMode = useCitasStore((s) => s.cancelSelectMode);
  const deleteSelectedQuotes = useCitasStore((s) => s.deleteSelectedQuotes);

  const [search, setSearch] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    loadQuotes(service);
  }, [loadQuotes, service]);

  const filteredQuotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return quotes;
    return quotes.filter(
      (quote) =>
        quote.text.toLowerCase().includes(query) ||
        (quote.bookAuthor ?? '').toLowerCase().includes(query),
    );
  }, [quotes, search]);

  const handleBack = useCallback(() => {
    navigateToLibrary(router);
  }, [router]);

  const handleSearchChange = useCallback(
    (nextSearch: string) => {
      setSearch(nextSearch);
      void searchQuotes(nextSearch, service);
    },
    [searchQuotes, service],
  );

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    await deleteSelectedQuotes(service);
    setShowDeleteConfirm(false);
  }, [deleteSelectedQuotes, service]);

  return (
    <main className='text-base-content full-height flex flex-col bg-base-200'>
      <section className='mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6'>
        <div className='mb-6 flex items-center gap-3'>
          <button
            type='button'
            onClick={handleBack}
            className='flex items-center justify-center rounded-full transition-colors hover:bg-black/10'
            aria-label={_('Back to Library')}
          >
            <PiBookBookmark aria-hidden className='text-base-content/60 size-7' />
          </button>
          <h1 className='font-serif text-2xl font-semibold tracking-tight'>{_('Citas')}</h1>
        </div>

        <div className='relative mb-4'>
          <PiMagnifyingGlass
            aria-hidden
            className='text-base-content/40 pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2'
          />
          <input
            type='text'
            className='eink-bordered input input-sm w-full bg-base-100 pl-9'
            placeholder={_('Search…')}
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            aria-label={_('Search')}
          />
          <div className='absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1'>
            {/* NO PiPlus / add button. Quotes can only be created from the
                reader in Fase 2; the empty Citas page is intentional. */}
            <button
              type='button'
              onClick={enterSelectMode}
              className='btn btn-ghost btn-xs eink-bordered flex h-7 w-7 items-center justify-center p-0'
              aria-label={_('Select')}
              title={_('Select')}
            >
              <PiSelectionAll aria-hidden className='size-4' />
            </button>
          </div>
        </div>

        {filteredQuotes.length === 0 ? (
          <div className='eink-bordered bg-base-100 flex flex-1 flex-col items-center justify-center rounded-2xl p-8 text-center'>
            <PiBookBookmark aria-hidden className='text-base-content/60 mb-6 size-16' />
            {search ? (
              <>
                <h2 className='mb-2 text-xl font-semibold'>{_('No results')}</h2>
                <p className='text-base-content/70 max-w-md text-pretty text-sm'>
                  {_('Quotes are created when you save a passage from the reader.')}
                </p>
              </>
            ) : (
              <>
                <h2 className='mb-2 text-xl font-semibold'>
                  {_('Your quotes collection is empty')}
                </h2>
                <p className='text-base-content/70 max-w-md text-pretty text-sm'>
                  {_('Quotes are created when you save a passage from the reader.')}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className='flex flex-col gap-3' role='list' aria-label={_('Quotes')}>
            {filteredQuotes.map((quote) => (
              <div key={quote.id} role='listitem'>
                <CitasTile quote={quote} />
              </div>
            ))}
          </div>
        )}

        {isSelectMode && (
          <div className='fixed bottom-0 left-0 right-0 z-40 pb-4'>
            <div className='eink-bordered bg-base-100 mx-auto flex w-fit max-w-[calc(100vw-1rem)] items-center justify-center gap-x-6 rounded-lg p-4 shadow-lg'>
              <button
                type='button'
                onClick={handleDeleteClick}
                disabled={selectedQuoteIds.length === 0}
                className='flex flex-col items-center gap-1 disabled:opacity-50'
                aria-label={_('Delete selected')}
              >
                <PiTrash aria-hidden className='size-5 text-red-500' />
                <span className='text-xs text-red-500'>{_('Delete')}</span>
              </button>
              <button
                type='button'
                onClick={cancelSelectMode}
                className='flex flex-col items-center gap-1'
                aria-label={_('Cancel')}
              >
                <PiX aria-hidden className='size-5' />
                <span className='text-xs'>{_('Cancel')}</span>
              </button>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/30'
            role='dialog'
            aria-label={_('Delete selected')}
            aria-modal='true'
          >
            <div className='eink-bordered bg-base-100 mx-4 w-full max-w-sm rounded-2xl p-6 shadow-xl'>
              <h3 className='mb-2 text-lg font-semibold'>{_('Delete selected')}</h3>
              <p className='text-base-content/70 mb-6 text-sm'>
                {_('¿Borrar {count} entrada(s) seleccionada(s)?', {
                  count: String(selectedQuoteIds.length),
                })}
              </p>
              <div className='flex justify-end gap-3'>
                <button
                  type='button'
                  onClick={handleCancelDelete}
                  className='btn btn-ghost btn-sm eink-bordered'
                >
                  {_('Cancel')}
                </button>
                <button
                  type='button'
                  onClick={handleConfirmDelete}
                  className='btn btn-primary btn-sm'
                >
                  {_('Delete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
