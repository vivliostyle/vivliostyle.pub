import { defaultStallTimeout } from './reload';

export type PrintPhase =
  | 'preparing'
  /**
   * Nothing moved forward for the stall timeout, or for a shorter time after
   * core reported an error. Core may still finish, and then prints.
   */
  | 'stalled'
  | 'printing'
  /** Core finished without a page to print. */
  | 'failed';

export type PrintEvent =
  /** The load was issued, core put pages in place or its ready state moved. */
  | { type: 'progress' }
  | { type: 'complete'; pageCount: number }
  | { type: 'error' }
  | { type: 'timeout' };

/** `watch` (re)starts the timer that sends `timeout`; `unwatch` stops it. */
export type PrintEffect =
  | { type: 'watch'; timeout: number }
  | { type: 'unwatch' }
  | { type: 'print' };

export const printStallTimeout = defaultStallTimeout;
// Core logs an error and carries on when a resource fails, but it also stops
// without another word when the publication itself fails to load.
export const printErrorTimeout = 10_000;

export function isPrintSettled(phase: PrintPhase): boolean {
  return phase === 'printing' || phase === 'failed';
}

/** Prints once, as soon as core has laid out every page. */
export function reducePrint(
  phase: PrintPhase,
  event: PrintEvent,
): [PrintPhase, PrintEffect[]] {
  if (isPrintSettled(phase)) {
    return [phase, []];
  }
  switch (event.type) {
    case 'progress':
      return ['preparing', [{ type: 'watch', timeout: printStallTimeout }]];
    case 'error':
      return phase === 'preparing'
        ? [phase, [{ type: 'watch', timeout: printErrorTimeout }]]
        : [phase, []];
    case 'timeout':
      return ['stalled', []];
    case 'complete':
      return event.pageCount > 0
        ? ['printing', [{ type: 'unwatch' }, { type: 'print' }]]
        : ['failed', [{ type: 'unwatch' }]];
  }
}
