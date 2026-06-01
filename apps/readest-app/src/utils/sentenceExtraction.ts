export interface ExtractSentenceInput {
  before: string;
  word: string;
  after: string;
}

export interface ExtractSentenceResult {
  sentenceBefore: string;
  sentenceWord: string;
  sentenceAfter: string;
}

/**
 * Extract the full sentence containing `word` from the surrounding context
 * (the `before`/`after` text captured around a selection).
 *
 * The returned `sentenceBefore`/`sentenceAfter` are trimmed of leading and
 * trailing whitespace; callers are expected to add their own spacing when
 * rendering. If no sentence boundary is found within the available context
 * in a given direction, that side falls back to the start/end of the
 * provided context (so we never lose information silently).
 */
export function extractSentenceFromContext({
  before,
  word,
  after,
}: ExtractSentenceInput): ExtractSentenceResult {
  if (!word) {
    return {
      sentenceBefore: before.trim(),
      sentenceWord: word,
      sentenceAfter: after.trim(),
    };
  }

  const fullText = before + word + after;
  const wordStart = before.length;
  const wordEnd = wordStart + word.length;

  // Find the start of the sentence by walking backward from the word and
  // looking for the first sentence-ending punctuation (`.`, `!`, `?`).
  let sentenceStart = 0;
  for (let i = wordStart - 1; i >= 0; i--) {
    const char = fullText[i];
    if (char === '.' || char === '!' || char === '?') {
      sentenceStart = i + 1;
      break;
    }
  }

  // Find the end of the sentence by walking forward from the word.
  let sentenceEnd = fullText.length;
  for (let i = wordEnd; i < fullText.length; i++) {
    const char = fullText[i];
    if (char === '.' || char === '!' || char === '?') {
      sentenceEnd = i + 1;
      break;
    }
  }

  return {
    sentenceBefore: fullText.slice(sentenceStart, wordStart).trim(),
    sentenceWord: fullText.slice(wordStart, wordEnd),
    sentenceAfter: fullText.slice(wordEnd, sentenceEnd).trim(),
  };
}
