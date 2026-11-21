import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useDebounce } from 'react-use';

import { Button } from '@v/ui/button';
import { Code, Loader2, SlidersHorizontal, TriangleAlert } from '@v/ui/icon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@v/ui/tabs';
import { m } from '../../generated/paraglide/messages';
import { PrerenderedViews, usePrerender } from '../../hooks/use-prerender';
import {
  Fulfilled,
  Rejected,
  usePromiseState,
} from '../../hooks/use-promise-state';
import {
  DEFAULT_THEME_SCOPE,
  loadThemeVariableSchema,
  parseThemeCss,
  resolveThemeDefaults,
  scanThemeDeclarations,
  THEME_SCOPES,
  type ThemeCssModel,
  type ThemeDeclarations,
  type ThemeScopeId,
  type ThemeVariableSchema,
} from '../../libs/theme-variables';
import { commitValue } from './commit';
import { getCategoryLabel, getGroupLabel, qualifyLabel } from './messages';
import {
  buildSettingsRows,
  findSection,
  isFiltering,
  matchSettings,
  type SettingsRow,
  type SettingsTocGroup,
} from './rows';
import type { CommitHandler } from './setting-row';
import { SettingsList } from './settings-list';
import { SettingsSectionSelect, SettingsToc } from './settings-toc';
import { SettingsToolbar } from './settings-toolbar';

const CodeEditor = lazy(() => import('../code-editor'));

type Mode = 'gui' | 'css';

const PAGE_SIZE = 150;
const SEARCH_DEBOUNCE_MS = 200;

export interface ThemeCssEditorProps {
  css: string;
  /** Bundled CSS of the installed theme package, which sets the defaults. */
  themeCss?: string;
  /** Language of the document, for defaults declared under `:lang()`. */
  language?: string;
  onCssChange: (css: string) => void;
}

function Spinner() {
  return (
    <div className="grid place-items-center py-8">
      <Loader2 className="size-8 animate-spin text-gray-300" />
    </div>
  );
}

/** State that only holds for one filter; it resets when the filter changes. */
function useFilterScopedState<T>(filterKey: string, initial: () => T) {
  const [state, setState] = useState(() => ({
    key: filterKey,
    value: initial(),
  }));
  if (state.key !== filterKey) {
    setState({ key: filterKey, value: initial() });
  }
  const set = useCallback(
    (update: (value: T) => T) =>
      setState((prev) => ({
        key: filterKey,
        value: update(prev.key === filterKey ? prev.value : initial()),
      })),
    [filterKey, initial],
  );
  return [state.value, set] as const;
}

/** Rows shown per section, raised by "show more". */
type Limits = Readonly<Record<string, number>>;

const noLimits = (): Limits => ({});
// Views are keyed by strings, and `null` stands for every match.
const toListKey = (section: string | null) => section ?? '';
const fromListKey = (key: string) => (key === '' ? null : key);
const noSection = () => null;
const noDefaults = () => undefined;

function resolveSection(
  toc: readonly SettingsTocGroup[],
  requested: string | null,
  filtering: boolean,
): string | null {
  if (requested !== null && findSection(toc, requested)) {
    return requested;
  }
  // Only a filter narrows the list enough to show every section at once.
  return filtering ? null : (toc[0]?.key ?? null);
}

function useThemeSettings(
  schema: ThemeVariableSchema | undefined,
  model: ThemeCssModel | null,
  theme: ThemeDeclarations | undefined,
  language: string | undefined,
) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useDebounce(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS, [query]);
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scope, setScope] = useState<ThemeScopeId>(DEFAULT_THEME_SCOPE);

  const filter = useMemo(
    () => ({ query: debouncedQuery, modifiedOnly }),
    [debouncedQuery, modifiedOnly],
  );
  const filtering = isFiltering(filter);
  const filterKey = JSON.stringify([debouncedQuery, modifiedOnly, scope]);
  // The section picked while filtering is tracked apart, so that clearing the
  // filter returns to the section being browsed before.
  const [browseSection, setBrowseSection] = useState<string | null>(null);
  const [filterSection, setFilterSection] = useFilterScopedState<string | null>(
    filterKey,
    noSection,
  );

  const matches = useMemo(() => {
    if (!schema || !model) {
      return null;
    }
    const variables = model.scopes[scope].variables;
    return matchSettings({
      groups: schema.groups,
      scope,
      filter,
      isModified: (name) => Object.hasOwn(variables, name),
      showAdvanced,
      getGroupLabel,
      getCategoryLabel,
      qualifyLabel,
    });
  }, [schema, model, scope, filter, showAdvanced]);
  const toc = matches?.toc ?? [];
  const section = resolveSection(
    toc,
    filtering ? filterSection : browseSection,
    filtering,
  );
  // The list of a section takes a while to mount, so it renders in a
  // transition while the table of contents shows the pick right away.
  const [, startTransition] = useTransition();
  const [pickedSection, setPickedSection] = useOptimistic(section);

  const listKey = toListKey(section);
  const prerender = usePrerender(listKey, { resetKey: filterKey });
  const [limits, setLimits] = useFilterScopedState(filterKey, noLimits);
  // Rebuilt per section only when its matches or limit change, so that the
  // hidden lists keep their rows and skip re-rendering.
  const rowsCache = useMemo(() => new Map<string, SettingsRow[]>(), [matches]);
  const getRows = (key: string) => {
    if (!matches) {
      return [];
    }
    const limit = limits[key] ?? PAGE_SIZE;
    const cacheKey = `${key}\n${limit}`;
    let rows = rowsCache.get(cacheKey);
    if (!rows) {
      rows = buildSettingsRows(matches, fromListKey(key), limit);
      rowsCache.set(cacheKey, rows);
    }
    return rows;
  };
  const rows = getRows(listKey);

  const scopeCounts = useMemo(
    () =>
      Object.fromEntries(
        THEME_SCOPES.map(({ id }) => [
          id,
          Object.keys(model?.scopes[id].variables ?? {}).filter(
            (name) => !schema || schema.byName.has(name),
          ).length,
        ]),
      ) as Record<ThemeScopeId, number>,
    [model, schema],
  );

  const getDefaultValue = useMemo(
    () =>
      schema
        ? resolveThemeDefaults({ schema, theme, language, scope })
        : noDefaults,
    [schema, theme, language, scope],
  );

  const handleQueryChange = useCallback((next: string, immediate = false) => {
    setQuery(next);
    if (immediate) {
      setDebouncedQuery(next);
    }
  }, []);

  const handleSelect = useCallback(
    (next: string | null) =>
      startTransition(() => {
        setPickedSection(next);
        if (filtering) {
          setFilterSection(() => next);
        } else {
          setBrowseSection(next);
        }
      }),
    [filtering, setFilterSection, setPickedSection],
  );

  const handleShowMore = useCallback(
    () =>
      startTransition(() =>
        setLimits((prev) => ({
          ...prev,
          [listKey]: (prev[listKey] ?? PAGE_SIZE) + PAGE_SIZE,
        })),
      ),
    [listKey, setLimits],
  );

  const { triggerProps } = prerender;
  const getPrerenderProps = useCallback(
    (next: string | null) => triggerProps(toListKey(next)),
    [triggerProps],
  );

  const matchCount = matches?.matchCount ?? 0;
  return {
    toolbar: {
      query,
      onQueryChange: handleQueryChange,
      scope,
      onScopeChange: setScope,
      scopeCounts,
      modifiedOnly,
      onModifiedOnlyChange: setModifiedOnly,
      showAdvanced,
      onShowAdvancedChange: setShowAdvanced,
      matchCount: filtering ? matchCount : null,
    },
    listSection: section,
    toc: {
      toc,
      section: pickedSection,
      filtering,
      matchCount,
      onSelect: handleSelect,
      getPrerenderProps,
    },
    lists: { current: listKey, keys: prerender.keys, getRows },
    list: {
      rows,
      scope,
      getDefaultValue,
      onShowMore: handleShowMore,
      onSwitchScope: setScope,
    },
  };
}

/**
 * Edits one stylesheet either through the theme variables or as CSS text. The
 * text is the only state: the settings are parsed from it and every change
 * is a minimal patch of it, so both views always agree.
 */
export default function ThemeCssEditor({
  css,
  themeCss,
  language,
  onCssChange,
}: ThemeCssEditorProps) {
  const [mode, setMode] = useState<Mode>('gui');
  const guiPanelRef = useRef<HTMLDivElement>(null);
  const switchMode = (next: Mode) => {
    // Radix activates a tab on mousedown and unmounts the inactive panel right
    // away, before a focused field gets the blur that commits its draft.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      guiPanelRef.current?.contains(active)
    ) {
      active.blur();
    }
    setMode(next);
  };
  const cssRef = useRef(css);
  const onCssChangeRef = useRef(onCssChange);
  useLayoutEffect(() => {
    cssRef.current = css;
    onCssChangeRef.current = onCssChange;
  });

  // Stable, so that CodeEditor does not rebuild its view on every render, and
  // reading the ref keeps back-to-back commits from patching stale text.
  const emit = useCallback((next: string) => {
    if (next !== cssRef.current) {
      cssRef.current = next;
      onCssChangeRef.current(next);
    }
  }, []);

  const handleCommit = useCallback<CommitHandler>(
    (scope, name, descriptor, value) => {
      const result = commitValue(cssRef.current, {
        scope,
        name,
        descriptor,
        value,
      });
      if (!result.ok) {
        return result.error;
      }
      emit(result.css);
      return null;
    },
    [emit],
  );

  const [schemaPromise, setSchemaPromise] = useState(loadThemeVariableSchema);
  const { state: schemaState, value: schema } = usePromiseState(schemaPromise);
  // Not parsed while the CSS editor is open, as it would run per keystroke.
  const model = useMemo(
    () => (mode === 'gui' ? parseThemeCss(css) : null),
    [css, mode],
  );
  // A bundle runs to hundreds of KB, so it is scanned in a deferred render;
  // the documented defaults show until then.
  const deferredThemeCss = useDeferredValue(themeCss ?? null, null);
  const theme = useMemo(
    () =>
      deferredThemeCss === null
        ? undefined
        : scanThemeDeclarations(deferredThemeCss),
    [deferredThemeCss],
  );
  const settings = useThemeSettings(schema, model, theme, language);

  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (!root || !header) {
      return;
    }
    const observer = new ResizeObserver(() => {
      root.style.setProperty(
        '--settings-header-height',
        `${header.offsetHeight}px`,
      );
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // The pane keeps its scroll position, which would open the new section
  // midway once the list top has scrolled under the header.
  const revealList = useCallback(() => {
    const list = listRef.current;
    const header = headerRef.current;
    if (
      list &&
      header &&
      list.getBoundingClientRect().top < header.getBoundingClientRect().bottom
    ) {
      list.scrollIntoView({ block: 'start' });
    }
  }, []);
  const revealPendingRef = useRef(false);
  const listSectionRef = useRef(settings.listSection);
  const onSelectRef = useRef(settings.toc.onSelect);
  useLayoutEffect(() => {
    listSectionRef.current = settings.listSection;
    onSelectRef.current = settings.toc.onSelect;
  });
  // Stable, so that a pick does not re-render the whole table of contents.
  const handleSelect = useCallback(
    (section: string | null) => {
      if (section === listSectionRef.current) {
        revealList();
        return;
      }
      revealPendingRef.current = true;
      onSelectRef.current(section);
    },
    [revealList],
  );
  const { rows } = settings.list;
  // Waits for the rows of the picked section, which come in a transition.
  useLayoutEffect(() => {
    if (revealPendingRef.current) {
      revealPendingRef.current = false;
      revealList();
    }
  }, [rows, revealList]);
  const toc = { ...settings.toc, onSelect: handleSelect };

  return (
    <Tabs
      ref={rootRef}
      className="@container"
      value={mode}
      onValueChange={(value) => switchMode(value as Mode)}
    >
      <div
        ref={headerRef}
        className="sticky top-0 z-10 grid gap-2 bg-background py-2"
      >
        <TabsList aria-label={m.theme_settings_mode_aria()} className="w-full">
          <TabsTrigger value="gui">
            <SlidersHorizontal aria-hidden />
            {m.theme_settings_mode_gui()}
          </TabsTrigger>
          <TabsTrigger value="css">
            <Code aria-hidden />
            {m.theme_settings_mode_css()}
          </TabsTrigger>
        </TabsList>
        {mode === 'gui' && schemaState === Fulfilled && (
          <>
            <SettingsToolbar {...settings.toolbar} />
            {model && <SettingsSectionSelect {...toc} className="@md:hidden" />}
          </>
        )}
      </div>
      <TabsContent ref={guiPanelRef} value="gui" className="grid gap-2">
        {model && model.diagnostics.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-destructive/50 p-3 text-sm"
          >
            <TriangleAlert
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            <div className="grid flex-1 justify-items-start gap-2">
              <p>{m.theme_settings_css_broken()}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => switchMode('css')}
              >
                {m.theme_settings_open_css_editor()}
              </Button>
            </div>
          </div>
        )}
        {schemaState === Fulfilled && model ? (
          <div className="grid items-start gap-x-4 @md:grid-cols-[10rem_minmax(0,1fr)] @3xl:grid-cols-[14rem_minmax(0,1fr)]">
            <SettingsToc
              {...toc}
              className="sticky top-(--settings-header-height) hidden max-h-[calc(100svh-var(--settings-header-height))] overflow-y-auto overscroll-contain scrollbar-stable py-2 @md:block"
            />
            <div
              ref={listRef}
              className="min-w-0 scroll-mt-(--settings-header-height) py-2"
            >
              <PrerenderedViews
                current={settings.lists.current}
                keys={settings.lists.keys}
              >
                {(key) => (
                  <SettingsList
                    {...settings.list}
                    rows={settings.lists.getRows(key)}
                    model={model}
                    onCommit={handleCommit}
                    onSelectSection={handleSelect}
                  />
                )}
              </PrerenderedViews>
            </div>
          </div>
        ) : schemaState === Rejected ? (
          <div className="grid justify-items-start gap-2 py-4 text-sm">
            <p role="alert">{m.theme_settings_load_error()}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSchemaPromise(loadThemeVariableSchema())}
            >
              {m.theme_settings_retry()}
            </Button>
          </div>
        ) : (
          <div role="status" aria-label={m.theme_settings_loading()}>
            <Spinner />
          </div>
        )}
      </TabsContent>
      <TabsContent value="css">
        <Suspense fallback={<Spinner />}>
          <CodeEditor
            aria-label={m.theme_custom_css_editor_aria()}
            code={css}
            onCodeUpdate={emit}
          />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
