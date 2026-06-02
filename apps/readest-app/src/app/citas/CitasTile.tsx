'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { PiCheckCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useCitasStore } from '@/store/citasStore';
import type { Cite } from '@/types/citas';

interface CitasTileProps {
  quote: Cite;
}

export default function CitasTile({ quote }: CitasTileProps) {
  const _ = useTranslation();
  const isSelectMode = useCitasStore((s) => s.isSelectMode);
  const selectedQuoteIds = useCitasStore((s) => s.selectedQuoteIds);
  const toggleSelectedQuote = useCitasStore((s) => s.toggleSelectedQuote);
  const isSelected = selectedQuoteIds.includes(quote.id);
  const quoteLabel = _('Quote: {{text}}', { text: quote.text });
  const tileClassName = clsx(
    '@container',
    'eink-bordered bg-base-100 group relative aspect-square overflow-hidden rounded-2xl text-left border-2 border-black hover:border-transparent transition-[border-color] duration-500 not-eink:drop-shadow-[0_0_14px_rgb(0_0_0_/_0.25)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
    isSelectMode && 'transition-colors duration-150 hover:bg-base-200',
    isSelected && 'border-2 border-base-content',
  );

  if (isSelectMode) {
    return (
      <button
        type='button'
        className={tileClassName}
        aria-label={`${isSelected ? _('Deselect') : _('Select')} ${quoteLabel}`}
        aria-pressed={isSelected}
        onClick={() => toggleSelectedQuote(quote.id)}
      >
        <TileContent quote={quote} isSelected={isSelected} selectedLabel={_('Selected')} />
      </button>
    );
  }

  return (
    <Link href='/citas' className={tileClassName} aria-label={quoteLabel}>
      <TileContent quote={quote} isSelected={false} selectedLabel={_('Selected')} />
    </Link>
  );
}

function TileContent({
  quote,
  isSelected,
  selectedLabel,
}: {
  quote: Cite;
  isSelected: boolean;
  selectedLabel: string;
}) {
  return (
    <>
      <div
        aria-hidden
        className='absolute inset-0 bg-base-100 transition-colors group-hover:bg-base-200'
      />
      <div className='relative flex h-full flex-col justify-between p-4'>
        <blockquote
          className='line-clamp-3 font-serif text-base font-semibold leading-snug text-base-content'
          data-citas-sizing='cqi'
          style={{ fontSize: 'min(7cqi, 1.1rem)' }}
        >
          {quote.text}
        </blockquote>
        <div className='mt-3 space-y-1'>
          {quote.bookAuthor && <p className='text-sm opacity-70'>— {quote.bookAuthor}</p>}
          {quote.bookTitle && <p className='line-clamp-1 text-xs opacity-50'>{quote.bookTitle}</p>}
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
