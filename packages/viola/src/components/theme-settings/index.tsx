import {
  lazy,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDebounce } from 'react-use';

import { Button } from '@v/ui/button';
import { Code, Loader2, SlidersHorizontal, TriangleAlert } from '@v/ui/icon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@v/ui/tabs';
import { m } from '../../generated/paraglide/messages';
import {
  Fulfilled,
  Rejected,
  usePromiseState,
} from '../../hooks/use-promise-state';
import {
  DEFAULT_THEME_SCOPE,
  loadThemeVariableSchema,
  parseThemeCss,
  THEME_SCOPES,
  type ThemeCssModel,
  type ThemeScopeId,
  type ThemeVariableSchema,
} from '../../libs/theme-variables';
import { commitValue } from './commit';
import { getGroupLabel } from './messages';
import { buildSettingsRows, groupKey, isFiltering } from './rows';
import type { CommitHandler } from './setting-row';
import { SettingsList } from './settings-list';
import { SettingsToolbar } from './settings-toolbar';

const CodeEditor = lazy(() => import('../code-editor'));

type Mode = 'gui' | 'css';

const PAGE_SIZE = 150;
const SEARCH_DEBOUNCE_MS = 200;

export interface ThemeCssEditorProps {
  css: string;
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

const emptySet = () => new Set<string>();
const pageSize = () => PAGE_SIZE;

function toggle(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(key)) {
    next.add(key);
  }
  return next;
}

function useThemeSettings(
  schema: ThemeVariableSchema | undefined,
  model: ThemeCssModel | null,
) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useDebounce(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS, [query]);
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const [scope, setScope] = useState<ThemeScopeId>(DEFAULT_THEME_SCOPE);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(emptySet);

  const filter = useMemo(
    () => ({ query: debouncedQuery, modifiedOnly }),
    [debouncedQuery, modifiedOnly],
  );
  const filtering = isFiltering(filter);
  const filterKey = JSON.stringify([debouncedQuery, modifiedOnly, scope]);
  // While filtering every match shows; what the user collapses then is
  // tracked apart so that clearing the filter restores the previous tree.
  const [collapsedInFilter, setCollapsedInFilter] = useFilterScopedState<
    ReadonlySet<string>
  >(filterKey, emptySet);
  const [limit, setLimit] = useFilterScopedState(filterKey, pageSize);

  const result = useMemo(() => {
    if (!schema || !model) {
      return null;
    }
    const variables = model.scopes[scope].variables;
    return buildSettingsRows({
      groups: schema.groups,
      scope,
      filter,
      isModified: (name) => Object.hasOwn(variables, name),
      isExpanded: (key) =>
        filtering ? !collapsedInFilter.has(key) : expanded.has(key),
      limit,
      getGroupLabel,
    });
  }, [
    schema,
    model,
    scope,
    filter,
    filtering,
    collapsedInFilter,
    expanded,
    limit,
  ]);

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

  const handleQueryChange = useCallback((next: string, immediate = false) => {
    setQuery(next);
    if (immediate) {
      setDebouncedQuery(next);
    }
  }, []);

  const handleToggle = useCallback(
    (key: string) => {
      if (filtering) {
        setCollapsedInFilter((set) => toggle(set, key));
      } else {
        setExpanded((set) => toggle(set, key));
      }
    },
    [filtering, setCollapsedInFilter],
  );

  const handleCollapseAll = useCallback(() => {
    setExpanded(emptySet());
    setCollapsedInFilter(
      () => new Set(schema?.groups.map((group) => groupKey(group.id))),
    );
  }, [schema, setCollapsedInFilter]);

  const handleShowMore = useCallback(
    () => setLimit((value) => value + PAGE_SIZE),
    [setLimit],
  );

  return {
    toolbar: {
      query,
      onQueryChange: handleQueryChange,
      scope,
      onScopeChange: setScope,
      scopeCounts,
      modifiedOnly,
      onModifiedOnlyChange: setModifiedOnly,
      matchCount: filtering && result ? result.matchCount : null,
      onCollapseAll: handleCollapseAll,
    },
    list: {
      rows: result?.rows ?? [],
      scope,
      onToggle: handleToggle,
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
  onCssChange,
}: ThemeCssEditorProps) {
  const [mode, setMode] = useState<Mode>('gui');
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
  const settings = useThemeSettings(schema, model);

  return (
    <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
      <div className="sticky top-0 z-10 grid gap-2 bg-background py-2">
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
          <SettingsToolbar {...settings.toolbar} />
        )}
      </div>
      <TabsContent value="gui" className="grid gap-2">
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
                onClick={() => setMode('css')}
              >
                {m.theme_settings_open_css_editor()}
              </Button>
            </div>
          </div>
        )}
        {schemaState === Fulfilled && model ? (
          <SettingsList
            {...settings.list}
            model={model}
            onCommit={handleCommit}
          />
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
