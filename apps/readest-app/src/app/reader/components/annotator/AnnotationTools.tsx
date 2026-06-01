import { IconType } from 'react-icons';
import { FiSearch } from 'react-icons/fi';
import { PiHighlighterFill } from 'react-icons/pi';
import { TbHexagonLetterA, TbHexagonLetterC, TbHexagonLetterD } from 'react-icons/tb';
import { AnnotationToolType } from '@/types/annotator';
import { stubTranslation as _ } from '@/utils/misc';

type AnnotationToolButton = {
  type: AnnotationToolType;
  label: string;
  tooltip: string;
  Icon: IconType;
  quickAction?: boolean;
};

function createAnnotationToolButtons(buttons: AnnotationToolButton[]): AnnotationToolButton[] {
  return buttons;
}

export const annotationToolButtons: AnnotationToolButton[] = createAnnotationToolButtons([
  {
    type: 'dictionary',
    label: _('Diccionario'),
    tooltip: _('Save word to dictionary after selection'),
    Icon: TbHexagonLetterD,
    quickAction: true,
  },
  {
    type: 'placeholder-c',
    label: _('Placeholder C'),
    tooltip: _(''),
    Icon: TbHexagonLetterC,
  },
  {
    type: 'annotate',
    label: _('Annotate'),
    tooltip: _('Annotate text after selection'),
    Icon: TbHexagonLetterA,
  },
  {
    type: 'highlight',
    label: _('Highlight'),
    tooltip: _('Highlight text after selection'),
    Icon: PiHighlighterFill,
    quickAction: true,
  },
  {
    type: 'search',
    label: _('Search'),
    tooltip: _('Search text after selection'),
    Icon: FiSearch,
    quickAction: true,
  },
]);

export const annotationToolQuickActions = annotationToolButtons.filter(
  (button) => button.quickAction,
);
