'use client';

import React, { useState, useCallback, useRef } from 'react';

import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import type { AppService, BaseDir } from '@/types/system';
import type { DictionaryService } from '@/services/dictionary/DictionaryService';
import { normalizeDictionarySelection } from '@/utils/dictionaryText';
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
  onCreateHighlight: (cfi: string, selectedText: string, page?: number) => Promise<string>;
  onDismiss: () => void;
}

interface SelectedImage {
  file: File;
  name: string;
}

/**
 * Extract surrounding context strings from a DOM Range.
 * Returns trimmed text before and after the selected word boundary.
 */
export function extractCaptureContext(range: Range): {
  contextBefore: string;
  contextAfter: string;
} {
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  let contextBefore = '';
  let contextAfter = '';

  if (startNode.nodeType === Node.TEXT_NODE) {
    const text = startNode.textContent ?? '';
    contextBefore = text.slice(Math.max(0, range.startOffset - 60), range.startOffset);
  }

  if (endNode.nodeType === Node.TEXT_NODE && endNode === startNode) {
    const text = endNode.textContent ?? '';
    contextAfter = text.slice(range.endOffset, range.endOffset + 60);
  } else if (endNode.nodeType === Node.TEXT_NODE) {
    const text = endNode.textContent ?? '';
    contextAfter = text.slice(0, 60);
  }

  return { contextBefore, contextAfter };
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

      // 2. Extract context from the Range
      const { contextBefore, contextAfter } = extractCaptureContext(range);

      // 3. Create the highlight in the book (returns the highlight note ID)
      const highlightNoteId = await onCreateHighlight(cfi, selectedText, page);

      // 4. Upsert the dictionary entry with manual definition (no enrichment)
      const entry = await dictionaryService.upsertEntry({
        term: normalized.term,
        displayTerm: normalized.displayTerm,
        language: book.language,
        definition: definition || undefined,
      });

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
      <div className='flex h-full flex-col overflow-hidden rounded-lg p-4'>
        {/* Word display */}
        <h2 className='text-lg font-semibold truncate mb-3'>{selectedText}</h2>

        {/* Image picker */}
        <div className='mb-3'>
          {selectedImage ? (
            <div className='flex items-center gap-2'>
              <span className='text-sm truncate flex-1'>{selectedImage.name}</span>
              <button
                type='button'
                className='text-sm text-error hover:underline'
                onClick={handleRemoveImage}
              >
                {_('Remove')}
              </button>
            </div>
          ) : (
            <button
              type='button'
              className='btn btn-outline btn-sm w-full'
              onClick={handleSelectImage}
              aria-label={_('Select Image')}
            >
              {_('Select Image')}
            </button>
          )}
        </div>

        {/* Definition textarea */}
        <div className='flex-1 mb-3'>
          <textarea
            className='textarea textarea-bordered w-full h-24 resize-none'
            placeholder={_('Write a definition...')}
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
          />
        </div>

        {/* Action buttons */}
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            className='btn btn-ghost btn-sm'
            onClick={handleCancel}
            disabled={saving}
          >
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? _('Saving...') : _('Save')}
          </button>
        </div>
      </div>
    </Popup>
  );
};

export default CapturePopup;
