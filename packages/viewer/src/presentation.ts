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
  coversView,
  endOffset,
  firstPageAfter,
  fitScale,
  locatePage,
  moveTarget,
  offsetFor,
  type PageBox,
  type PageKey,
  pairSpreads,
  resolvePage,
  type ScrollGeometry,
  type Span,
  type SpreadIndex,
  scrollGap,
  scrollTopFor,
  viewedPage,
} from './layout';
import { linkFragment } from './links';
import type { Size } from './paper-size';
import type { PageProgression, ViewMode } from './protocol';
import { pageKeyId } from './references';
import {
  canScrollToward,
  type ScrollBox,
  type ScrollDirection,
  type ScrollStyle,
} from './scrollable';

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
  /** Core put pages in place or started to lay the publication out anew. */
  onProgress: () => void;
  /** Core started to lay the publication out anew. */
  onLayoutStart: () => void;
  /**
   * The pages of the layout core started last cover the view, settled; once
   * per layout.
   */
  onShown: () => void;
  /** Ids (see `pageKeyId`) of the pages that show placeholders for now. */
  pagesAwaitingTargets: () => ReadonlySet<string>;
}

interface Layout {
  arrangement: Arrangement;
  geometry: ScrollGeometry;
  /** Screen spans of the pages, in scroll mode. */
  spans: Span[] | null;
}

interface Tree {
  containers: HTMLElement[];
  pages: PageBox[];
}

/**
 * The pages core cleared to lay the publication out anew, shown in a layer
 * over the viewport until core's new pages cover the same view.
 */
interface Stale {
  layer: HTMLElement;
  spreadContainer: HTMLElement;
  progression: PageProgression;
  /**
   * Keyed as they were laid out: the rest of an earlier rendering that fills
   * them in would not count up from them.
   */
  tree: Tree;
}

const padding = 16;
const pageContainerAttribute = 'data-vivliostyle-page-container';
const pagesCounterAttribute = 'data-vivliostyle-pages-counter';
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

// Focusing an element of a frame that is not focused would take the focus
// from the page around it, where the user is likely typing.
function hasFocus(element: Element): boolean {
  return document.hasFocus() && document.activeElement === element;
}

function readTree(spreadContainer: Element | null, fallback: Size): Tree {
  const containers: HTMLElement[] = [];
  const pages: PageBox[] = [];
  const pageCounts = new Map<number, number>();
  for (const child of spreadContainer?.children ?? []) {
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
  return { containers, pages };
}

/**
 * Shows core's laid-out pages in our own view modes without ever making core
 * lay out again. The position is kept as a page key plus an offset, so it
 * survives core replacing containers or laying everything out anew.
 *
 * When core clears the viewport to lay out anew, the pages it removed stay
 * on screen, in a layer of their own, and are what paging, scrolling and view
 * mode changes act on, until its new pages cover the same view.
 */
export class Presentation {
  readonly #viewport: HTMLElement;
  readonly #options: PresentationOptions;
  readonly #rootObserver = new MutationObserver(() => this.#attach());
  readonly #pageObserver = new MutationObserver(() => {
    this.#options.onProgress();
    this.#update();
  });
  #mode: ViewMode;
  #complete = false;
  #layoutFailed = false;
  #target: PageKey = { spineIndex: 0, pageIndex: 0 };
  #targetOffset: number | 'end' = 0;
  /** Id of a link target that is not laid out yet. */
  #pendingFragment: string | null = null;
  /** Core's spread container, where it puts the pages it lays out. */
  #liveSpreadContainer: HTMLElement | null = null;
  #liveGeneration = 0;
  /** The live generation last reported as shown (see `onShown`). */
  #shownGeneration = 0;
  #stale: Stale | null = null;
  /**
   * The stale pages last replaced before core completed, which fill in for
   * the pages it has not laid out yet when the new ones go stale in turn.
   */
  #fallback: Tree | null = null;
  // The rest describes the displayed pages: the stale ones while there are.
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
  // The most pages, and the tallest scroll arrangement, shown since core last
  // completed, so that pages still to come, or taken away to be laid out
  // again, do not seem to have been removed.
  #provisionalPageCount: number | null = null;
  #reservedHeight: number | null = null;

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

  /** Incremented whenever core starts to lay the publication out anew. */
  get liveGeneration(): number {
    return this.#liveGeneration;
  }

  /** Whether pages laid out before the current layout began may be shown. */
  get holdsOutdatedPages(): boolean {
    return this.#stale !== null || this.#fallback !== null;
  }

  setViewMode(mode: ViewMode) {
    if (mode === this.#mode) {
      return;
    }
    this.#update(() => {
      this.#mode = mode;
      this.#viewport.setAttribute('data-pub-view-mode', mode);
      this.#stale?.layer.setAttribute('data-pub-view-mode', mode);
      this.#listenToWheel();
    });
  }

  /**
   * Whether the latest layout failed or stalled. Core then never completes,
   * so pages with placeholders are shown as they are rather than waited for.
   */
  setLayoutFailed(failed: boolean) {
    if (failed !== this.#layoutFailed) {
      this.#update(() => {
        this.#layoutFailed = failed;
      });
    }
  }

  /** Whether core has laid out every page, after which a missing page is gone. */
  setComplete(complete: boolean) {
    if (complete !== this.#complete) {
      this.#update(() => {
        this.#complete = complete;
        if (complete) {
          this.#fallback = null;
          this.#provisionalPageCount = null;
          this.#reservedHeight = null;
        }
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

  get #scroller(): HTMLElement {
    return this.#stale?.layer ?? this.#viewport;
  }

  get #spreadContainer(): HTMLElement | null {
    return this.#stale?.spreadContainer ?? this.#liveSpreadContainer;
  }

  get #displayedComplete(): boolean {
    return this.#stale === null && this.#complete;
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
    if (spreadContainer !== this.#liveSpreadContainer) {
      const previous = this.#liveSpreadContainer;
      this.#pageObserver.disconnect();
      // While stale pages are shown, a cleared tree never was and is dropped.
      if (!this.#stale && previous && !previous.isConnected && this.#layout) {
        // Our size rule also holds for the box core put in place of the old
        // one, so the position survives the clear and a scroll not reported
        // yet counts.
        this.#syncScroll();
        this.#freeze(
          this.#withFallback(this.#containers, this.#pages),
          previous,
        );
      } else if (!this.#stale) {
        this.#unplaceAll();
      }
      this.#liveSpreadContainer = spreadContainer;
      this.#liveGeneration += 1;
      if (spreadContainer) {
        this.#pageObserver.observe(spreadContainer, { childList: true });
        this.#options.onLayoutStart();
      }
      this.#options.onProgress();
    }
    this.#update();
  }

  /** `pages` followed by those of the fallback that come after them. */
  #withFallback(containers: HTMLElement[], pages: PageBox[]): Tree {
    const fallback = this.#fallback;
    if (!fallback) {
      return { containers, pages };
    }
    const from =
      pages.length > 0
        ? firstPageAfter(fallback.pages, pages[pages.length - 1])
        : 0;
    return {
      containers: [...containers, ...fallback.containers.slice(from)],
      pages: [...pages, ...fallback.pages.slice(from)],
    };
  }

  /**
   * Shows `tree` in a layer that replicates the viewport, in boxes made after
   * those around `spreadContainer`. Runs from the mutation observer, before
   * the browser renders the cleared viewport.
   */
  #freeze(tree: Tree, spreadContainer: HTMLElement) {
    const outerZoomBox = spreadContainer.parentElement;
    if (!outerZoomBox) {
      return;
    }
    const viewport = this.#viewport;
    this.#unplaceAll();
    this.#fallback = null;
    const layer = document.createElement('div');
    // Core's viewport rules and ours select by these attributes, and the
    // pages need the custom properties core set on the viewport's style.
    for (const { name, value } of viewport.attributes) {
      if (name !== 'id' && name !== 'tabindex') {
        layer.setAttribute(name, value);
      }
    }
    layer.setAttribute('data-pub-stale', '');
    layer.setAttribute('aria-busy', 'true');
    layer.tabIndex = viewport.tabIndex;
    // Boxes of our own: core's old viewport object keeps pointing at its
    // boxes, so a layout task that outlived its cancellation inserts there, or
    // fails, instead of changing the pages shown.
    const staleOuterZoomBox = outerZoomBox.cloneNode(false) as HTMLElement;
    const staleSpreadContainer = spreadContainer.cloneNode(
      false,
    ) as HTMLElement;
    for (const container of tree.containers) {
      container.removeAttribute(visibleAttribute);
    }
    staleSpreadContainer.append(...tree.containers);
    staleOuterZoomBox.append(staleSpreadContainer);
    // Outdated content: focus, selection, links and assistive technology stay
    // out of it, while the layer around it still scrolls.
    staleOuterZoomBox.inert = true;
    layer.append(staleOuterZoomBox);
    layer.addEventListener('scroll', this.#onScroll, { passive: true });
    const focused = hasFocus(viewport);
    // Ids repeat in both trees; scripts of the document must find the new
    // ones first.
    viewport.after(layer);
    // The stale pages start out arranged as they were, and a view whose
    // target is missing is not scrolled to it, so it has to start here.
    layer.scrollTop = viewport.scrollTop;
    // Keyboard focus and assistive technology go to the layer meanwhile.
    viewport.inert = true;
    if (focused) {
      layer.focus({ preventScroll: true });
    }
    this.#stale = {
      layer,
      spreadContainer: staleSpreadContainer,
      progression: this.#progression,
      tree,
    };
    this.#appliedScrollTop = layer.scrollTop;
    this.#listenToWheel();
  }

  #dropStale() {
    const stale = this.#stale;
    if (!stale) {
      return;
    }
    if (!this.#complete) {
      this.#fallback = stale.tree;
    }
    const focused = hasFocus(stale.layer);
    this.#stale = null;
    this.#viewport.inert = false;
    stale.layer.remove();
    if (focused) {
      this.#viewport.focus({ preventScroll: true });
    }
    this.#unplaceAll();
    this.#appliedScrollTop = this.#viewport.scrollTop;
    this.#listenToWheel();
  }

  #unplaceAll() {
    for (const container of this.#placed.keys()) {
      container.removeAttribute(visibleAttribute);
    }
    this.#placed.clear();
  }

  /** Whether the pages core has laid out so far show what the stale ones do. */
  #liveCoversView(): boolean {
    const { containers, pages } = readTree(
      this.#liveSpreadContainer,
      this.#options.fallbackPageSize(),
    );
    const index = resolvePage(pages, this.#target, this.#complete);
    if (index === null) {
      return false;
    }
    let awaitingTargets: ReadonlySet<string> | undefined;
    const scale =
      this.#mode === 'scroll'
        ? fitScale(
            arrangeScroll(pages).width,
            this.#viewport.clientWidth - padding * 2,
          )
        : 1;
    return coversView(pages, index, {
      mode: this.#mode,
      progression: this.#options.pageProgression() ?? 'ltr',
      complete: this.#complete,
      offset: typeof this.#targetOffset === 'number' ? this.#targetOffset : 0,
      viewHeight: this.#viewport.clientHeight / scale,
      // Core writes the total page count into counter(pages) only once it
      // has laid out every page; until then it shows 0.
      unsettled: (i) => {
        if (this.#layoutFailed) {
          return false;
        }
        awaitingTargets ??= this.#options.pagesAwaitingTargets();
        return (
          awaitingTargets.has(pageKeyId(pages[i])) ||
          containers[i].querySelector(`[${pagesCounterAttribute}]`) !== null
        );
      },
    });
  }

  /**
   * Re-derives everything from the DOM and the target. `change` runs after a
   * user scroll not yet reported by a `scroll` event is taken in, so it wins.
   */
  #update(change?: () => void) {
    this.#syncScroll();
    change?.();
    this.#present();
    // Both happen before the browser renders again, so the new pages replace
    // the stale ones without a frame in between.
    if (this.#stale && this.#liveCoversView()) {
      this.#dropStale();
      this.#present();
    }
    this.#publish();
    if (
      this.#shownGeneration !== this.#liveGeneration &&
      !this.#stale &&
      this.#liveCoversView()
    ) {
      this.#shownGeneration = this.#liveGeneration;
      // Last: the next load may be issued from here.
      this.#options.onShown();
    }
  }

  #present() {
    const { containers, pages } =
      this.#stale?.tree ??
      readTree(this.#liveSpreadContainer, this.#options.fallbackPageSize());
    this.#containers = containers;
    this.#pages = pages;
    if (!this.#complete) {
      this.#provisionalPageCount = Math.max(
        this.#provisionalPageCount ?? 0,
        pages.length,
      );
      this.#reservedHeight = Math.max(
        this.#reservedHeight ?? 0,
        arrangeScroll(pages).height,
      );
    }
    const linked = this.#takeLinkTarget();
    this.#progression =
      this.#stale?.progression ?? this.#options.pageProgression() ?? 'ltr';
    this.#spreadIndex =
      this.#mode === 'spread'
        ? pairSpreads(
            pages.map((page) => page.side),
            this.#progression,
          )
        : null;
    const location = locatePage(pages, this.#target, this.#displayedComplete);
    if (location?.settled) {
      // A target that is gone for good settles on the page shown instead,
      // which a later layout then keeps.
      const page = pages[location.index];
      this.#target = { spineIndex: page.spineIndex, pageIndex: page.pageIndex };
    }
    // While the target may still come back, a paged view shows the page
    // before it, and a scrolled one stays where it is.
    this.#current =
      location && (location.settled || this.#mode !== 'scroll')
        ? location.index
        : null;
    const arrangement = this.#arrange();
    const scale = fitScale(
      arrangement?.width ?? 0,
      this.#scroller.clientWidth - padding * 2,
    );
    this.#place(arrangement, scale);
    if (linked && this.#current === linked.index) {
      this.#targetOffset =
        (linked.element.getBoundingClientRect().top -
          this.#containers[linked.index].getBoundingClientRect().top) /
        scale;
    }
    this.#scroll(arrangement, scale);
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
      if (this.#displayedComplete) {
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
    const height = Math.max(
      arrangement?.height ?? 0,
      this.#mode === 'scroll' ? (this.#reservedHeight ?? 0) : 0,
    );
    // Transforms take no layout space, so the outer zoom box, which clips the
    // transformed spread container, is what scrolls. A rule, not inherited
    // custom properties, so a change does not restyle every page below.
    const css = `@media screen {
  [data-pub-view-mode] {
    padding: ${padding}px;
  }
  [data-pub-view-mode] > [data-vivliostyle-outer-zoom-box] {
    width: ${(arrangement?.width ?? 0) * scale}px !important;
    height: ${height * scale}px !important;
  }
  [data-pub-view-mode] > [data-vivliostyle-outer-zoom-box] > [data-vivliostyle-spread-container] {
    --viv-outputScale: ${scale};
  }
}`;
    if (this.#style.textContent !== css) {
      this.#style.textContent = css;
    }

    const unplaced = new Set(this.#placed.keys());
    for (const { index, x, y } of arrangement?.placements ?? []) {
      const container = this.#containers[index];
      const placement = `${x},${y}`;
      unplaced.delete(container);
      if (this.#placed.get(container) !== placement) {
        // Core clears these before it puts a container in place and leaves
        // them alone afterwards.
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;
        container.setAttribute(visibleAttribute, '');
        this.#placed.set(container, placement);
      }
    }
    for (const container of unplaced) {
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
    const scroller = this.#scroller;
    const originTop =
      outerZoomBox.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      scroller.clientTop +
      scroller.scrollTop;
    const geometry: ScrollGeometry = {
      originTop,
      // A page scrolled to in scroll mode starts right below the gap before
      // it, which shrinks with the scale, so no edge of the previous page
      // shows above it.
      padding:
        this.#mode === 'scroll'
          ? Math.min(padding, scrollGap * scale)
          : padding,
      scale,
    };
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
        scroller.clientHeight,
      );
    }
    this.#desiredScrollTop = scrollTopFor(
      geometry,
      this.#pageY(this.#current),
      this.#targetOffset,
    );
    // Setting the position, even to about the same value, stops a momentum
    // scroll in progress.
    if (Math.abs(scroller.scrollTop - this.#desiredScrollTop) >= 0.5) {
      scroller.scrollTop = this.#desiredScrollTop;
    }
    this.#appliedScrollTop = scroller.scrollTop;
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
    const scroller = this.#scroller;
    const scrollTop = scroller.scrollTop;
    if (scrollTop === this.#appliedScrollTop) {
      return;
    }
    this.#appliedScrollTop = scrollTop;
    const layout = this.#layout;
    if (!layout) {
      return;
    }
    // The browser clamps the position when the content shrinks below the one
    // we asked for, e.g. while core lays the publication out anew. That is
    // not the user moving away from the target.
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    if (
      this.#desiredScrollTop > maxScrollTop + 1 &&
      Math.abs(scrollTop - maxScrollTop) <= 1
    ) {
      return;
    }
    if (layout.spans) {
      const index = viewedPage(
        layout.spans,
        scrollTop,
        scrollTop + scroller.clientHeight,
        this.#current !== null,
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
    if (this.#current === null) {
      return;
    }
    this.#pendingFragment = null;
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
      pageCount: Math.max(pageCount, this.#provisionalPageCount ?? 0),
      canPrev: canMove('prev'),
      canNext: canMove('next'),
      pageProgression: this.#progression,
    });
  }

  #listenToWheel() {
    this.#viewport.removeEventListener('wheel', this.#onWheel);
    this.#stale?.layer.removeEventListener('wheel', this.#onWheel);
    // A non-passive wheel listener makes every scroll wait for the main
    // thread, which core keeps busy while it lays pages out.
    if (this.#mode !== 'scroll') {
      this.#scroller.addEventListener('wheel', this.#onWheel, {
        passive: false,
      });
    }
  }

  #canScroll(target: EventTarget | null, direction: ScrollDirection): boolean {
    return canScrollToward(
      target instanceof Element ? target : null,
      this.#scroller,
      direction,
      scrollStyle,
    );
  }

  readonly #onScroll = (event: Event) => {
    if (
      event.currentTarget === this.#scroller &&
      this.#scroller.scrollTop !== this.#appliedScrollTop
    ) {
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
          ? this.#scroller.clientHeight
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
