import {
  initialWheelState,
  keyCommand,
  type PageCommand,
  reduceWheel,
} from './input';
import {
  type Arrangement,
  arrangeScroll,
  arrangeSingle,
  arrangeSpread,
  dominantSpan,
  endOffset,
  fitScale,
  moveTarget,
  offsetFor,
  type PageBox,
  type PageKey,
  pairSpreads,
  resolvePage,
  type ScrollGeometry,
  type Span,
  type SpreadIndex,
  scrollTopFor,
} from './layout';
import { linkFragment } from './links';
import type { Size } from './paper-size';
import type { PageProgression, ViewMode } from './protocol';
import {
  canScrollToward,
  type ScrollBox,
  type ScrollDirection,
  type ScrollStyle,
} from './scrollable';

/** A page and the offset into it the viewport shows (see `offsetFor`). */
export interface PagePosition extends PageKey {
  offset: number;
}

export interface PresentationSnapshot {
  pageIndex: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  pageProgression: PageProgression;
}

export interface PresentationOptions {
  viewMode: ViewMode;
  /** Size of a page whose container carries no size of its own. */
  fallbackPageSize: () => Size;
  pageProgression: () => PageProgression | null;
  onChange: (snapshot: PresentationSnapshot) => void;
}

interface Layout {
  arrangement: Arrangement;
  geometry: ScrollGeometry;
  /** Screen spans of the pages, in scroll mode. */
  spans: Span[] | null;
}

const padding = 16;
const pageContainerAttribute = 'data-vivliostyle-page-container';
const visibleAttribute = 'data-pub-visible';
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

/**
 * Shows core's laid-out pages in our own view modes without ever making core
 * lay out again. The position is kept as a page key plus an offset, so it
 * survives core replacing containers or laying everything out anew.
 */
export class Presentation {
  readonly #viewport: HTMLElement;
  readonly #options: PresentationOptions;
  readonly #rootObserver = new MutationObserver(() => this.#attach());
  readonly #pageObserver = new MutationObserver(() => this.#update());
  #mode: ViewMode;
  #complete = false;
  #target: PageKey = { spineIndex: 0, pageIndex: 0 };
  #targetOffset: number | 'end' = 0;
  /** Id of a link target that is not laid out yet. */
  #pendingFragment: string | null = null;
  #spreadContainer: HTMLElement | null = null;
  #containers: HTMLElement[] = [];
  #pages: PageBox[] = [];
  #progression: PageProgression = 'ltr';
  #spreadIndex: SpreadIndex | null = null;
  #current: number | null = null;
  #lastPageIndex = 0;
  #layout: Layout | null = null;
  readonly #placed = new Map<HTMLElement, string>();
  readonly #style = document.createElement('style');
  #appliedScrollTop = 0;
  #desiredScrollTop = 0;
  #wheel = initialWheelState;

  constructor(viewport: HTMLElement, options: PresentationOptions) {
    this.#viewport = viewport;
    this.#options = options;
    this.#mode = options.viewMode;
    document.head.append(this.#style);
    viewport.setAttribute('data-pub-view-mode', this.#mode);
    this.#rootObserver.observe(viewport, { childList: true });
    viewport.addEventListener('scroll', this.#onScroll, { passive: true });
    // Capturing on the window runs before any listener of the document's
    // scripts, which could otherwise stop the event before it is cancelled.
    window.addEventListener('click', this.#onClick, { capture: true });
    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('resize', this.#onResize);
    this.#listenToWheel();
    this.#attach();
  }

  get spreadContainer(): HTMLElement | null {
    return this.#spreadContainer;
  }

  setViewMode(mode: ViewMode) {
    if (mode === this.#mode) {
      return;
    }
    this.#update(() => {
      this.#mode = mode;
      this.#viewport.setAttribute('data-pub-view-mode', mode);
      this.#listenToWheel();
    });
  }

  /** Whether core has laid out every page, after which a missing page is gone. */
  setComplete(complete: boolean) {
    if (complete !== this.#complete) {
      this.#update(() => {
        this.#complete = complete;
      });
    }
  }

  move(command: PageCommand) {
    this.#syncScroll();
    if (this.#current === null) {
      return;
    }
    this.#pendingFragment = null;
    const target = moveTarget(
      this.#mode,
      this.#current,
      this.#pages.length,
      this.#spreadIndex,
      command === 'prevEnd' ? 'prev' : command,
    );
    if (target !== null) {
      this.#show(target, command === 'prevEnd' ? 'end' : 0);
    }
  }

  goTo(pageIndex: number) {
    this.#syncScroll();
    this.#pendingFragment = null;
    if (this.#pages.length > 0 && Number.isFinite(pageIndex)) {
      this.#show(
        Math.min(Math.max(Math.trunc(pageIndex), 0), this.#pages.length - 1),
        0,
      );
    }
  }

  capturePosition(): PagePosition {
    this.#syncScroll();
    return {
      ...this.#target,
      offset: this.#targetOffset === 'end' ? 0 : this.#targetOffset,
    };
  }

  restorePosition(position: PagePosition) {
    this.#update(() => {
      this.#pendingFragment = null;
      this.#target = {
        spineIndex: position.spineIndex,
        pageIndex: position.pageIndex,
      };
      this.#targetOffset = position.offset;
    });
  }

  #show(index: number, offset: number | 'end') {
    const page = this.#pages[index];
    this.#update(() => {
      this.#target = { spineIndex: page.spineIndex, pageIndex: page.pageIndex };
      this.#targetOffset = offset;
    });
  }

  #attach() {
    const outerZoomBox = this.#viewport.querySelector(
      ':scope > [data-vivliostyle-outer-zoom-box]',
    );
    const spreadContainer =
      outerZoomBox?.querySelector<HTMLElement>(
        ':scope > [data-vivliostyle-spread-container]',
      ) ?? null;
    if (spreadContainer !== this.#spreadContainer) {
      this.#pageObserver.disconnect();
      this.#placed.clear();
      this.#spreadContainer = spreadContainer;
      if (spreadContainer) {
        this.#pageObserver.observe(spreadContainer, { childList: true });
      }
    }
    this.#update();
  }

  /**
   * Re-derives everything from the DOM and the target. `change` runs after a
   * user scroll not yet reported by a `scroll` event is taken in, so it wins.
   */
  #update(change?: () => void) {
    this.#syncScroll();
    change?.();
    this.#readPages();
    const linked = this.#takeLinkTarget();
    this.#progression = this.#options.pageProgression() ?? 'ltr';
    this.#spreadIndex =
      this.#mode === 'spread'
        ? pairSpreads(
            this.#pages.map((page) => page.side),
            this.#progression,
          )
        : null;
    this.#current = resolvePage(this.#pages, this.#target, this.#complete);
    const arrangement = this.#arrange();
    const scale = fitScale(
      arrangement?.width ?? 0,
      this.#viewport.clientWidth - padding * 2,
    );
    this.#place(arrangement, scale);
    if (linked && this.#current === linked.index) {
      this.#targetOffset =
        (linked.element.getBoundingClientRect().top -
          this.#containers[linked.index].getBoundingClientRect().top) /
        scale;
    }
    this.#scroll(arrangement, scale);
    this.#publish();
  }

  // Laid-out pages are all in the DOM, so the ids core writes into them find a
  // link target without core's navigation, which waits for everything before
  // the target to be laid out and holds back every other command meanwhile.
  #takeLinkTarget(): { index: number; element: Element } | null {
    const fragment = this.#pendingFragment;
    if (fragment === null) {
      return null;
    }
    const id = CSS.escape(fragment);
    const element = this.#spreadContainer?.querySelector(
      `[data-vivliostyle-id="${id}"], #${id}`,
    );
    const container = element?.closest(`[${pageContainerAttribute}]`);
    const index = container
      ? this.#containers.indexOf(container as HTMLElement)
      : -1;
    if (!element || index < 0) {
      if (this.#complete) {
        this.#pendingFragment = null;
      }
      return null;
    }
    this.#pendingFragment = null;
    const page = this.#pages[index];
    this.#target = { spineIndex: page.spineIndex, pageIndex: page.pageIndex };
    this.#targetOffset = 0;
    return { index, element };
  }

  #readPages() {
    const containers: HTMLElement[] = [];
    const pages: PageBox[] = [];
    const pageCounts = new Map<number, number>();
    const fallback = this.#options.fallbackPageSize();
    for (const child of this.#spreadContainer?.children ?? []) {
      if (
        !(child instanceof HTMLElement) ||
        !child.hasAttribute(pageContainerAttribute)
      ) {
        continue;
      }
      const spineIndex =
        Number(child.getAttribute('data-vivliostyle-spine-index')) || 0;
      // Core numbers pages only once their layout settles, after it has put
      // them in place; the order of the containers is final before that.
      const pageIndex = pageCounts.get(spineIndex) ?? 0;
      pageCounts.set(spineIndex, pageIndex + 1);
      containers.push(child);
      pages.push({
        spineIndex,
        pageIndex,
        side:
          child.getAttribute('data-vivliostyle-page-side') === 'left'
            ? 'left'
            : 'right',
        // Core sizes each container to its page sheet in px.
        width: Number.parseFloat(child.style.width) || fallback.width,
        height: Number.parseFloat(child.style.height) || fallback.height,
      });
    }
    this.#containers = containers;
    this.#pages = pages;
  }

  #arrange(): Arrangement | null {
    if (this.#mode === 'scroll') {
      return this.#pages.length > 0 ? arrangeScroll(this.#pages) : null;
    }
    if (this.#current === null) {
      return null;
    }
    if (this.#spreadIndex) {
      const { spreads, spreadOf } = this.#spreadIndex;
      return arrangeSpread(this.#pages, spreads[spreadOf[this.#current]]);
    }
    return arrangeSingle(this.#pages, this.#current);
  }

  #place(arrangement: Arrangement | null, scale: number) {
    // Transforms take no layout space, so the outer zoom box, which clips the
    // transformed spread container, is what scrolls. A rule, not inherited
    // custom properties, so a change does not restyle every page below.
    const css = `@media screen {
  [data-pub-view-mode] {
    padding: ${padding}px;
  }
  [data-pub-view-mode] > [data-vivliostyle-outer-zoom-box] {
    width: ${(arrangement?.width ?? 0) * scale}px !important;
    height: ${(arrangement?.height ?? 0) * scale}px !important;
  }
  [data-pub-view-mode] > [data-vivliostyle-outer-zoom-box] > [data-vivliostyle-spread-container] {
    --viv-outputScale: ${scale};
  }
}`;
    if (this.#style.textContent !== css) {
      this.#style.textContent = css;
    }

    const stale = new Set(this.#placed.keys());
    for (const { index, x, y } of arrangement?.placements ?? []) {
      const container = this.#containers[index];
      const placement = `${x},${y}`;
      stale.delete(container);
      if (this.#placed.get(container) !== placement) {
        // Core clears these before it puts a container in place and leaves
        // them alone afterwards.
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        container.setAttribute(visibleAttribute, '');
        this.#placed.set(container, placement);
      }
    }
    for (const container of stale) {
      container.removeAttribute(visibleAttribute);
      this.#placed.delete(container);
    }
  }

  #scroll(arrangement: Arrangement | null, scale: number) {
    const outerZoomBox = this.#spreadContainer?.parentElement;
    if (!arrangement || !outerZoomBox) {
      this.#layout = null;
      return;
    }
    const viewport = this.#viewport;
    const originTop =
      outerZoomBox.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      viewport.clientTop +
      viewport.scrollTop;
    const geometry: ScrollGeometry = { originTop, padding, scale };
    this.#layout = {
      arrangement,
      geometry,
      spans:
        this.#mode === 'scroll'
          ? arrangement.placements.map(({ index, y }) => ({
              top: originTop + y * scale,
              bottom: originTop + (y + this.#pages[index].height) * scale,
            }))
          : null,
    };
    if (this.#current === null) {
      return;
    }
    if (this.#targetOffset === 'end') {
      this.#targetOffset = endOffset(
        geometry,
        arrangement.height,
        viewport.clientHeight,
      );
    }
    this.#desiredScrollTop = scrollTopFor(
      geometry,
      this.#pageY(this.#current),
      this.#targetOffset,
    );
    // Setting the position, even to about the same value, stops a momentum
    // scroll in progress.
    if (Math.abs(viewport.scrollTop - this.#desiredScrollTop) >= 0.5) {
      viewport.scrollTop = this.#desiredScrollTop;
    }
    this.#appliedScrollTop = viewport.scrollTop;
  }

  #pageY(index: number): number {
    return (
      this.#layout?.arrangement.placements.find(
        (placement) => placement.index === index,
      )?.y ?? 0
    );
  }

  /** Takes a scroll position the user produced since our last one into the target. */
  #syncScroll() {
    const viewport = this.#viewport;
    const scrollTop = viewport.scrollTop;
    if (scrollTop === this.#appliedScrollTop) {
      return;
    }
    this.#appliedScrollTop = scrollTop;
    const layout = this.#layout;
    if (!layout || this.#current === null) {
      return;
    }
    // The browser clamps the position when the content shrinks below the one
    // we asked for, e.g. while core lays the publication out anew. That is
    // not the user moving away from the target.
    const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
    if (
      this.#desiredScrollTop > maxScrollTop + 1 &&
      Math.abs(scrollTop - maxScrollTop) <= 1
    ) {
      return;
    }
    this.#pendingFragment = null;
    if (layout.spans) {
      const index = dominantSpan(
        layout.spans,
        scrollTop,
        scrollTop + viewport.clientHeight,
      );
      if (index !== null) {
        const page = this.#pages[index];
        this.#current = index;
        this.#target = {
          spineIndex: page.spineIndex,
          pageIndex: page.pageIndex,
        };
      }
    }
    this.#targetOffset = offsetFor(
      layout.geometry,
      this.#pageY(this.#current),
      scrollTop,
    );
    this.#desiredScrollTop = scrollTop;
  }

  #publish() {
    const current = this.#current;
    const pageCount = this.#pages.length;
    if (current !== null) {
      this.#lastPageIndex = current;
    }
    const canMove = (move: 'next' | 'prev') =>
      current !== null &&
      moveTarget(this.#mode, current, pageCount, this.#spreadIndex, move) !==
        null;
    this.#options.onChange({
      pageIndex: current ?? this.#lastPageIndex,
      pageCount,
      canPrev: canMove('prev'),
      canNext: canMove('next'),
      pageProgression: this.#progression,
    });
  }

  #listenToWheel() {
    // A non-passive wheel listener makes every scroll wait for the main
    // thread, which core keeps busy while it lays pages out.
    if (this.#mode === 'scroll') {
      this.#viewport.removeEventListener('wheel', this.#onWheel);
    } else {
      this.#viewport.addEventListener('wheel', this.#onWheel, {
        passive: false,
      });
    }
  }

  #canScroll(target: EventTarget | null, direction: ScrollDirection): boolean {
    return canScrollToward(
      target instanceof Element ? target : null,
      this.#viewport,
      direction,
      scrollStyle,
    );
  }

  readonly #onScroll = () => {
    if (this.#viewport.scrollTop !== this.#appliedScrollTop) {
      this.#syncScroll();
      this.#publish();
    }
  };

  readonly #onResize = () => {
    this.#update();
  };

  readonly #onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.defaultPrevented) {
      return;
    }
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.#viewport.clientHeight
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
      physical * unit * (horizontal && this.#progression === 'rtl' ? -1 : 1);
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
      this.move('next');
    } else if (action === 'prev') {
      this.move(horizontal ? 'prev' : 'prevEnd');
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
      mode: this.#mode,
      progression: this.#progression,
      canScroll: (direction) => this.#canScroll(event.target, direction),
    });
    if (command) {
      event.preventDefault();
      this.move(command);
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
    if (event.button !== 0 || !this.#spreadContainer?.contains(link)) {
      return;
    }
    const fragment = linkFragment(
      link.getAttribute('href') ??
        link.getAttributeNS(xlinkNamespace, 'href') ??
        '',
    );
    if (fragment !== null) {
      this.#update(() => {
        this.#pendingFragment = fragment;
      });
    }
  };
}
