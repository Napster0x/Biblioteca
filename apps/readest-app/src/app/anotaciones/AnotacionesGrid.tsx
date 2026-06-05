'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiBookBookmark, PiMagnifyingGlass, PiSelectionAll, PiTrash, PiX } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { softDeleteAnotacionesHighlights } from '@/app/reader/utils/annotacionesCapture';
import { navigateToLibrary } from '@/utils/nav';
import AnotacionTile from './AnotacionTile';

interface AnotacionesGridProps {
  service: AnotacionesService;
}

export default function AnotacionesGrid({ service }: AnotacionesGridProps) {
  const _ = useTranslation();
  const router = useRouter();
  const { appService, envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const annotations = useAnotacionesStore((s) => s.annotations);
  const isSelectMode = useAnotacionesStore((s) => s.isSelectMode);
  const selectedAnnotationIds = useAnotacionesStore((s) => s.selectedAnnotationIds);
  const loadAnnotations = useAnotacionesStore((s) => s.loadAnnotations);
  const deleteAnnotations = useAnotacionesStore((s) => s.deleteAnnotations);
  const enterSelectMode = useAnotacionesStore((s) => s.enterSelectMode);
  const exitSelectMode = useAnotacionesStore((s) => s.exitSelectMode);

  const [search, setSearch] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const filteredAnnotations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return annotations;
    return annotations.filter(
      (a) =>
        a.text.toLowerCase().includes(query) ||
        (a.bookAuthor ?? '').toLowerCase().includes(query) ||
        (a.bookTitle ?? '').toLowerCase().includes(query) ||
        a.note.toLowerCase().includes(query),
    );
  }, [annotations, search]);

  useEffect(() => {
    loadAnnotations(service);
  }, [loadAnnotations, service]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const highlight = params.get('highlight');
    if (highlight) {
      setHighlightedId(highlight);
      setSearch('');
    }
  }, []);

  useEffect(() => {
    if (!highlightedId || filteredAnnotations.length === 0) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(highlightedId)?.scrollIntoView({
        behavior: 'instant',
        block: 'center',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightedId, filteredAnnotations]);

  const handleBack = useCallback(() => {
    navigateToLibrary(router);
  }, [router]);

  const handleSearchChange = useCallback((nextSearch: string) => {
    setSearch(nextSearch);
  }, []);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const ids = selectedAnnotationIds;

    // Soft-delete BookNotes in reader configs so the highlights disappear
    // from the reader even before the user re-opens the book.
    try {
      await softDeleteAnotacionesHighlights(annotations, ids, appService, envConfig, settings);
    } catch (err) {
      console.warn('Failed to soft-delete annotation highlights:', err);
    }

    await deleteAnnotations(ids, service);
    exitSelectMode();
    setShowDeleteConfirm(false);
  }, [
    annotations,
    appService,
    deleteAnnotations,
    envConfig,
    exitSelectMode,
    selectedAnnotationIds,
    service,
    settings,
  ]);

  return (
    <main className='text-base-content full-height flex flex-col overflow-y-auto bg-base-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
      <section className='mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-24 pt-5 sm:px-6 sm:pt-6'>
        <div className='mb-6 flex items-center gap-4'>
          <button
            type='button'
            onClick={handleBack}
            className='mt-1 flex self-center items-center justify-center rounded-full transition-colors hover:bg-black/10'
            aria-label={_('Back to Library')}
          >
            <span
              aria-hidden='true'
              className='relative inline-block size-7 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.9)_0%,rgba(247,233,170,0.98)_18%,rgba(214,176,62,0.96)_60%,rgba(162,120,18,0.92)_100%)] shadow-[0_2px_4px_rgba(0,0,0,0.28),0_7px_18px_rgba(0,0,0,0.16),0_0_14px_rgba(214,176,62,0.34)] before:absolute before:left-[20%] before:top-[16%] before:h-[20%] before:w-[20%] before:rounded-full before:bg-white/75 before:content-[""] after:absolute after:left-1/2 after:top-[115%] after:h-[26%] after:w-[130%] after:-translate-x-1/2 after:rounded-full after:bg-black/12 after:blur-[2px] after:content-[""]'
            />
          </button>
          <h1
            className='font-["Times_New_Roman",Times,serif] text-4xl font-semibold italic tracking-[0.02em] text-white sm:text-5xl'
            style={{
              WebkitTextStroke: '0.45px rgba(214,170,32,0.52)',
              textShadow:
                '0 1px 0 rgba(255,255,255,0.15), 0 2px 6px rgba(0,0,0,0.24), 0 0 10px rgba(214,170,32,0.12)',
            }}
          >
            {_('Anotaciones')}
          </h1>
        </div>

        <div className='relative mb-4'>
          <PiMagnifyingGlass
            aria-hidden
            className='text-base-content/40 pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2'
          />
          <input
            type='text'
            className='eink-bordered input input-sm w-full bg-base-100 pl-9'
            placeholder={_('Search\u2026')}
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            aria-label={_('Search')}
          />
          <div className='absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1'>
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

        {filteredAnnotations.length === 0 ? (
          <div className='eink-bordered bg-base-100 flex flex-1 flex-col items-center justify-center rounded-2xl p-8 text-center'>
            <PiBookBookmark aria-hidden className='text-base-content/60 mb-6 size-16' />
            {search ? (
              <>
                <h2 className='mb-2 text-xl font-semibold'>{_('No results found')}</h2>
                <p className='text-base-content/70 max-w-md text-pretty text-sm'>
                  {_('Annotations are created when you save a passage from the reader.')}
                </p>
              </>
            ) : (
              <>
                <h2 className='mb-2 text-xl font-semibold'>{_('No annotations yet')}</h2>
                <p className='text-base-content/70 max-w-md text-pretty text-sm'>
                  {_('Annotations are created when you save a passage from the reader.')}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className='flex flex-col gap-3' role='list' aria-label={_('Annotations')}>
            {filteredAnnotations.map((annotation) => (
              <div key={annotation.id} role='listitem'>
                <AnotacionTile
                  annotation={annotation}
                  service={service}
                  isHighlighted={highlightedId === annotation.id}
                />
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
                disabled={selectedAnnotationIds.length === 0}
                className='flex flex-col items-center gap-1 disabled:opacity-50'
                aria-label={_('Delete selected')}
              >
                <PiTrash aria-hidden className='size-5 text-red-500' />
                <span className='text-xs text-red-500'>{_('Delete')}</span>
              </button>
              <button
                type='button'
                onClick={exitSelectMode}
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
                {_('Delete {{count}} selected annotation(s)?', {
                  count: String(selectedAnnotationIds.length),
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
