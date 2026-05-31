'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { PiCheckCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { DictionaryEntry } from '@/types/dictionary';

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

interface DictionaryTileProps {
  entry: DictionaryEntry;
  imageUrl?: string;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelected?: (id: string) => void;
}

export default function DictionaryTile({
  entry,
  imageUrl,
  isSelectMode = false,
  isSelected = false,
  onToggleSelected,
}: DictionaryTileProps) {
  const _ = useTranslation();
  const tileClassName = clsx(
    'eink-bordered bg-base-100 group relative aspect-square overflow-hidden rounded-2xl text-left border-2 border-black hover:border-transparent transition-[border-color] duration-500 not-eink:drop-shadow-[0_0_14px_rgb(0_0_0_/_0.55)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
    isSelectMode && 'transition-colors duration-150 hover:bg-base-200',
    isSelected && 'border-2 border-base-content',
  );

  if (isSelectMode) {
    return (
      <button
        type='button'
        className={tileClassName}
        aria-label={
          isSelected
            ? `${_('Deseleccionar')} ${capitalize(entry.displayTerm)}`
            : `${_('Seleccionar')} ${capitalize(entry.displayTerm)}`
        }
        aria-pressed={isSelected}
        onClick={() => onToggleSelected?.(entry.id)}
      >
        <TileContent
          entry={entry}
          imageUrl={imageUrl}
          isSelected={isSelected}
          selectedLabel={_('Seleccionado')}
        />
      </button>
    );
  }

  return (
    <Link
      href={`/dictionary/${entry.id}`}
      className={tileClassName}
      aria-label={capitalize(entry.displayTerm)}
    >
      <TileContent
        entry={entry}
        imageUrl={imageUrl}
        isSelected={false}
        selectedLabel={_('Seleccionado')}
      />
    </Link>
  );
}

function TileContent({
  entry,
  imageUrl,
  isSelected,
  selectedLabel,
}: {
  entry: DictionaryEntry;
  imageUrl?: string;
  isSelected: boolean;
  selectedLabel: string;
}) {
  return (
    <>
      {imageUrl ? (
        <>
          <div
            aria-hidden
            className='absolute inset-0 bg-cover bg-center transition-all duration-500 blur-sm group-hover:blur-none'
            style={{ backgroundImage: `url("${imageUrl}")` }}
          />
          <div
            aria-hidden
            className='absolute inset-0 bg-black/15 transition-all duration-500 group-hover:bg-black/30'
          />
        </>
      ) : (
        <div
          aria-hidden
          className='absolute inset-0 transition-all duration-500 blur-sm group-hover:blur-none bg-base-300'
        />
      )}
      <div className='absolute inset-0 flex items-center justify-center p-3 transition-transform duration-500 group-hover:scale-110'>
        <span
          className='font-serif text-center font-bold leading-tight'
          style={{
            fontSize: 'clamp(1rem, 4vw, 1.5rem)',
            color: 'white',
            WebkitTextStroke: '1.8px #000',
            paintOrder: 'stroke fill',
            textShadow: '0 0 14px rgba(0,0,0,0.55)',
          }}
        >
          {capitalize(entry.displayTerm)}
        </span>
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
