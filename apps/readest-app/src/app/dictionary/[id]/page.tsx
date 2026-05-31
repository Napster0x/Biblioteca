'use client';

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PiCaretLeft, PiImageSquare, PiSpinner, PiWarningCircle } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getDictionaryService } from '@/services/dictionary/dictionaryServiceCache';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useReaderStore } from '@/store/readerStore';
import type { DictionaryOccurrence } from '@/types/dictionary';
import { navigateToReader } from '@/utils/nav';

const EMPTY_OCCURRENCES: DictionaryOccurrence[] = [];

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : 'jpg';
}

export default function DictionaryDetailPage() {
  const _ = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const entryId = params?.id ?? '';
  const { appService } = useEnv();
  const [service, setService] = useState<DictionaryService | null>(null);
  const [definition, setDefinition] = useState('');
  const [imagePath, setImagePath] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const startedLoadingForRef = useRef<string | null>(null);
  const imagePreviewUrlRef = useRef<string | null>(null);
  const definitionRef = useRef<HTMLParagraphElement | null>(null);
  const definitionDraftRef = useRef('');
  const syncedEntryIdRef = useRef<string | null>(null);

  const entry = useDictionaryStore((s) => s.entry);
  const occurrences = useDictionaryStore(
    (s) => s.occurrencesByEntryId[entryId] ?? EMPTY_OCCURRENCES,
  );
  const isLoading = useDictionaryStore((s) => s.isLoading);
  const loadEntry = useDictionaryStore((s) => s.loadEntry);
  const loadOccurrences = useDictionaryStore((s) => s.loadOccurrences);
  const updateEntry = useDictionaryStore((s) => s.updateEntry);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    startedLoadingForRef.current = entryId;
    getDictionaryService(appService)
      .then((svc) => {
        if (cancelled) return;
        setService(svc);
        setError(null);
        loadOccurrences(entryId, svc);
        return loadEntry(entryId, svc);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : _('Error al abrir el diccionario'));
      });
    return () => {
      cancelled = true;
    };
  }, [_, appService, entryId, loadEntry, loadOccurrences]);

  useEffect(() => {
    if (!entry || entry.id !== entryId) return;

    const isNewEntry = syncedEntryIdRef.current !== entryId;
    const nextDefinition = entry.definition ?? '';
    setDefinition(nextDefinition);
    definitionDraftRef.current = nextDefinition;
    setImagePath(entry.imagePath ?? '');
    syncedEntryIdRef.current = entryId;

    if (isNewEntry) {
      setEditError(null);
    }
  }, [entry, entryId]);

  useEffect(() => {
    if (!appService || !imagePath) {
      setImageUrl('');
      return;
    }

    let cancelled = false;
    let objectUrl = '';

    appService
      .readFile(imagePath, 'Dictionaries', 'binary')
      .then((content) => {
        if (cancelled) return;
        if (imagePreviewUrlRef.current) {
          URL.revokeObjectURL(imagePreviewUrlRef.current);
          imagePreviewUrlRef.current = null;
        }
        objectUrl = URL.createObjectURL(new Blob([content]));
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setImageUrl('');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [appService, imagePath]);

  const persistEntry = useCallback(
    async (nextValues: { definition?: string; imagePath?: string } = {}) => {
      if (!service) return;
      await updateEntry(
        {
          id: entryId,
          definition: nextValues.definition ?? definition,
          imagePath: nextValues.imagePath ?? imagePath,
        },
        service,
      );
    },
    [definition, entryId, imagePath, service, updateEntry],
  );

  const handleImageChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedImage = event.target.files?.[0] ?? null;
      if (!selectedImage || !appService || !service) return;

      const ext = getFileExtension(selectedImage.name);
      const imageDir = `entries/${entryId}`;
      const nextImagePath = `${imageDir}/image.${ext}`;

      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
      const previewUrl = URL.createObjectURL(selectedImage);
      imagePreviewUrlRef.current = previewUrl;
      setImageUrl(previewUrl);

      const bytes = await selectedImage.arrayBuffer();
      await appService.createDir(imageDir, 'Dictionaries', true);
      await appService.writeFile(nextImagePath, 'Dictionaries', bytes);

      setImagePath(nextImagePath);
      await persistEntry({ imagePath: nextImagePath });
      event.target.value = '';
    },
    [appService, entryId, persistEntry, service],
  );

  const handleDefinitionBlur = useCallback(async () => {
    const nextDefinition = definitionDraftRef.current;
    if ((entry?.definition ?? '') === nextDefinition) return;
    try {
      await persistEntry({ definition: nextDefinition });
      setDefinition(nextDefinition);
      setEditError(null);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : _('No se pudieron guardar los cambios'));
    }
  }, [_, entry?.definition, persistEntry]);

  const handleGoToReader = useCallback(
    (occurrence: DictionaryOccurrence) => {
      const { viewStates, setPreviewMode } = useReaderStore.getState();
      const openEntry = Object.entries(viewStates).find(
        ([bookKey, state]) => bookKey.startsWith(occurrence.bookHash) && state.view,
      );
      if (openEntry) {
        const [bookKey, state] = openEntry;
        state.view?.goTo(occurrence.cfi);
        setPreviewMode(bookKey, true);
        return;
      }
      const queryParams = `cfi=${encodeURIComponent(occurrence.cfi)}`;
      navigateToReader(router, [occurrence.bookHash], queryParams);
    },
    [router],
  );

  const primaryOccurrence = occurrences[0];
  const primaryBookLabel = primaryOccurrence?.bookTitle
    ? primaryOccurrence.bookAuthor
      ? `~ "${primaryOccurrence.bookTitle}" de ${primaryOccurrence.bookAuthor}`
      : `~ "${primaryOccurrence.bookTitle}"`
    : null;

  if (error) {
    return (
      <main className='text-base-content flex min-h-dvh flex-col bg-base-200'>
        <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center sm:px-6'>
          <PiWarningCircle aria-hidden className='text-error size-10' />
          <h1 className='text-xl font-semibold'>{_('Error al abrir el diccionario')}</h1>
          <p className='text-base-content/60 text-sm'>{error}</p>
          <button
            type='button'
            className='btn btn-primary'
            onClick={() => router.push('/dictionary')}
          >
            {_('Volver al diccionario')}
          </button>
        </section>
      </main>
    );
  }

  if (!entry || entry.id !== entryId) {
    // Still loading if we haven't started for this entryId, or the store says in-flight
    if (startedLoadingForRef.current !== entryId || isLoading) {
      return (
        <main className='text-base-content flex min-h-dvh flex-col bg-base-200'>
          <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6'>
            <PiSpinner aria-hidden className='mb-4 size-10 animate-spin' />
            <p className='text-base-content/60'>{_('Cargando…')}</p>
          </section>
        </main>
      );
    }
    return (
      <main className='text-base-content flex min-h-dvh flex-col bg-base-200'>
        <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center sm:px-6'>
          <PiWarningCircle aria-hidden className='text-base-content/60 size-10' />
          <h1 className='text-xl font-semibold'>{_('Entrada no encontrada')}</h1>
          <button
            type='button'
            className='btn btn-primary'
            onClick={() => router.push('/dictionary')}
          >
            {_('Volver al diccionario')}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className='text-base-content flex min-h-dvh flex-col bg-base-200'>
      <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-16 pt-6 sm:px-6'>
        <button
          type='button'
          className='text-base-content/70 mb-4 flex items-center gap-1 text-sm hover:text-base-content'
          onClick={() => router.push('/dictionary')}
          aria-label={_('Volver')}
        >
          <PiCaretLeft aria-hidden className='size-4' />
          {_('Volver')}
        </button>

        <div className='mb-8 grid grid-cols-[minmax(0,1fr)_minmax(8rem,14rem)] items-start gap-5 sm:gap-8'>
          <div className='pt-10 sm:pt-16'>
            <h1
              className='font-serif border-base-content/60 border-b pb-3 text-5xl font-semibold tracking-tight sm:text-6xl'
              style={{
                color: 'white',
                WebkitTextStroke: '2px #000',
                paintOrder: 'stroke fill',
                textShadow: '0 0 14px rgba(0, 0, 0, 0.55)',
              }}
            >
              {capitalize(entry.displayTerm)}
            </h1>

            <p
              ref={definitionRef}
              className='border-base-content/65 text-base-content/75 mt-8 w-full max-w-xl break-words border-l-2 pl-4 font-["Times_New_Roman",Times,serif] text-lg italic leading-relaxed tracking-[0.01em] outline-none [overflow-wrap:anywhere] focus:outline-none'
              contentEditable
              suppressContentEditableWarning
              role='textbox'
              aria-label={_('Editar definición')}
              onInput={(event) => {
                definitionDraftRef.current = event.currentTarget.textContent ?? '';
              }}
              onBlur={handleDefinitionBlur}
            >
              {definition || _('Sin definición')}
            </p>
          </div>

          <button
            type='button'
            className={
              imageUrl
                ? 'group mx-auto flex w-fit max-w-full items-center justify-center border-2 border-black bg-transparent p-0 transition-opacity hover:opacity-85'
                : 'group flex min-h-32 w-full items-center justify-center border-2 border-black bg-transparent p-2 transition-opacity hover:opacity-85'
            }
            onClick={() => imageInputRef.current?.click()}
            aria-label={imageUrl ? _('Imagen actual') : _('Sin imagen')}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=''
                aria-hidden
                className='pointer-events-none max-h-48 max-w-full object-contain not-eink:drop-shadow-[0_0_14px_rgb(0_0_0_/_0.55)]'
                draggable={false}
                onError={() => setImageUrl('')}
              />
            ) : (
              <PiImageSquare aria-hidden className='text-base-content/35 size-14' />
            )}
          </button>
          <input
            ref={imageInputRef}
            type='file'
            accept='image/*'
            className='sr-only'
            onChange={handleImageChange}
            aria-label={_('Cambiar imagen')}
          />
        </div>

        {editError && <p className='text-error mb-4 text-center text-sm'>{editError}</p>}

        {primaryOccurrence && (
          <button
            type='button'
            className='eink-bordered mx-auto mb-8 w-full max-w-2xl rounded-2xl bg-base-100 p-4 text-center transition-colors not-eink:shadow-[0_0_16px_rgb(0_0_0_/_0.22)] hover:bg-base-300/40'
            onClick={() => handleGoToReader(primaryOccurrence)}
            aria-label={_('Ir al lector')}
            data-testid='dictionary-quote-card'
          >
            <blockquote
              className='font-serif line-clamp-3 text-base font-light italic leading-relaxed tracking-[0.01em]'
              data-testid='dictionary-quote-text'
            >
              {primaryOccurrence.contextBefore && <span>{primaryOccurrence.contextBefore} </span>}
              <mark className='bg-transparent px-0.5 font-semibold text-base-content'>
                {primaryOccurrence.selectedText}
              </mark>
              {primaryOccurrence.contextAfter && <span> {primaryOccurrence.contextAfter}</span>}
            </blockquote>
            {primaryBookLabel && (
              <p className='font-serif text-base-content/70 mt-2 text-sm italic'>
                {primaryBookLabel}
              </p>
            )}
          </button>
        )}
      </section>
    </main>
  );
}
