'use client';

export function generateStaticParams() {
  return [];
}

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PiCaretLeft, PiImageSquare, PiSpinner, PiWarningCircle } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useImagePasteOnHover } from '@/hooks/useImagePasteOnHover';
import { getDictionaryService } from '@/services/dictionary/dictionaryServiceCache';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import { useDictionaryStore } from '@/store/dictionaryStore';
import { useReaderStore } from '@/store/readerStore';
import type { DictionaryOccurrence } from '@/types/dictionary';
import { navigateToReader } from '@/utils/nav';
import { extractSentenceFromContext } from '@/utils/sentenceExtraction';

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
  const [isEntryLoading, setIsEntryLoading] = useState(true);
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
  const setEntry = useDictionaryStore((s) => s.setEntry);
  const setOccurrences = useDictionaryStore((s) => s.setOccurrences);
  const updateEntry = useDictionaryStore((s) => s.updateEntry);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    startedLoadingForRef.current = entryId;
    setIsEntryLoading(true);
    getDictionaryService(appService)
      .then(async (svc) => {
        if (cancelled) return;
        setService(svc);
        setError(null);
        let loadedEntry = await svc.getEntry(entryId);
        if (!loadedEntry) {
          await new Promise((resolve) => setTimeout(resolve, 75));
          if (cancelled) return;
          loadedEntry = await svc.getEntry(entryId);
        }
        if (cancelled) return;
        if (loadedEntry) setEntry(loadedEntry);
        setIsEntryLoading(false);

        const loadedOccurrences = await svc.listOccurrences(entryId);
        if (!cancelled) setOccurrences(entryId, loadedOccurrences);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : _('Error al abrir el diccionario'));
        setIsEntryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [_, appService, entryId, setEntry, setOccurrences]);

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

  // Persist an image File to the entry's image directory and update the entry
  // record. Shared by the file picker and the clipboard-paste flow so both
  // go through the same on-disk + DB path.
  const saveImageFromFile = useCallback(
    async (file: File, name: string) => {
      if (!appService || !service) return;

      const ext = getFileExtension(name);
      const imageDir = `entries/${entryId}`;
      const nextImagePath = `${imageDir}/image.${ext}`;

      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
      const previewUrl = URL.createObjectURL(file);
      imagePreviewUrlRef.current = previewUrl;
      setImageUrl(previewUrl);

      const bytes = await file.arrayBuffer();
      await appService.createDir(imageDir, 'Dictionaries', true);
      await appService.writeFile(nextImagePath, 'Dictionaries', bytes);

      setImagePath(nextImagePath);
      await persistEntry({ imagePath: nextImagePath });
    },
    [appService, entryId, persistEntry, service],
  );

  const handleImageChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedImage = event.target.files?.[0] ?? null;
      if (!selectedImage) return;
      await saveImageFromFile(selectedImage, selectedImage.name);
      event.target.value = '';
    },
    [saveImageFromFile],
  );

  // Image pasted from the clipboard while the user is hovering the change
  // image button. Routed through a document-level listener (see
  // useImagePasteOnHover) because Chromium does not fire paste events on
  // non-editable elements like `<button>`.
  const { onMouseEnter: onImageButtonEnter, onMouseLeave: onImageButtonLeave } =
    useImagePasteOnHover(saveImageFromFile);

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
  const primaryQuote = primaryOccurrence
    ? extractSentenceFromContext({
        before: primaryOccurrence.contextBefore ?? '',
        word: primaryOccurrence.selectedText,
        after: primaryOccurrence.contextAfter ?? '',
      })
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
    if (startedLoadingForRef.current !== entryId || isEntryLoading) {
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
    <main className='text-base-content flex min-h-dvh flex-col overflow-y-auto bg-base-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
      <section className='mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-24 pt-5 sm:px-6 sm:pt-6'>
        <button
          type='button'
          className='text-base-content/70 mb-4 flex items-center gap-1 text-sm hover:text-base-content'
          onClick={() => router.push('/dictionary')}
          aria-label={_('Volver')}
        >
          <PiCaretLeft aria-hidden className='size-4' />
          {_('Volver')}
        </button>

        <div className='mb-8 grid grid-cols-1 items-start gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,14rem)] sm:gap-8'>
          <div className='pt-3 sm:pt-16'>
            <h1
              className='font-serif border-base-content/60 break-words border-b pb-3 text-4xl font-semibold tracking-tight sm:text-6xl'
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
                ? 'group mx-auto flex w-fit max-w-full items-center justify-center border-2 border-black bg-transparent p-0 transition-opacity hover:opacity-85 sm:mt-12'
                : 'group flex min-h-32 w-full items-center justify-center border-2 border-black bg-transparent p-2 transition-opacity hover:opacity-85 sm:mt-12'
            }
            onClick={() => imageInputRef.current?.click()}
            onMouseEnter={onImageButtonEnter}
            onMouseLeave={onImageButtonLeave}
            data-testid='dictionary-image-area'
            aria-label={imageUrl ? _('Imagen actual') : _('Sin imagen')}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=''
                aria-hidden
                className='pointer-events-none max-h-56 max-w-full object-contain not-eink:shadow-[0_0_14px_rgb(0_0_0_/_0.55)] sm:max-h-48'
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
              className='font-serif whitespace-pre-wrap break-words text-base font-light italic leading-relaxed tracking-[0.01em]'
              data-testid='dictionary-quote-text'
            >
              {primaryQuote?.sentenceBefore && <span>{primaryQuote.sentenceBefore} </span>}
              <mark className='bg-transparent px-0.5 font-semibold text-base-content'>
                {primaryQuote?.sentenceWord ?? primaryOccurrence.selectedText}
              </mark>
              {primaryQuote?.sentenceAfter && <span> {primaryQuote.sentenceAfter}</span>}
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
