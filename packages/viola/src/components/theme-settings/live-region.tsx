import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * VoiceOver skips a message that repeats the last one of a region, even when
 * the region was emptied in between, so a repeat gets a no-break space.
 */
export function useDistinctMessage() {
  const lastRef = useRef('');
  return useCallback((message: string) => {
    const text = message === lastRef.current ? `${message} ` : message;
    lastRef.current = text;
    return text;
  }, []);
}

interface Announcer {
  announce: (message: string) => void;
  /** Takes back `message` while it is still the one announced. */
  retract: (message: string) => void;
}

const AnnouncerContext = createContext<Announcer>({
  announce: () => {},
  retract: () => {},
});

export const useAnnouncer = () => use(AnnouncerContext);

// Long enough for a screen reader to read the field that focus moved to.
const ANNOUNCE_DELAY_MS = 500;

/** One polite live region for every field inside, instead of one per field. */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState('');
  const currentRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const distinct = useDistinctMessage();
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const announcer = useMemo<Announcer>(
    () => ({
      announce: (message) => {
        clearTimeout(timerRef.current);
        currentRef.current = message;
        setText('');
        timerRef.current = setTimeout(
          () => setText(distinct(message)),
          ANNOUNCE_DELAY_MS,
        );
      },
      retract: (message) => {
        if (currentRef.current === message) {
          clearTimeout(timerRef.current);
          currentRef.current = null;
          setText('');
        }
      },
    }),
    [distinct],
  );

  return (
    <AnnouncerContext.Provider value={announcer}>
      {children}
      <div aria-live="polite" className="sr-only">
        {text}
      </div>
    </AnnouncerContext.Provider>
  );
}
