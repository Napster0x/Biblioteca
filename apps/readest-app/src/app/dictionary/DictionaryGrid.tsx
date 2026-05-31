'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PiBookBookmark,
  PiMagnifyingGlass,
  PiPlus,
  PiSelectionAll,
  PiSpinner,
  PiTrash,
  PiX,
} from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import { useDictionaryStore } from '@/store/dictionaryStore';
import type { AppService } from '@/types/system';
import { navigateToLibrary } from '@/utils/nav';
import DictionaryTile from './DictionaryTile';

interface DictionaryGridProps {
  service: DictionaryService;
  appService?: AppService;
}

export default function DictionaryGrid({ service, appService }: DictionaryGridProps) {
  const _ = useTranslation();
  const router = useRouter();
  const entries = useDictionaryStore((s) => s.entries);
  const isLoading = useDictionaryStore((s) => s.isLoading);
  const isSelectMode = useDictionaryStore((s) => s.isSelectMode);
  const selectedEntryIds = useDictionaryStore((s) => s.selectedEntryIds);
  const loadEntries = useDictionaryStore((s) => s.loadEntries);
  const toggleSelectedEntry = useDictionaryStore((s) => s.toggleSelectedEntry);
  const addEntry = useDictionaryStore((s) => s.addEntry);
  const enterSelectMode = useDictionaryStore((s) => s.enterSelectMode);
  const cancelSelectMode = useDictionaryStore((s) => s.cancelSelectMode);
  const deleteSelectedEntries = useDictionaryStore((s) => s.deleteSelectedEntries);

  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;

    const loadImages = async () => {
      const newUrls: Record<string, string> = {};

      for (const entry of entries) {
        if (!entry.imagePath || loadedIdsRef.current.has(entry.id)) continue;
        try {
          const content = await appService.readFile(entry.imagePath, 'Dictionaries', 'binary');
          if (cancelled) return;
          const blobUrl = URL.createObjectURL(new Blob([content]));
          newUrls[entry.id] = blobUrl;
          objectUrlsRef.current.push(blobUrl);
          loadedIdsRef.current.add(entry.id);
        } catch {
          // Image not found — skip silently
          loadedIdsRef.current.add(entry.id);
        }
      }

      if (!cancelled && Object.keys(newUrls).length > 0) {
        setImageUrls((prev) => ({ ...prev, ...newUrls }));
      }
    };

    loadImages();

    return () => {
      cancelled = true;
    };
  }, [appService, entries]);

  // Revoke blob URLs on unmount
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  const [search, setSearch] = useState('');
  const [showAddWord, setShowAddWord] = useState(false);
  const [addWordTerm, setAddWordTerm] = useState('');
  const [addWordDefinition, setAddWordDefinition] = useState('');
  const [addWordError, setAddWordError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const termInputRef = useRef<HTMLInputElement>(null);

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

  const handleOpenAddWord = useCallback(() => {
    setAddWordTerm('');
    setAddWordDefinition('');
    setAddWordError(null);
    setShowAddWord(true);
  }, []);

  const handleCloseAddWord = useCallback(() => {
    setShowAddWord(false);
    setAddWordError(null);
  }, []);

  const handleSubmitAddWord = useCallback(async () => {
    const trimmed = addWordTerm.trim();
    if (!trimmed) {
      setAddWordError(_('La palabra es obligatoria'));
      return;
    }
    setAddWordError(null);
    await addEntry({ term: trimmed, definition: addWordDefinition.trim() || undefined }, service);
    setShowAddWord(false);
  }, [addWordTerm, addWordDefinition, addEntry, service, _]);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    await deleteSelectedEntries(service);
    setShowDeleteConfirm(false);
  }, [deleteSelectedEntries, service]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  // Focus the term input when the dialog opens
  useEffect(() => {
    if (showAddWord && termInputRef.current) {
      termInputRef.current.focus();
    }
  }, [showAddWord]);

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
            onClick={() => navigateToLibrary(router)}
            className='flex items-center justify-center rounded-full transition-colors hover:bg-black/10'
            aria-label={_('Volver a Biblioteca')}
          >
            <PiBookBookmark aria-hidden className='text-base-content/60 size-7' />
          </button>
          <h1 className='font-serif text-2xl font-semibold tracking-tight'>{_('Diccionario')}</h1>
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
          <div className='absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1'>
            <button
              type='button'
              onClick={handleOpenAddWord}
              className='btn btn-ghost btn-xs eink-bordered flex h-7 w-7 items-center justify-center p-0'
              aria-label={_('Añadir palabra')}
              title={_('Añadir palabra')}
            >
              <PiPlus aria-hidden className='size-4' />
            </button>
            <span className='bg-base-content/30 mx-0.5 h-4 w-px' />
            <button
              type='button'
              onClick={enterSelectMode}
              className='btn btn-ghost btn-xs eink-bordered flex h-7 w-7 items-center justify-center p-0'
              aria-label={_('Seleccionar')}
              title={_('Seleccionar')}
            >
              <PiSelectionAll aria-hidden className='size-4' />
            </button>
          </div>
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
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6'>
            {filteredEntries.map((entry) => (
              <DictionaryTile
                key={entry.id}
                entry={entry}
                imageUrl={imageUrls[entry.id]}
                isSelectMode={isSelectMode}
                isSelected={selectedEntryIds.includes(entry.id)}
                onToggleSelected={toggleSelectedEntry}
              />
            ))}
          </div>
        )}

        {isSelectMode && (
          <div className='fixed bottom-0 left-0 right-0 z-40 pb-4'>
            <div className='eink-bordered bg-base-100 mx-auto flex w-fit max-w-[calc(100vw-1rem)] items-center justify-center gap-x-6 rounded-lg p-4 shadow-lg'>
              <button
                type='button'
                onClick={handleDeleteClick}
                disabled={selectedEntryIds.length === 0}
                className='flex flex-col items-center gap-1 disabled:opacity-50'
                aria-label={_('Borrar seleccionados')}
              >
                <PiTrash aria-hidden className='size-5 text-red-500' />
                <span className='text-xs text-red-500'>{_('Borrar')}</span>
              </button>
              <button
                type='button'
                onClick={cancelSelectMode}
                className='flex flex-col items-center gap-1'
                aria-label={_('Cancelar')}
              >
                <PiX aria-hidden className='size-5' />
                <span className='text-xs'>{_('Cancelar')}</span>
              </button>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/30'
            role='dialog'
            aria-label={_('Confirmar borrado')}
            aria-modal='true'
          >
            <div className='eink-bordered bg-base-100 mx-4 w-full max-w-sm rounded-2xl p-6 shadow-xl'>
              <h3 className='mb-2 text-lg font-semibold'>{_('Borrar entradas')}</h3>
              <p className='text-base-content/70 mb-6 text-sm'>
                {_('¿Borrar {count} entrada(s) seleccionada(s)?', {
                  count: String(selectedEntryIds.length),
                })}
              </p>
              <div className='flex justify-end gap-3'>
                <button
                  type='button'
                  onClick={handleCancelDelete}
                  className='btn btn-ghost btn-sm eink-bordered'
                >
                  {_('No, cancelar')}
                </button>
                <button
                  type='button'
                  onClick={handleConfirmDelete}
                  className='btn btn-primary btn-sm'
                >
                  {_('Sí, borrar')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAddWord && (
          <div
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/30'
            role='dialog'
            aria-label={_('Añadir palabra')}
            aria-modal='true'
          >
            <div className='eink-bordered bg-base-100 mx-4 w-full max-w-sm rounded-2xl p-6 shadow-xl'>
              <div className='mb-4 flex items-center justify-between'>
                <h3 className='text-lg font-semibold'>{_('Añadir palabra')}</h3>
                <button
                  type='button'
                  onClick={handleCloseAddWord}
                  className='btn btn-ghost btn-xs eink-bordered p-1'
                  aria-label={_('Cerrar')}
                >
                  <PiX aria-hidden className='size-4' />
                </button>
              </div>
              <div className='mb-3'>
                <label htmlFor='add-word-term' className='mb-1 block text-sm font-medium'>
                  {_('Palabra')}
                </label>
                <input
                  ref={termInputRef}
                  id='add-word-term'
                  type='text'
                  value={addWordTerm}
                  onChange={(e) => setAddWordTerm(e.target.value)}
                  className='eink-bordered input input-sm w-full bg-base-100'
                  aria-label={_('Palabra')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitAddWord();
                  }}
                />
                {addWordError && (
                  <p className='mt-1 text-xs text-red-500' role='alert'>
                    {addWordError}
                  </p>
                )}
              </div>
              <div className='mb-6'>
                <label htmlFor='add-word-definition' className='mb-1 block text-sm font-medium'>
                  {_('Definición (opcional)')}
                </label>
                <input
                  id='add-word-definition'
                  type='text'
                  value={addWordDefinition}
                  onChange={(e) => setAddWordDefinition(e.target.value)}
                  className='eink-bordered input input-sm w-full bg-base-100'
                  aria-label={_('Definición (opcional)')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitAddWord();
                  }}
                />
              </div>
              <div className='flex justify-end gap-3'>
                <button
                  type='button'
                  onClick={handleCloseAddWord}
                  className='btn btn-ghost btn-sm eink-bordered'
                >
                  {_('Cancelar')}
                </button>
                <button
                  type='button'
                  onClick={handleSubmitAddWord}
                  className='btn btn-primary btn-sm'
                >
                  {_('Guardar')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
