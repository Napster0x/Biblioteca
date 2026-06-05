'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { PiCheckCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import type { Annotacion } from '@/types/annotaciones';
import { navigateToReader } from '@/utils/nav';

interface AnotacionTileProps {
  annotation: Annotacion;
  isHighlighted?: boolean;
}

export default function AnotacionTile({ annotation, isHighlighted }: AnotacionTileProps) {
  const _ = useTranslation();
  const router = useRouter();
  const isSelectMode = useAnotacionesStore((s) => s.isSelectMode);
  const selectedAnnotationIds = useAnotacionesStore((s) => s.selectedAnnotationIds);
  const toggleSelect = useAnotacionesStore((s) => s.toggleSelect);
  const isSelected = selectedAnnotationIds.includes(annotation.id);
  const canNavigate = Boolean(annotation.bookHash && annotation.cfi);
  const annotationLabel = _('Annotation: {{text}}', { text: annotation.text });
  const tileClassName = clsx(
    'eink-bordered bg-base-100 group relative w-full rounded-2xl p-4 text-left transition-colors not-eink:shadow-[0_0_16px_rgb(0_0_0_/_0.22)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
    isSelectMode && 'transition-colors duration-150 hover:bg-base-200',
    !isSelectMode && canNavigate && 'hover:bg-base-300/40',
    !isSelectMode && !canNavigate && 'cursor-not-allowed opacity-60',
    isSelected && 'border-2 border-base-content',
    isHighlighted && 'anotaciones-pulse',
  );

  const handleGoToReader = () => {
    if (!annotation.bookHash || !annotation.cfi) return;
    navigateToReader(router, [annotation.bookHash], `cfi=${encodeURIComponent(annotation.cfi)}`);
  };

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
        />
      </button>
    );
  }

  return (
    <button
      type='button'
      id={annotation.id}
      className={tileClassName}
      aria-label={
        canNavigate
          ? annotationLabel
          : _('Annotation unavailable: {{text}}', { text: annotation.text })
      }
      aria-disabled={!canNavigate}
      disabled={!canNavigate}
      title={!canNavigate ? _('Source location unavailable') : undefined}
      onClick={handleGoToReader}
    >
      <TileContent annotation={annotation} isSelected={false} selectedLabel={_('Selected')} />
    </button>
  );
}

function formatBookMetadata(annotation: Annotacion): string | null {
  const title = annotation.bookTitle?.trim();
  const author = annotation.bookAuthor?.trim();
  if (title && author) return `${title} ~ ${author}`;
  return title || author || null;
}

function formatRelativeDate(createdAt: number): string {
  const diff = Date.now() - createdAt;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function TileContent({
  annotation,
  isSelected,
  selectedLabel,
}: {
  annotation: Annotacion;
  isSelected: boolean;
  selectedLabel: string;
}) {
  const metadata = formatBookMetadata(annotation);
  const relativeDate = formatRelativeDate(annotation.createdAt);

  return (
    <>
      <div className='flex items-start gap-3'>
        <div
          className='mt-1 size-3 shrink-0 rounded-full'
          style={{ backgroundColor: annotation.color || '#ffff00' }}
          aria-hidden='true'
        />
        <div className='relative flex min-w-0 flex-1 flex-col gap-2'>
          {annotation.note && (
            <p className='font-serif text-base leading-relaxed text-base-content'>
              {annotation.note}
            </p>
          )}
          <blockquote className='text-base-content/60 text-sm italic leading-relaxed'>
            {annotation.text}
          </blockquote>
          <div className='text-base-content/50 flex flex-wrap items-center gap-x-2 text-xs'>
            {metadata && <span>{metadata}</span>}
            {annotation.page != null && <span>p.&nbsp;{annotation.page}</span>}
            <span>{relativeDate}</span>
          </div>
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
