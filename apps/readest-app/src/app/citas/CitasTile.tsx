'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { PiCheckCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useCitasStore } from '@/store/citasStore';
import { useReaderStore } from '@/store/readerStore';
import type { Cite } from '@/types/citas';
import { navigateToReader } from '@/utils/nav';

interface CitasTileProps {
  quote: Cite;
}

export default function CitasTile({ quote }: CitasTileProps) {
  const _ = useTranslation();
  const router = useRouter();
  const isSelectMode = useCitasStore((s) => s.isSelectMode);
  const selectedQuoteIds = useCitasStore((s) => s.selectedQuoteIds);
  const toggleSelectedQuote = useCitasStore((s) => s.toggleSelectedQuote);
  const isSelected = selectedQuoteIds.includes(quote.id);
  const canNavigate = Boolean(quote.bookHash && quote.cfi);
  const quoteLabel = _('Quote: {{text}}', { text: quote.text });
  const tileClassName = clsx(
    'eink-bordered bg-base-100 group relative w-full rounded-2xl p-4 text-left transition-colors not-eink:shadow-[0_0_16px_rgb(0_0_0_/_0.22)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
    isSelectMode && 'transition-colors duration-150 hover:bg-base-200',
    !isSelectMode && canNavigate && 'hover:bg-base-300/40',
    !isSelectMode && !canNavigate && 'cursor-not-allowed opacity-60',
    isSelected && 'border-2 border-base-content',
  );

  const handleGoToReader = () => {
    if (!quote.bookHash || !quote.cfi) return;

    const { viewStates, setPreviewMode } = useReaderStore.getState();
    const openEntry = Object.entries(viewStates).find(
      ([bookKey, state]) => bookKey.startsWith(quote.bookHash) && state.view,
    );
    if (openEntry) {
      const [bookKey, state] = openEntry;
      state.view?.goTo(quote.cfi);
      setPreviewMode(bookKey, true);
    }

    navigateToReader(router, [quote.bookHash], `cfi=${encodeURIComponent(quote.cfi)}`);
  };

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
    <button
      type='button'
      className={tileClassName}
      aria-label={canNavigate ? quoteLabel : _('Quote unavailable: {{text}}', { text: quote.text })}
      aria-disabled={!canNavigate}
      disabled={!canNavigate}
      title={!canNavigate ? _('Source location unavailable') : undefined}
      onClick={handleGoToReader}
    >
      <TileContent quote={quote} isSelected={false} selectedLabel={_('Selected')} />
    </button>
  );
}

function formatBookMetadata(quote: Cite): string | null {
  const title = quote.bookTitle?.trim();
  const author = quote.bookAuthor?.trim();
  if (title && author) return `${title} ~ ${author}`;
  return title || author || null;
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
  const metadata = formatBookMetadata(quote);

  return (
    <>
      <div className='relative flex flex-col gap-3 text-center'>
        <blockquote className='font-serif text-base font-light italic leading-relaxed tracking-[0.01em] text-base-content'>
          {quote.text}
        </blockquote>
        {metadata && <p className='font-serif text-base-content/70 text-sm italic'>{metadata}</p>}
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
