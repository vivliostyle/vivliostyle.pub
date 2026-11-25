// What github-slugger 2, which VFM gives headings their ids with, leaves of
// text: letters, marks, decimal and letter numbers, connector punctuation,
// the circled and squared Latin letters, spaces and hyphens.
// TODO: use github-slugger itself once it is a dependency of the package.
const REMOVED = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}Ⓐ-ⓩ🄰-🅉🅐-🅩🅰-🆉 -]/gu;

// github-slugger goes by Unicode 13, so it drops the letters, marks and
// numbers assigned since, up to Unicode 17, which these ranges list.
const ADDED_SINCE =
  '870-887 889-88f 897-89f 8b5 8c8-8d2 c3c c5c-c5d cdc-cdd cf3 ece 170d 1715 171f 180f 1ac1-1add 1ae0-1aeb 1b4c 1c89-1c8a 1dfa 2c2f 2c5f 9ffd-9fff a7c0-a7c1 a7cb-a7dc a7f1-a7f4 10570-1057a 1057c-1058a 1058c-10592 10594-10595 10597-105a1 105a3-105b1 105b3-105b9 105bb-105bc 105c0-105f3 10780-10785 10787-107b0 107b2-107ba 10940-10959 10d40-10d65 10d69-10d6d 10d6f-10d85 10ec2-10ec7 10efa-10eff 10f70-10f85 11070-11075 110c2 1123f-11241 11380-11389 1138b 1138e 11390-113b5 113b7-113c0 113c2 113c5 113c7-113ca 113cc-113d3 113e1-113e2 116d0-116e3 11740-11746 11ab0-11abf 11b60-11b67 11bc0-11be0 11bf0-11bf9 11db0-11ddb 11de0-11de9 11f00-11f10 11f12-11f3a 11f3e-11f42 11f50-11f5a 12f90-12ff0 1342f 13440-13455 13460-143fa 16100-16139 16a70-16abe 16ac0-16ac9 16d40-16d6c 16d70-16d79 16ea0-16eb8 16ebb-16ed3 16ff2-16ff6 187f8-187ff 18cff 18d09-18d1e 18d80-18df2 1aff0-1aff3 1aff5-1affb 1affd-1affe 1b11f-1b122 1b132 1b155 1ccf0-1ccf9 1cf00-1cf2d 1cf30-1cf46 1df00-1df1e 1df25-1df2a 1e030-1e06d 1e08f 1e290-1e2ae 1e4d0-1e4f9 1e5d0-1e5fa 1e6c0-1e6de 1e6e0-1e6f5 1e6fe-1e6ff 1e7e0-1e7e6 1e7e8-1e7eb 1e7ed-1e7ee 1e7f0-1e7fe 2a6de-2a6df 2b735-2b73f 2cea2-2cead 2ebf0-2ee5d 31350-33479';

const ADDED = new RegExp(
  `[${ADDED_SINCE.split(' ')
    .map((range) =>
      range
        .split('-')
        .map((hex) => `\\u{${hex}}`)
        .join('-'),
    )
    .join('')}]`,
  'gu',
);

/** A heading's text as an id, as github-slugger makes one. */
export function slug(text: string, keepCase = false): string {
  return (keepCase ? text : text.toLowerCase())
    .replace(REMOVED, '')
    .replace(ADDED, '')
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
