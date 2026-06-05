'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiCheckCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import type { Annotacion } from '@/types/annotaciones';
import { navigateToReader } from '@/utils/nav';

interface AnotacionTileProps {
  annotation: Annotacion;
  service?: AnotacionesService;
  isHighlighted?: boolean;
}

export default function AnotacionTile({ annotation, service, isHighlighted }: AnotacionTileProps) {
  const _ = useTranslation();
  const router = useRouter();
  const isSelectMode = useAnotacionesStore((s) => s.isSelectMode);
  const selectedAnnotationIds = useAnotacionesStore((s) => s.selectedAnnotationIds);
  const toggleSelect = useAnotacionesStore((s) => s.toggleSelect);
  const updateAnnotation = useAnotacionesStore((s) => s.updateAnnotation);
  const isSelected = selectedAnnotationIds.includes(annotation.id);
  const canNavigate = Boolean(annotation.bookHash && annotation.cfi);
  const [isEditing, setIsEditing] = useState(false);
  const noteRef = useRef<HTMLParagraphElement | null>(null);
  const draftNoteRef = useRef(annotation.note);
  const annotationLabel = _('Annotation: {{text}}', { text: annotation.text });
  const tileClassName = clsx(
    'eink-bordered bg-base-100 group relative w-full rounded-2xl p-4 text-left transition-colors not-eink:shadow-[0_0_16px_rgb(0_0_0_/_0.22)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
    isSelectMode && 'transition-colors duration-150 hover:bg-base-200',
    !isSelectMode && !isEditing && canNavigate && 'hover:bg-base-300/40',
    !isSelectMode && !canNavigate && 'cursor-not-allowed opacity-60',
    isEditing && 'bg-yellow-100/10 border-yellow-500/50',
    isSelected && 'border-2 border-base-content',
    isHighlighted && 'anotaciones-pulse',
  );

  useEffect(() => {
    draftNoteRef.current = annotation.note;
  }, [annotation.note]);

  useEffect(() => {
    if (!isEditing || !noteRef.current) return;
    noteRef.current.textContent = draftNoteRef.current;
    noteRef.current.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(noteRef.current);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [isEditing]);

  const handleGoToReader = () => {
    if (isEditing || !annotation.bookHash || !annotation.cfi) return;
    navigateToReader(router, [annotation.bookHash], `cfi=${encodeURIComponent(annotation.cfi)}`);
  };

  const handleStartEdit = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsEditing(true);
  }, []);

  const handleEditMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!service) {
      setIsEditing(false);
      return;
    }
    const normalizedNote = draftNoteRef.current.trim();
    if (normalizedNote === annotation.note) {
      setIsEditing(false);
      return;
    }
    await updateAnnotation(annotation.id, normalizedNote, service);
    setIsEditing(false);
  }, [annotation.id, annotation.note, service, updateAnnotation]);

  const handleTileKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isEditing || !canNavigate) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleGoToReader();
      }
    },
    [canNavigate, isEditing],
  );

  if (isSelectMode) {
    return (
      <button
        type='button'
        id={annotation.id}
        className={tileClassName}
        aria-label={`${isSelected ? _('Deselect') : _('Select')} ${annotationLabel}`}
        aria-pressed={isSelected}
        onClick={() => toggleSelect(annotation.id)}
      >
        <TileContent
          annotation={annotation}
          isSelected={isSelected}
          selectedLabel={_('Selected')}
          isEditing={false}
          noteRef={noteRef}
          onDraftNoteChange={(value) => {
            draftNoteRef.current = value;
          }}
          onEditMouseDown={handleEditMouseDown}
          onStartEdit={() => {}}
          onSaveNote={async () => {}}
        />
      </button>
    );
  }

  return (
    <div
      id={annotation.id}
      className={tileClassName}
      role={canNavigate && !isEditing ? 'button' : undefined}
      tabIndex={canNavigate && !isEditing ? 0 : undefined}
      aria-label={
        canNavigate
          ? annotationLabel
          : _('Annotation unavailable: {{text}}', { text: annotation.text })
      }
      aria-disabled={!canNavigate || isEditing}
      title={!canNavigate ? _('Source location unavailable') : undefined}
      onClick={handleGoToReader}
      onKeyDown={handleTileKeyDown}
    >
      <TileContent
        annotation={annotation}
        isSelected={false}
        selectedLabel={_('Selected')}
        isEditing={isEditing}
        noteRef={noteRef}
        onDraftNoteChange={(value) => {
          draftNoteRef.current = value;
        }}
        onEditMouseDown={handleEditMouseDown}
        onStartEdit={handleStartEdit}
        onSaveNote={handleSaveNote}
      />
    </div>
  );
}

function formatBookMetadata(annotation: Annotacion): string | null {
  const title = annotation.bookTitle?.trim();
  const author = annotation.bookAuthor?.trim();
  if (title && author) return `${title} ~ ${author}`;
  return title || author || null;
}

function TileContent({
  annotation,
  isSelected,
  selectedLabel,
  isEditing,
  noteRef,
  onDraftNoteChange,
  onEditMouseDown,
  onStartEdit,
  onSaveNote,
}: {
  annotation: Annotacion;
  isSelected: boolean;
  selectedLabel: string;
  isEditing: boolean;
  noteRef: React.RefObject<HTMLParagraphElement | null>;
  onDraftNoteChange: (value: string) => void;
  onEditMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  onStartEdit: (event: React.MouseEvent<HTMLElement>) => void;
  onSaveNote: () => Promise<void>;
}) {
  const metadata = formatBookMetadata(annotation);

  return (
    <>
      <div className='flex items-start'>
        <div className='relative flex min-w-0 flex-1 flex-col gap-3'>
          <div
            className='eink-bordered rounded-2xl border border-yellow-500/40 bg-[rgba(250,224,120,0.18)] px-4 py-3'
            onMouseDown={onEditMouseDown}
            onClick={onStartEdit}
          >
            <p
              ref={noteRef}
              className={clsx(
                'font-serif whitespace-pre-wrap break-words text-base leading-relaxed text-base-content outline-none sm:text-lg',
                !annotation.note && !isEditing && 'text-base-content/45 italic',
              )}
              contentEditable={isEditing}
              suppressContentEditableWarning
              role={isEditing ? 'textbox' : undefined}
              onInput={(event) => onDraftNoteChange(event.currentTarget.textContent ?? '')}
              onBlur={() => {
                if (isEditing) void onSaveNote();
              }}
            >
              {isEditing
                ? annotation.note || 'Escribe una anotación…'
                : annotation.note || 'Escribe una anotación…'}
            </p>
          </div>
          <blockquote className='ms-5 whitespace-pre-wrap break-words border-s-[3px] border-[rgba(250,224,120,0.42)] ps-4 text-sm italic leading-relaxed text-base-content/65 sm:text-[0.95rem]'>
            {annotation.text}
          </blockquote>
          {metadata && (
            <div className='flex flex-col items-center gap-2'>
              <span
                aria-hidden='true'
                className='relative inline-block size-3 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.9)_0%,rgba(247,233,170,0.98)_18%,rgba(214,176,62,0.96)_60%,rgba(162,120,18,0.92)_100%)] shadow-[0_2px_4px_rgba(0,0,0,0.28),0_7px_18px_rgba(0,0,0,0.16),0_0_14px_rgba(214,176,62,0.34)] before:absolute before:left-[20%] before:top-[16%] before:h-[20%] before:w-[20%] before:rounded-full before:bg-white/75 before:content-[""] after:absolute after:left-1/2 after:top-[115%] after:h-[26%] after:w-[130%] after:-translate-x-1/2 after:rounded-full after:bg-black/12 after:blur-[2px] after:content-[""]'
              />
              <p
                className='font-["Times_New_Roman",Times,serif] text-center text-base italic tracking-[0.02em] text-white sm:text-[1.05rem]'
                style={{ WebkitTextStroke: '0.35px rgba(214,170,32,0.58)' }}
              >
                {metadata}
              </p>
            </div>
          )}
        </div>
      </div>
      {isSelected && (
        <span className='eink-bordered absolute start-2 top-2 inline-flex items-center gap-1 rounded-full border border-base-content bg-base-100 px-2 py-1 text-xs font-semibold text-base-content'>
          <PiCheckCircle aria-hidden className='size-4' />
          {selectedLabel}
        </span>
      )}
    </>
  );
}
