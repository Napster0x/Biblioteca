'use client';

import React, { useState, useCallback, useRef } from 'react';

import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import type { AppService, BaseDir } from '@/types/system';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import { normalizeDictionarySelection } from '@/utils/dictionaryText';
import { extractSentenceFromContext } from '@/utils/sentenceExtraction';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileSelector } from '@/hooks/useFileSelector';
import { eventDispatcher } from '@/utils/event';

export interface CapturePopupBook {
  hash: string;
  title?: string;
  author?: string;
  language?: string;
}

export interface CapturePopupProps {
  selectedText: string;
  range: Range;
  cfi: string;
  page?: number;
  sectionHref?: string;
  book: CapturePopupBook;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  appService: AppService;
  dictionaryService: DictionaryService;
  onCreateHighlight: (
    cfi: string,
    selectedText: string,
    page: number | undefined,
    dictionaryEntryId: string,
  ) => Promise<string>;
  onDismiss: () => void;
}

interface SelectedImage {
  file: File;
  name: string;
}

/**
 * Extract the full sentence containing the selected word from a DOM Range.
 * Captures a wider window (300 chars on each side) and then narrows down
 * to the sentence boundaries so that the saved context represents the
 * whole sentence rather than a fixed character window.
 */
const CAPTURE_WINDOW_SIZE = 300;

export function extractCaptureContext(
  range: Range,
  selectedText: string,
): {
  contextBefore: string;
  contextAfter: string;
} {
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  let contextBefore = '';
  let contextAfter = '';

  if (startNode.nodeType === Node.TEXT_NODE) {
    const text = startNode.textContent ?? '';
    contextBefore = text.slice(
      Math.max(0, range.startOffset - CAPTURE_WINDOW_SIZE),
      range.startOffset,
    );
  }

  if (endNode.nodeType === Node.TEXT_NODE && endNode === startNode) {
    const text = endNode.textContent ?? '';
    contextAfter = text.slice(
      range.endOffset,
      Math.min(text.length, range.endOffset + CAPTURE_WINDOW_SIZE),
    );
  } else if (endNode.nodeType === Node.TEXT_NODE) {
    const text = endNode.textContent ?? '';
    contextAfter = text.slice(0, CAPTURE_WINDOW_SIZE);
  }

  const { sentenceBefore, sentenceAfter } = extractSentenceFromContext({
    before: contextBefore,
    word: selectedText,
    after: contextAfter,
  });

  return { contextBefore: sentenceBefore, contextAfter: sentenceAfter };
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : 'jpg';
}

const CapturePopup: React.FC<CapturePopupProps> = ({
  selectedText,
  range,
  cfi,
  page,
  sectionHref,
  book,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  appService,
  dictionaryService,
  onCreateHighlight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { selectFiles } = useFileSelector(appService, _);

  const [definition, setDefinition] = useState('');
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [saving, setSaving] = useState(false);
  const dismissedRef = useRef(false);

  const displayWord = selectedText.charAt(0).toUpperCase() + selectedText.slice(1);

  const handleSelectImage = useCallback(async () => {
    const result = await selectFiles({
      type: 'images',
      accept: 'image/*',
      extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
    });
    if (result.error || result.files.length === 0) return;
    const sf = result.files[0]!;
    if (sf.file) {
      setSelectedImage({ file: sf.file, name: sf.file.name });
    }
  }, [selectFiles]);

  const handleRemoveImage = useCallback(() => {
    setSelectedImage(null);
  }, []);

  const handleCancel = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
  }, [onDismiss]);

  const handleSave = useCallback(async () => {
    if (saving || dismissedRef.current) return;
    setSaving(true);

    try {
      // 1. Validate the selection
      const normalized = normalizeDictionarySelection(selectedText);
      if (!normalized.ok) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Select one word to save to dictionary.'),
          timeout: 2500,
        });
        setSaving(false);
        return;
      }

      // 2. Extract the full sentence containing the selection
      const { contextBefore, contextAfter } = extractCaptureContext(range, selectedText);

      // 3. Upsert the dictionary entry with manual definition (no enrichment)
      const entry = await dictionaryService.upsertEntry({
        term: normalized.term,
        displayTerm: normalized.displayTerm,
        language: book.language,
        definition: definition || undefined,
      });

      // 4. Create the highlight in the book, linked to the saved entry.
      const highlightNoteId = await onCreateHighlight(cfi, selectedText, page, entry.id);

      // 5. Create the occurrence with context
      await dictionaryService.createOccurrence({
        entryId: entry.id,
        bookHash: book.hash,
        bookTitle: book.title,
        bookAuthor: book.author,
        cfi,
        sectionHref,
        page,
        selectedText: normalized.selectedText,
        contextBefore,
        contextAfter,
        highlightNoteId,
      });

      // 6. If an image was selected, save it to the Dictionaries base
      if (selectedImage) {
        const ext = getFileExtension(selectedImage.name);
        const imageDir = `entries/${entry.id}`;
        const imagePath = `${imageDir}/image.${ext}`;

        const bytes = await selectedImage.file.arrayBuffer();
        await appService.createDir(imageDir, 'Dictionaries' as BaseDir, true);
        await appService.writeFile(imagePath, 'Dictionaries' as BaseDir, bytes);

        // Update entry with image path
        await dictionaryService.updateEntry({
          id: entry.id,
          imagePath,
        });
      }

      // 7. Toast and dismiss
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Saved to dictionary'),
        timeout: 2000,
      });

      dismissedRef.current = true;
      onDismiss();
    } catch (error) {
      console.warn('Failed to save to dictionary:', error);
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Failed to save to dictionary.'),
        timeout: 3000,
      });
      setSaving(false);
    }
  }, [
    saving,
    selectedText,
    range,
    cfi,
    page,
    sectionHref,
    book,
    dictionaryService,
    appService,
    onCreateHighlight,
    onDismiss,
    definition,
    selectedImage,
    _,
  ]);

  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={trianglePosition}
      className='select-text'
      onDismiss={handleCancel}
    >
      <div className='flex h-full flex-col overflow-hidden'>
        {/* ── Word header ── */}
        <div className='border-b border-base-content/15 px-5 py-4'>
          <p className='mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-base-content/40'>
            {_('Diccionario')}
          </p>
          <h2 className='text-2xl font-bold capitalize tracking-tight text-base-content'>
            {displayWord}
          </h2>
        </div>

        {/* ── Scrollable content ── */}
        <div className='flex-1 space-y-4 overflow-y-auto px-5 py-4'>
          {/* Image picker */}
          <div>
            {selectedImage ? (
              <div className='flex items-center justify-between gap-2 rounded-lg bg-base-content/5 px-3.5 py-2.5'>
                <div className='flex min-w-0 items-center gap-2.5'>
                  <span className='truncate text-sm text-base-content/70'>
                    {selectedImage.name}
                  </span>
                </div>
                <button
                  type='button'
                  className='shrink-0 text-xs font-medium text-red-400 hover:text-red-300'
                  onClick={handleRemoveImage}
                >
                  {_('Eliminar')}
                </button>
              </div>
            ) : (
              <button
                type='button'
                className='flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-base-content/20 px-4 py-3 text-sm text-base-content/40 hover:border-base-content/30 hover:text-base-content/60 transition-colors'
                onClick={handleSelectImage}
              >
                {/* Inline SVG image icon */}
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  className='h-4 w-4'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                  <circle cx='8.5' cy='8.5' r='1.5' />
                  <polyline points='21 15 16 10 5 21' />
                </svg>
                {_('Agregar Imagen')}
              </button>
            )}
          </div>

          {/* Definition */}
          <div>
            <label className='mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-base-content/40'>
              {_('Definición')}
            </label>
            <textarea
              className='textarea textarea-bordered w-full resize-none text-sm focus:outline-none'
              rows={3}
              placeholder={_('Escribe una definición...')}
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
            />
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className='flex items-center justify-end gap-2 border-t border-base-content/15 px-5 py-3'>
          <button
            type='button'
            className='btn btn-ghost btn-sm'
            onClick={handleCancel}
            disabled={saving}
          >
            {_('Cancelar')}
          </button>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? _('Guardando...') : _('Guardar')}
          </button>
        </div>
      </div>
    </Popup>
  );
};

export default CapturePopup;
