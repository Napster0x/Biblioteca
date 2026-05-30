'use client';

import Link from 'next/link';
import { PiImageSquare } from 'react-icons/pi';
import type { DictionaryEntry } from '@/types/dictionary';

interface DictionaryTileProps {
  entry: DictionaryEntry;
}

export default function DictionaryTile({ entry }: DictionaryTileProps) {
  return (
    <Link
      href={`/dictionary/${entry.id}`}
      className='eink-bordered bg-base-100 group relative aspect-square overflow-hidden rounded-2xl text-left'
      aria-label={entry.displayTerm}
    >
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
      <div className='absolute inset-x-0 bottom-0 bg-base-content/75 px-3 py-2 text-base-100 [data-eink_&]:border-base-content [data-eink_&]:border-t [data-eink_&]:bg-base-100 [data-eink_&]:text-base-content'>
        <span className='line-clamp-2 text-sm font-semibold sm:text-base'>{entry.displayTerm}</span>
      </div>
    </Link>
  );
}
