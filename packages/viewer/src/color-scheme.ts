import type { ColorScheme } from './protocol';

export function applyColorScheme(colorScheme: ColorScheme) {
  document.documentElement.dataset.pubColorScheme = colorScheme;
}
