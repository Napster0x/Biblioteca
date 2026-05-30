import { describe, expect, it } from 'vitest';
import { normalizeDictionarySelection } from '@/utils/dictionaryText';

describe('normalizeDictionarySelection', () => {
  it('repairs a word split by a hyphenated line break while preserving source text', () => {
    const sourceText = 'extra-\nordinary';

    const result = normalizeDictionarySelection(sourceText);

    expect(result).toEqual({
      ok: true,
      term: 'extraordinary',
      displayTerm: 'extraordinary',
      selectedText: sourceText,
    });
  });

  it('repairs a single word split by a paragraph break', () => {
    const result = normalizeDictionarySelection('micro\n\nscope');

    expect(result).toEqual({
      ok: true,
      term: 'microscope',
      displayTerm: 'microscope',
      selectedText: 'micro\n\nscope',
    });
  });

  it('rejects multi-word selections without producing a term', () => {
    const result = normalizeDictionarySelection('two words');

    expect(result).toEqual({
      ok: false,
      reason: 'multi-word',
      selectedText: 'two words',
    });
  });
});
