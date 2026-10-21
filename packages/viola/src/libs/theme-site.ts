// theme.vivliostyle.org: the theme catalog and its selection mode, which Pub
// embeds in the theme browser pane. The protocol is specified in
// https://github.com/vivliostyle/theme.vivliostyle.org/blob/main/docs/selection-protocol.md

export const themeSiteOrigin = new URL(
  import.meta.env.VITE_THEME_SITE_URL || 'https://theme.vivliostyle.org',
).origin;

export const PICKER_PROTOCOL = 1;

export function pickerUrl(locale: string): string {
  const lang = locale.startsWith('ja') ? 'ja' : 'en';
  return `${themeSiteOrigin}/${lang}/select?client=pub&v=${PICKER_PROTOCOL}`;
}

export type PickerMessage =
  | { type: 'vivliostyle-theme-picker:ready'; protocol: 1 }
  | {
      type: 'vivliostyle-theme-picker:select';
      protocol: 1;
      theme: { name: string; version: string };
      template?: { id: string };
    }
  | { type: 'vivliostyle-theme-picker:cancel'; protocol: 1 };

export interface PickerInitMessage {
  type: 'vivliostyle-theme-picker:init';
  protocol: 1;
  locale: 'en' | 'ja';
  allowTemplate: boolean;
  current?: string;
}

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?$/;

/** Validates a message from the picker; anything else is ignored. */
export function parsePickerMessage(data: unknown): PickerMessage | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const message = data as Record<string, unknown>;
  if (message.protocol !== PICKER_PROTOCOL) {
    return undefined;
  }
  switch (message.type) {
    case 'vivliostyle-theme-picker:ready':
    case 'vivliostyle-theme-picker:cancel':
      return { type: message.type, protocol: PICKER_PROTOCOL };
    case 'vivliostyle-theme-picker:select': {
      const theme = message.theme as Record<string, unknown> | undefined;
      const template = message.template as Record<string, unknown> | undefined;
      if (
        typeof theme?.name !== 'string' ||
        !PACKAGE_NAME.test(theme.name) ||
        typeof theme.version !== 'string' ||
        !VERSION.test(theme.version) ||
        (template !== undefined &&
          (typeof template.id !== 'string' || !template.id))
      ) {
        return undefined;
      }
      return {
        type: message.type,
        protocol: PICKER_PROTOCOL,
        theme: { name: theme.name, version: theme.version },
        ...(template && { template: { id: template.id as string } }),
      };
    }
    default:
      return undefined;
  }
}

export interface CatalogTheme {
  name: string;
  version: string;
  title: string;
  description: string;
  official: boolean;
  thumbnail: string | null;
}

let catalogPromise: Promise<CatalogTheme[]> | undefined;

/** Official themes of the catalog, cached for the session. */
export function fetchOfficialThemes(): Promise<CatalogTheme[]> {
  catalogPromise ??= fetch(`${themeSiteOrigin}/api/v1/themes?source=official`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Theme catalog: ${response.status}`);
      }
      return response.json() as Promise<{ themes: CatalogTheme[] }>;
    })
    .then(({ themes }) => themes)
    .catch((error) => {
      catalogPromise = undefined;
      throw error;
    });
  return catalogPromise;
}

/**
 * Picks the files of a template whose `source` is a directory inside the theme
 * package (`./...`), from the package files keyed by
 * `node_modules/<name>/<path>`. Returns undefined for other sources.
 */
export function extractTemplateFiles(
  files: Map<string, Uint8Array>,
  packageName: string,
  source: string,
): Record<string, Uint8Array> | undefined {
  if (!source.startsWith('./') && !source.startsWith('../')) {
    return undefined;
  }
  const segments: string[] = [];
  for (const segment of source.split('/')) {
    if (segment === '..') {
      if (segments.length === 0) {
        throw new Error(`The template is outside of the package: ${source}`);
      }
      segments.pop();
    } else if (segment && segment !== '.') {
      segments.push(segment);
    }
  }
  const prefix = `${['node_modules', packageName, ...segments].join('/')}/`;
  const result: Record<string, Uint8Array> = {};
  for (const [path, data] of files) {
    if (path.startsWith(prefix)) {
      result[path.slice(prefix.length)] = data;
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`The template is not found in the package: ${source}`);
  }
  return result;
}

/**
 * Whether the first entry of `theme` in vivliostyle.config.json names a
 * package, as opposed to a local stylesheet.
 */
export function isThemePackageSpecifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !/^(?:\.|\/|[a-z][a-z0-9+.-]*:)/i.test(value) &&
    !value.endsWith('.css')
  );
}
