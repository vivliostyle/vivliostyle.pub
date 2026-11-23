import type { PageProgression, ViewMode } from '../../protocol';
import {
  initialWheelState,
  keyCommand,
  type PageCommand,
  reduceWheel,
} from './input';
import { linkFragment } from './links';
import {
  canScrollToward,
  type ScrollBox,
  type ScrollDirection,
  type ScrollStyle,
} from './scrollable';

export interface InputHandlerOptions {
  /** The element the displayed pages scroll in. */
  scroller: () => HTMLElement;
  viewMode: () => ViewMode;
  pageProgression: () => PageProgression;
  /** Where the displayed pages are; only links in there are followed. */
  spreadContainer: () => HTMLElement | null;
  move: (command: PageCommand) => void;
  /** Called with the id a link in a displayed page points at. */
  followLink: (fragment: string) => void;
}

const xlinkNamespace = 'http://www.w3.org/1999/xlink';

function scrollStyle(box: ScrollBox): ScrollStyle {
  const { overflowX, overflowY, writingMode, direction } = getComputedStyle(
    box as Element,
  );
  return { overflowX, overflowY, writingMode, direction };
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}

/** Turns keys, wheel gestures and link clicks into page moves. */
export class InputHandler {
  readonly #options: InputHandlerOptions;
  #wheelTarget: HTMLElement | null = null;
  #wheel = initialWheelState;

  constructor(options: InputHandlerOptions) {
    this.#options = options;
    // Capturing on the window runs before any listener of the document's
    // scripts, which could otherwise stop the event before it is cancelled.
    window.addEventListener('click', this.#onClick, { capture: true });
    window.addEventListener('keydown', this.#onKeyDown);
    this.listenToWheel();
  }

  /** To be called whenever the scroller or the view mode changes. */
  listenToWheel() {
    this.#wheelTarget?.removeEventListener('wheel', this.#onWheel);
    this.#wheelTarget = null;
    // A non-passive wheel listener makes every scroll wait for the main
    // thread, which core keeps busy while it lays pages out.
    if (this.#options.viewMode() !== 'scroll') {
      this.#wheelTarget = this.#options.scroller();
      this.#wheelTarget.addEventListener('wheel', this.#onWheel, {
        passive: false,
      });
    }
  }

  #canScroll(target: EventTarget | null, direction: ScrollDirection): boolean {
    return canScrollToward(
      target instanceof Element ? target : null,
      this.#options.scroller(),
      direction,
      scrollStyle,
    );
  }

  readonly #onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.defaultPrevented) {
      return;
    }
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.#options.scroller().clientHeight
          : 1;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const physical = horizontal ? event.deltaX : event.deltaY;
    const direction: ScrollDirection = horizontal
      ? physical > 0
        ? 'right'
        : 'left'
      : physical > 0
        ? 'down'
        : 'up';
    // A sideways swipe turns pages the way they progress.
    const delta =
      physical *
      unit *
      (horizontal && this.#options.pageProgression() === 'rtl' ? -1 : 1);
    const { state, action } = reduceWheel(this.#wheel, {
      time: event.timeStamp,
      delta,
      canScroll: physical !== 0 && this.#canScroll(event.target, direction),
    });
    this.#wheel = state;
    if (action === 'native') {
      return;
    }
    event.preventDefault();
    if (action === 'next') {
      this.#options.move('next');
    } else if (action === 'prev') {
      this.#options.move(horizontal ? 'prev' : 'prevEnd');
    }
  };

  readonly #onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isEditable(event.target)
    ) {
      return;
    }
    const command = keyCommand({
      key: event.key,
      mode: this.#options.viewMode(),
      progression: this.#options.pageProgression(),
      canScroll: (direction) => this.#canScroll(event.target, direction),
    });
    if (command) {
      event.preventDefault();
      this.#options.move(command);
    }
  };

  // Core only handles links on the page it considers current, and only by
  // reporting them, so every link in a displayed page is handled here. The
  // browser must never follow one: that would navigate the stage document.
  readonly #onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const link = event.target.closest('a[href], a[*|href], area[href]');
    if (!link) {
      return;
    }
    event.preventDefault();
    if (
      event.button !== 0 ||
      !this.#options.spreadContainer()?.contains(link)
    ) {
      return;
    }
    const fragment = linkFragment(
      link.getAttribute('href') ??
        link.getAttributeNS(xlinkNamespace, 'href') ??
        '',
    );
    if (fragment !== null) {
      this.#options.followLink(fragment);
    }
  };
}
