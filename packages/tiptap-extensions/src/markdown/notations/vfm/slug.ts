// What github-slugger 2, which VFM gives headings their ids with, leaves of
// text: letters, marks, decimal and letter numbers, connector punctuation,
// the circled Latin letters, spaces and hyphens. It goes by an older Unicode
// version, so letters added since are kept here and dropped there.
// TODO: use github-slugger itself once it is a dependency of the package.
const REMOVED = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}Ⓐ-ⓩ -]/gu;

/** A heading's text as an id, as github-slugger makes one. */
export function slug(text: string, keepCase = false): string {
  return (keepCase ? text : text.toLowerCase())
    .replace(REMOVED, '')
    .replace(/ /g, '-');
}

/**
 * Hands out the ids of a document's headings in order, numbering repeats as
 * github-slugger does: `a`, `a-1`, `a-2`, skipping ids handed out already.
 */
export class Slugger {
  private readonly counts = new Map<string, number>();

  slug(text: string, keepCase = false): string {
    const base = slug(text, keepCase);
    let result = base;
    while (this.counts.has(result)) {
      const count = (this.counts.get(base) ?? 0) + 1;
      this.counts.set(base, count);
      result = `${base}-${count}`;
    }
    this.counts.set(result, 0);
    return result;
  }
}
