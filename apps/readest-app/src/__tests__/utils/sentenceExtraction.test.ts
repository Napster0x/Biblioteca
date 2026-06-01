import { describe, it, expect } from 'vitest';

import { extractSentenceFromContext } from '@/utils/sentenceExtraction';

describe('extractSentenceFromContext', () => {
  it('returns the full sentence when the word is in the middle of a single sentence', () => {
    const result = extractSentenceFromContext({
      before: 'She was ',
      word: 'serendipitous',
      after: ' in her approach to life.',
    });

    expect(result).toEqual({
      sentenceBefore: 'She was',
      sentenceWord: 'serendipitous',
      sentenceAfter: 'in her approach to life.',
    });
  });

  it('extracts only the sentence containing the word when context has multiple sentences', () => {
    const result = extractSentenceFromContext({
      before: 'The rain stopped. The sun came out and ',
      word: 'everything',
      after: ' felt different. The birds started singing.',
    });

    expect(result).toEqual({
      sentenceBefore: 'The sun came out and',
      sentenceWord: 'everything',
      sentenceAfter: 'felt different.',
    });
  });

  it('handles exclamation marks as sentence boundaries', () => {
    const result = extractSentenceFromContext({
      before: 'Stop! He shouted: ',
      word: 'help',
      after: ' me please.',
    });

    expect(result).toEqual({
      sentenceBefore: 'He shouted:',
      sentenceWord: 'help',
      sentenceAfter: 'me please.',
    });
  });

  it('handles question marks as sentence boundaries', () => {
    const result = extractSentenceFromContext({
      before: 'Where are you? She asked if ',
      word: 'tomorrow',
      after: ' would be better.',
    });

    expect(result).toEqual({
      sentenceBefore: 'She asked if',
      sentenceWord: 'tomorrow',
      sentenceAfter: 'would be better.',
    });
  });

  it('trims leading and trailing whitespace from the extracted sentence parts', () => {
    const result = extractSentenceFromContext({
      before: '  He said that ',
      word: 'serendipity',
      after: ' changed her life.  ',
    });

    expect(result).toEqual({
      sentenceBefore: 'He said that',
      sentenceWord: 'serendipity',
      sentenceAfter: 'changed her life.',
    });
  });

  it('returns the full context when no sentence boundary exists in either direction', () => {
    const result = extractSentenceFromContext({
      before: 'she read the book',
      word: 'serendipity',
      after: ' while eating breakfast',
    });

    expect(result).toEqual({
      sentenceBefore: 'she read the book',
      sentenceWord: 'serendipity',
      sentenceAfter: 'while eating breakfast',
    });
  });

  it('uses the start of the context when there is no boundary before the word', () => {
    const result = extractSentenceFromContext({
      before: 'She was',
      word: 'serendipitous',
      after: ' in her approach. The next day.',
    });

    expect(result).toEqual({
      sentenceBefore: 'She was',
      sentenceWord: 'serendipitous',
      sentenceAfter: 'in her approach.',
    });
  });

  it('uses the end of the context when there is no boundary after the word', () => {
    const result = extractSentenceFromContext({
      before: 'The previous day. She was ',
      word: 'serendipitous',
      after: ' in her approach',
    });

    expect(result).toEqual({
      sentenceBefore: 'She was',
      sentenceWord: 'serendipitous',
      sentenceAfter: 'in her approach',
    });
  });

  it('handles an empty before', () => {
    const result = extractSentenceFromContext({
      before: '',
      word: 'serendipity',
      after: ' is a beautiful word.',
    });

    expect(result).toEqual({
      sentenceBefore: '',
      sentenceWord: 'serendipity',
      sentenceAfter: 'is a beautiful word.',
    });
  });

  it('handles an empty after', () => {
    const result = extractSentenceFromContext({
      before: 'She discovered ',
      word: 'serendipity',
      after: '',
    });

    expect(result).toEqual({
      sentenceBefore: 'She discovered',
      sentenceWord: 'serendipity',
      sentenceAfter: '',
    });
  });

  it('returns the parts unchanged when word is empty', () => {
    const result = extractSentenceFromContext({
      before: 'Some before text.',
      word: '',
      after: ' Some after text.',
    });

    expect(result).toEqual({
      sentenceBefore: 'Some before text.',
      sentenceWord: '',
      sentenceAfter: 'Some after text.',
    });
  });
});
