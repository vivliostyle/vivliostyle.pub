import { useLayoutEffect, useRef } from 'react';

import {
  getNumberRange,
  getStepDelta,
  stepFirstNumber,
  stepNumberAt,
} from './number-stepper';

export interface StepOptions {
  /** Stepped instead of the empty input, i.e. the placeholder. */
  fallback: string | undefined;
  /** Turns the stepped text into the text to commit. */
  complete: (text: string) => string;
}

/**
 * Arrow keys step the number at the caret and leave it selected, so that a
 * held or repeated key keeps working on the same number.
 */
export function useNumberStepper() {
  const ref = useRef<HTMLInputElement>(null);
  const stepped = useRef<{ text: string; index: number } | null>(null);

  // The committed value comes back without surrounding whitespace or
  // comments; React then rewrites the input, which drops the selection.
  useLayoutEffect(() => {
    const input = ref.current;
    const last = stepped.current;
    if (!input || !last || input.value === last.text) {
      return;
    }
    const range =
      document.activeElement === input
        ? getNumberRange(input.value, last.index)
        : null;
    stepped.current = range && { text: input.value, index: last.index };
    if (range) {
      input.setSelectionRange(range.start, range.end);
    }
  });

  /**
   * Returns the new text, already in the input, or `null` when the key is
   * not for stepping and keeps its default action.
   */
  const step = (
    event: React.KeyboardEvent<HTMLInputElement>,
    { fallback, complete }: StepOptions,
  ): string | null => {
    const delta = getStepDelta(event);
    const input = event.currentTarget;
    if (delta === null) {
      return null;
    }
    const result =
      input.value.trim() === '' && fallback
        ? stepFirstNumber(fallback, delta)
        : stepNumberAt(
            input.value,
            input.selectionStart ?? 0,
            input.selectionEnd ?? 0,
            delta,
          );
    if (!result) {
      return null;
    }
    event.preventDefault();
    const text = complete(result.text);
    const range =
      text === result.text ? result : getNumberRange(text, result.index);
    // Written before React renders it, so that the render finds the text in
    // place and leaves the selection alone.
    input.value = text;
    if (range) {
      input.setSelectionRange(range.start, range.end);
    }
    stepped.current = { text, index: result.index };
    return text;
  };

  const reset = () => {
    stepped.current = null;
  };

  return { ref, step, reset };
}
