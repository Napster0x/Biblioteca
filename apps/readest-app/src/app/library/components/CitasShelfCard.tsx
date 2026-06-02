import clsx from 'clsx';
import { PiBookBookmark } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import type { CitasShelfItem } from '@/types/citas';
import type { LibraryViewModeType } from '@/types/settings';

interface CitasShelfCardProps {
  item: CitasShelfItem;
  mode: LibraryViewModeType;
}

const CitasShelfCard = ({ item, mode }: CitasShelfCardProps) => {
  const _ = useTranslation();

  return (
    <div
      role='none'
      className={clsx(
        'citas-shelf-card flex',
        mode === 'grid' && 'h-full flex-col justify-end',
        mode === 'list' && 'h-28 flex-row gap-4 overflow-hidden',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main eink-bordered bg-base-100 text-base-content relative flex justify-center overflow-hidden rounded',
          mode === 'grid' && 'aspect-[28/41] items-center shadow-md',
          mode === 'list' && 'min-w-20 items-center',
        )}
      >
        <div className='flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center'>
          <PiBookBookmark aria-hidden className='text-base-content/70 size-10' />
          {mode === 'grid' && (
            <span className='text-base-content/75 text-[0.6rem] font-medium uppercase tracking-wide'>
              Citas
            </span>
          )}
        </div>
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
            <p className='text-neutral-content line-clamp-1 text-sm'>{_('Saved passages')}</p>
          )}
        </div>
        {mode === 'grid' && <div className='placeholder' style={{ height: 15 }} />}
      </div>
    </div>
  );
};

export default CitasShelfCard;
