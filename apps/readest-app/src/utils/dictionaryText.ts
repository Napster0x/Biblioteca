export type DictionarySelectionResult =
  | {
      ok: true;
      term: string;
      displayTerm: string;
      selectedText: string;
    }
  | {
      ok: false;
      reason: 'empty' | 'multi-word' | 'invalid-word';
      selectedText: string;
    };

const SOFT_HYPHEN = /\u00ad/g;
const HYPHENATED_BREAK = /(\p{L})[-‐‑‒–—]\s*(?:\r\n|\r|\n)+\s*(\p{L})/gu;
const INTERNAL_WORD_BREAK = /(\p{L})\s*(?:\r\n|\r|\n)+\s*(\p{L})/gu;
const WHITESPACE = /\s+/gu;
const SINGLE_WORD = /^\p{L}[\p{L}\p{M}'’.-]*$/u;

export function normalizeDictionarySelection(selectedText: string): DictionarySelectionResult {
  const selectedSourceText = selectedText;
  const normalized = repairInternalBreaks(selectedText).trim();

  if (normalized.length === 0) {
    return { ok: false, reason: 'empty', selectedText: selectedSourceText };
  }

  if (WHITESPACE.test(normalized)) {
    return { ok: false, reason: 'multi-word', selectedText: selectedSourceText };
  }

  if (!SINGLE_WORD.test(normalized)) {
    return { ok: false, reason: 'invalid-word', selectedText: selectedSourceText };
  }

  return {
    ok: true,
    term: normalizeDictionaryTerm(normalized),
    displayTerm: normalized,
    selectedText: selectedSourceText,
  };
}

export function normalizeDictionaryTerm(term: string): string {
  return repairInternalBreaks(term).trim().toLocaleLowerCase();
}

function repairInternalBreaks(value: string): string {
  return value
    .normalize('NFC')
    .replace(SOFT_HYPHEN, '')
    .replace(HYPHENATED_BREAK, '$1$2')
    .replace(INTERNAL_WORD_BREAK, '$1$2');
}
