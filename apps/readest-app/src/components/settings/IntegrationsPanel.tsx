import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { UsbIcon, WrenchIcon } from 'lucide-react';

const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();

  return (
    <div className='my-4 w-full space-y-6 px-4'>
      <div>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Sync')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Pair your devices to sync reading data.')}
        </p>
      </div>

      <div className='mb-2 text-[0.7rem] font-semibold uppercase tracking-widest text-base-content/55'>
        {_('USB')}
      </div>

      <div
        role='group'
        aria-disabled='true'
        aria-label={_('USB Sync maintenance')}
        className={`
          card eink-bordered border border-base-200 bg-base-100 w-full text-left cursor-default
          transition-colors duration-150
        `}
      >
        <div className='card-body flex flex-row items-center gap-4 p-4'>
          <div className='eink-bordered flex size-10 shrink-0 items-center justify-center rounded-full border border-base-200 bg-base-200 text-base-content/70'>
            <UsbIcon className='size-5' />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='text-sm font-medium'>{_('USB Sync')}</div>
              <span className='eink-bordered inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-200 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-base-content/70'>
                <WrenchIcon className='size-3' />
                {_('In development')}
              </span>
            </div>
            <div className='text-base-content/60 text-xs leading-relaxed'>
              {_(
                'USB Sync is temporarily in maintenance while we prepare a more stable experience.',
              )}
            </div>
          </div>

          <button
            type='button'
            disabled
            aria-disabled='true'
            className='btn btn-sm btn-primary gap-1.5'
          >
            <UsbIcon className='size-3.5' />
            {_('USB Sync')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IntegrationsPanel;
