import { m } from '../generated/paraglide/messages';
import type { OfficialThemePackageName } from '../stores/catalog';

const officialThemeTitleMessages: Record<
  OfficialThemePackageName,
  () => string
> = {
  '@vivliostyle/theme-base': m.theme_official_base,
  '@vivliostyle/theme-techbook': m.theme_official_techbook,
  '@vivliostyle/theme-academic': m.theme_official_academic,
  '@vivliostyle/theme-bunko': m.theme_official_bunko,
  '@vivliostyle/theme-gutenberg': m.theme_official_gutenberg,
  '@vivliostyle/theme-slide': m.theme_official_slide,
};

export function getOfficialThemeTitle(
  packageName: string,
  fallback: string,
): string {
  const getMessage =
    officialThemeTitleMessages[packageName as OfficialThemePackageName];
  return getMessage ? getMessage() : fallback;
}
