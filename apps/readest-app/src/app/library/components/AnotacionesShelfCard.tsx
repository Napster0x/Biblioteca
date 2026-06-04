import clsx from 'clsx';
import { useState } from 'react';
import { PiBookBookmark } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import type { AnotacionesShelfItem } from '@/types/annotaciones';
import type { LibraryViewModeType } from '@/types/settings';

interface AnotacionesShelfCardProps {
  item: AnotacionesShelfItem;
  mode: LibraryViewModeType;
}

const AnotacionesShelfCard = ({ item, mode }: AnotacionesShelfCardProps) => {
  const _ = useTranslation();
  const [coverError, setCoverError] = useState(false);

  return (
    <div
      role='none'
      className={clsx(
        'anotaciones-shelf-card flex',
        mode === 'grid' && 'h-full flex-col justify-end',
        mode === 'list' && 'h-28 flex-row gap-4 overflow-hidden',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main eink-bordered bg-base-100 text-base-content relative flex justify-center overflow-hidden rounded',
          mode === 'grid' && 'aspect-[28/41] shadow-md',
          mode === 'list' && 'min-w-20',
        )}
      >
        {coverError ? (
          <div className='flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center'>
            <PiBookBookmark aria-hidden className='text-base-content/70 size-10' />
            {mode === 'grid' && (
              <span className='text-base-content/75 text-[0.6rem] font-medium uppercase tracking-wide'>
                Anotaciones
              </span>
            )}
          </div>
        ) : (
          <img
            src='/images/annotaciones-cover.png'
            alt='Anotaciones'
            className='absolute inset-0 h-full w-full object-cover'
            onError={() => setCoverError(true)}
          />
        )}
      </div>
      <div className={clsx('flex w-full flex-col p-0', mode === 'grid' && 'pt-2')}>
        <div className='min-w-0 flex-1'>
          <h4
            className={clsx(
              'overflow-hidden text-ellipsis font-semibold',
              mode === 'grid' && 'block whitespace-nowrap text-[0.6em] text-xs',
              mode === 'list' && 'line-clamp-2 text-base',
            )}
          >
            {item.title}
          </h4>
          {mode === 'list' && (
            <p className='text-neutral-content line-clamp-1 text-sm'>{_('Saved annotations')}</p>
          )}
        </div>
        {mode === 'grid' && <div className='placeholder' style={{ height: 15 }} />}
      </div>
    </div>
  );
};

export default AnotacionesShelfCard;
