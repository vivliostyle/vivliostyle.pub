/**
 * The element id a link in a page points at. Core rewrites links between the
 * publication's documents to bare fragments naming ids it writes into pages;
 * any other link has nowhere to go inside the stage.
 */
export function linkFragment(href: string): string | null {
  const trimmed = href.trim();
  return trimmed.length > 1 && trimmed.startsWith('#')
    ? trimmed.slice(1)
    : null;
}
