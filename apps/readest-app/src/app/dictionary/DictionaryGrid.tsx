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
import { useEnv } from '@/context/EnvContext';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { BookConfig, BookNote } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';
import { navigateToLibrary } from '@/utils/nav';
import DictionaryTile, { type DictionaryTileSize } from './DictionaryTile';

interface DictionaryGridProps {
  service: DictionaryService;
  appService?: AppService | null;
}

const DICTIONARY_TILE_SIZE_KEY = 'dictionaryTileSize';

function getInitialTileSize(): DictionaryTileSize {
  if (typeof window === 'undefined') return 'normal';
  const value = window.localStorage.getItem(DICTIONARY_TILE_SIZE_KEY);
  return value === 'compact' || value === 'large' ? value : 'normal';
}

function getNextTileSize(size: DictionaryTileSize): DictionaryTileSize {
  if (size === 'compact') return 'normal';
  if (size === 'normal') return 'large';
  return 'compact';
}

function getTileSizeLabel(size: DictionaryTileSize): string {
  if (size === 'compact') return 'S';
  if (size === 'large') return 'L';
  return 'M';
}

function getDictionaryGridClassName(size: DictionaryTileSize): string {
  if (size === 'compact') {
    return 'grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 sm:grid-cols-5 lg:grid-cols-8';
  }
  if (size === 'large') {
    return 'grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  }
  return 'grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6';
}

export default function DictionaryGrid({ service, appService }: DictionaryGridProps) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const router = useRouter();
  const { settings } = useSettingsStore();
  const entries = useDictionaryStore((s) => s.entries);
  const isLoading = useDictionaryStore((s) => s.isLoading);
  const isSelectMode = useDictionaryStore((s) => s.isSelectMode);
  const selectedEntryIds = useDictionaryStore((s) => s.selectedEntryIds);
  const loadEntries = useDictionaryStore((s) => s.loadEntries);
  const searchEntries = useDictionaryStore((s) => s.searchEntries);
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
  const [tileSize, setTileSize] = useState<DictionaryTileSize>(getInitialTileSize);
  const termInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadEntries(service);
  }, [loadEntries, service]);

  const filteredEntries = useMemo(() => entries.filter((e) => !e.deletedAt), [entries]);
  const gridClassName = getDictionaryGridClassName(tileSize);

  useEffect(() => {
    window.localStorage.setItem(DICTIONARY_TILE_SIZE_KEY, tileSize);
  }, [tileSize]);

  const handleSearchChange = useCallback(
    (nextSearch: string) => {
      setSearch(nextSearch);
      void searchEntries(nextSearch, service);
    },
    [searchEntries, service],
  );

  const handleOpenAddWord = useCallback(() => {
    setAddWordTerm('');
    setAddWordDefinition('');
    setAddWordError(null);
    setShowAddWord(true);
  }, []);

  const handleCycleTileSize = useCallback(() => {
    setTileSize((current) => getNextTileSize(current));
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
    await softDeleteDictionaryHighlights(
      selectedEntryIds,
      service,
      appService,
      envConfig,
      settings,
    );
    await deleteSelectedEntries(service);
    setShowDeleteConfirm(false);
  }, [appService, deleteSelectedEntries, envConfig, selectedEntryIds, service, settings]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  // Focus the term input when the dialog opens
  useEffect(() => {
    if (showAddWord && termInputRef.current) {
      termInputRef.current.focus();
    }
  }, [showAddWord]);

  if (isLoading && entries.length === 0 && !search) {
    return (
      <main className='text-base-content full-height flex flex-col overflow-y-auto bg-base-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        <section className='mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6'>
          <PiSpinner aria-hidden className='mb-4 size-10 animate-spin' />
          <p className='text-base-content/60'>{_('Cargando…')}</p>
        </section>
      </main>
    );
  }

  return (
    <main className='text-base-content full-height flex flex-col overflow-y-auto bg-base-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
      <section className='mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-24 pt-5 sm:px-6 sm:pt-6'>
        <div className='mb-6 flex items-center gap-4'>
          <button
            type='button'
            onClick={() => navigateToLibrary(router)}
            className='mt-1 flex self-center items-center justify-center rounded-full transition-colors hover:bg-black/10'
            aria-label={_('Volver a Biblioteca')}
          >
            <span
              aria-hidden='true'
              className='relative inline-block size-7 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.94)_0%,rgba(220,245,255,0.98)_18%,rgba(128,202,241,0.96)_60%,rgba(43,114,168,0.92)_100%)] shadow-[0_2px_4px_rgba(0,0,0,0.26),0_7px_18px_rgba(0,0,0,0.16),0_0_14px_rgba(128,202,241,0.34)] before:absolute before:left-[20%] before:top-[16%] before:h-[20%] before:w-[20%] before:rounded-full before:bg-white/78 before:content-[""] after:absolute after:left-1/2 after:top-[115%] after:h-[26%] after:w-[130%] after:-translate-x-1/2 after:rounded-full after:bg-black/12 after:blur-[2px] after:content-[""]'
            />
          </button>
          <h1
            className='font-["Times_New_Roman",Times,serif] text-4xl font-semibold italic tracking-[0.02em] text-white sm:text-5xl'
            style={{
              WebkitTextStroke: '0.45px rgba(146,211,255,0.58)',
              textShadow:
                '0 1px 0 rgba(255,255,255,0.16), 0 2px 6px rgba(0,0,0,0.24), 0 0 10px rgba(146,211,255,0.14)',
            }}
          >
            {_('Diccionario')}
          </h1>
        </div>

        <div className='relative mb-4'>
          <PiMagnifyingGlass
            aria-hidden
            className='text-base-content/40 pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2'
          />
          <input
            type='text'
            className='eink-bordered input input-sm w-full bg-base-100 pl-9 pr-32'
            placeholder={_('Buscar…')}
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
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
            <span className='bg-base-content/30 mx-0.5 h-4 w-px' />
            <button
              type='button'
              onClick={handleCycleTileSize}
              className='btn btn-ghost btn-xs eink-bordered flex h-7 min-w-7 items-center justify-center px-1 text-[0.65rem] font-semibold'
              aria-label={_('Cambiar tamaño de mosaico')}
              title={_('Tamaño de mosaico')}
            >
              {getTileSizeLabel(tileSize)}
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
          <div className={gridClassName}>
            {filteredEntries.map((entry) => (
              <DictionaryTile
                key={entry.id}
                entry={entry}
                imageUrl={imageUrls[entry.id]}
                tileSize={tileSize}
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

async function softDeleteDictionaryHighlights(
  entryIds: readonly string[],
  service: DictionaryService,
  appService: AppService | null | undefined,
  envConfig: EnvConfigType,
  settings: SystemSettings,
): Promise<void> {
  if (entryIds.length === 0) return;

  const entryIdsSet = new Set(entryIds);
  const highlightsByBook = new Map<string, Set<string>>();

  for (const entryId of entryIds) {
    const occurrences = await service.listOccurrences(entryId);
    for (const occurrence of occurrences) {
      if (!occurrence.highlightNoteId) continue;
      const highlightIds = highlightsByBook.get(occurrence.bookHash) ?? new Set<string>();
      highlightIds.add(occurrence.highlightNoteId);
      highlightsByBook.set(occurrence.bookHash, highlightIds);
    }
  }

  const bookDataStore = useBookDataStore.getState();
  const libraryStore = useLibraryStore.getState();
  const now = Date.now();

  for (const [bookHash, highlightIds] of highlightsByBook) {
    const loadedBookData = bookDataStore.getBookData(bookHash);
    const book = loadedBookData?.book ?? libraryStore.getBookByHash(bookHash);
    const config =
      loadedBookData?.config ??
      (book && appService ? await appService.loadBookConfig(book, settings) : null);
    if (!book || !config?.booknotes) continue;

    const { booknotes, changed } = markDictionaryHighlightsDeleted(
      config.booknotes,
      highlightIds,
      entryIdsSet,
      now,
    );
    if (!changed) continue;

    if (loadedBookData) {
      const updatedConfig = bookDataStore.updateBooknotes(bookHash, booknotes);
      if (updatedConfig)
        await bookDataStore.saveConfig(envConfig, bookHash, updatedConfig, settings);
    } else if (appService) {
      const updatedConfig: BookConfig = { ...config, booknotes, updatedAt: now };
      await appService.saveBookConfig(book, updatedConfig, settings);
    }
  }
}

function markDictionaryHighlightsDeleted(
  booknotes: BookNote[],
  highlightIds: ReadonlySet<string>,
  entryIds: ReadonlySet<string>,
  deletedAt: number,
): { booknotes: BookNote[]; changed: boolean } {
  let changed = false;
  const nextBooknotes = booknotes.map((note) => {
    if (note.deletedAt) return note;
    const matchesHighlight = highlightIds.has(note.id);
    const matchesEntry = !!note.dictionaryEntryId && entryIds.has(note.dictionaryEntryId);
    if (!matchesHighlight && !matchesEntry) return note;
    changed = true;
    return { ...note, deletedAt };
  });

  return { booknotes: nextBooknotes, changed };
}
