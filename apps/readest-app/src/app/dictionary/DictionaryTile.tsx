'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { PiCheckCircle, PiImageSquare } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import type { DictionaryEntry } from '@/types/dictionary';

interface DictionaryTileProps {
  entry: DictionaryEntry;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelected?: (id: string) => void;
}

export default function DictionaryTile({
  entry,
  isSelectMode = false,
  isSelected = false,
  onToggleSelected,
}: DictionaryTileProps) {
  const _ = useTranslation();
  const tileClassName = clsx(
    'eink-bordered bg-base-100 group relative aspect-square overflow-hidden rounded-2xl text-left',
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
            ? `${_('Deseleccionar')} ${entry.displayTerm}`
            : `${_('Seleccionar')} ${entry.displayTerm}`
        }
        aria-pressed={isSelected}
        onClick={() => onToggleSelected?.(entry.id)}
      >
        <TileContent entry={entry} isSelected={isSelected} selectedLabel={_('Seleccionado')} />
      </button>
    );
  }

  return (
    <Link href={`/dictionary/${entry.id}`} className={tileClassName} aria-label={entry.displayTerm}>
      <TileContent entry={entry} isSelected={false} selectedLabel={_('Seleccionado')} />
    </Link>
  );
}

function TileContent({
  entry,
  isSelected,
  selectedLabel,
}: {
  entry: DictionaryEntry;
  isSelected: boolean;
  selectedLabel: string;
}) {
  return (
    <>
      {entry.imagePath ? (
        <div
          aria-hidden
          className='absolute inset-0 bg-cover bg-center'
          style={{ backgroundImage: `url("${entry.imagePath}")` }}
        />
      ) : (
        <div className='absolute inset-0 flex items-center justify-center bg-base-100'>
          <PiImageSquare aria-hidden className='text-base-content/35 size-12' />
        </div>
      )}
      {isSelected && (
        <span className='eink-bordered absolute start-2 top-2 inline-flex items-center gap-1 rounded-full border border-base-content bg-base-100 px-2 py-1 text-xs font-semibold text-base-content'>
          <PiCheckCircle aria-hidden className='size-4' />
          {selectedLabel}
        </span>
      )}
      <div className='absolute inset-x-0 bottom-0 bg-base-content/75 px-3 py-2 text-base-100 [data-eink_&]:border-base-content [data-eink_&]:border-t [data-eink_&]:bg-base-100 [data-eink_&]:text-base-content'>
        <span className='line-clamp-2 text-sm font-semibold sm:text-base'>{entry.displayTerm}</span>
      </div>
    </>
  );
}
