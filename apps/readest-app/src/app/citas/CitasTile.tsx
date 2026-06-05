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
  isHighlighted?: boolean;
}

export default function CitasTile({ quote, isHighlighted }: CitasTileProps) {
  const _ = useTranslation();
  const router = useRouter();
  const isSelectMode = useCitasStore((s) => s.isSelectMode);
  const selectedQuoteIds = useCitasStore((s) => s.selectedQuoteIds);
  const toggleSelectedQuote = useCitasStore((s) => s.toggleSelectedQuote);
  const isSelected = selectedQuoteIds.includes(quote.id);
  const canNavigate = Boolean(quote.bookHash && quote.cfi);
  const quoteLabel = _('Quote: {{text}}', { text: quote.text });
  const tileClassName = clsx(
    'eink-bordered bg-base-100 group relative w-full rounded-2xl border border-[rgba(123,36,28,0.12)] p-5 text-left transition-colors not-eink:shadow-[0_0_16px_rgb(0_0_0_/_0.18)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
    isSelectMode && 'transition-colors duration-150 hover:bg-base-200',
    !isSelectMode && canNavigate && 'hover:bg-[rgba(123,36,28,0.045)]',
    !isSelectMode && !canNavigate && 'cursor-not-allowed opacity-60',
    isSelected && 'border-2 border-base-content',
    isHighlighted && 'citas-pulse',
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
        id={quote.id}
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
      id={quote.id}
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
      <div className='relative flex min-w-0 flex-col gap-3'>
        <blockquote className='border-s-[3px] border-[rgba(170,44,34,0.38)] ps-4 font-["Times_New_Roman",Times,serif] whitespace-pre-wrap break-words text-[0.98rem] font-normal italic leading-[1.7] tracking-[0.01em] text-base-content sm:text-[1.08rem]'>
          {quote.text}
        </blockquote>
        {metadata && (
          <div className='flex flex-col items-center gap-2'>
            <span
              aria-hidden='true'
              className='relative inline-block size-3 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.42)_0%,rgba(96,96,96,0.88)_18%,rgba(20,20,20,1)_60%,rgba(0,0,0,1)_100%)] shadow-[0_2px_4px_rgba(0,0,0,0.55),0_7px_18px_rgba(0,0,0,0.28),0_0_14px_rgba(123,36,28,0.24)] before:absolute before:left-[20%] before:top-[16%] before:h-[20%] before:w-[20%] before:rounded-full before:bg-white/60 before:content-[""] after:absolute after:left-1/2 after:top-[115%] after:h-[26%] after:w-[130%] after:-translate-x-1/2 after:rounded-full after:bg-black/20 after:blur-[2px] after:content-[""]'
            />
            <p
              className='font-["Times_New_Roman",Times,serif] text-base italic tracking-[0.02em] text-white sm:text-[1.08rem]'
              style={{ WebkitTextStroke: '0.35px rgba(123,36,28,0.5)' }}
            >
              {metadata}
            </p>
          </div>
        )}
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
