export type ColorScheme = 'light' | 'dark';

// `@v/ui`'s theme provider resolves the theme, `system` included, into this
// class, which is also what its `dark` variant keys off.
const darkClass = 'dark';

export function currentColorScheme(): ColorScheme {
  return document.documentElement.classList.contains(darkClass)
    ? 'dark'
    : 'light';
}

/** Calls `listener` on every change, not with the current value. */
export function subscribeColorScheme(
  listener: (colorScheme: ColorScheme) => void,
): () => void {
  let colorScheme = currentColorScheme();
  const observer = new MutationObserver(() => {
    const next = currentColorScheme();
    if (next !== colorScheme) {
      colorScheme = next;
      listener(next);
    }
  });
  observer.observe(document.documentElement, { attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** For documents that show the host's UI without a theme provider. */
export function applyColorScheme(colorScheme: ColorScheme) {
  document.documentElement.classList.toggle(darkClass, colorScheme === 'dark');
}
