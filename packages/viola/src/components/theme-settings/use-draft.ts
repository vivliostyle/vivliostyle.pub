import { useState } from 'react';

/**
 * Local text for an input that commits later. It follows `value` whenever the
 * committed value changes, and is left alone while a failed commit is shown.
 */
export function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}
