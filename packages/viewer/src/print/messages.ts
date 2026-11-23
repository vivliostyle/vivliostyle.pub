import type { PrintPhase } from './flow';

type PrintStatusPhase = Exclude<PrintPhase, 'printing'>;

// The print tab is the only place where the stage shows words of its own, so
// it carries them itself; the host names the locale of its own UI.
export const printMessages = {
  en: {
    preparing: 'Preparing print preview...',
    stalled:
      'Preparing to print is taking longer than expected. If printing does not start, close this tab and try again.',
    failed:
      'The document could not be prepared for printing. Close this tab and try again.',
  },
  ja: {
    preparing: '印刷プレビューを準備しています...',
    stalled:
      '印刷の準備に時間がかかっています。印刷が始まらない場合は、このタブを閉じてもう一度お試しください。',
    failed:
      '印刷する文書を準備できませんでした。このタブを閉じてもう一度お試しください。',
  },
} as const satisfies Record<string, Record<PrintStatusPhase, string>>;

export type PrintLocale = keyof typeof printMessages;
export const defaultPrintLocale: PrintLocale = 'en';

export function isPrintLocale(value: unknown): value is PrintLocale {
  return typeof value === 'string' && Object.hasOwn(printMessages, value);
}
