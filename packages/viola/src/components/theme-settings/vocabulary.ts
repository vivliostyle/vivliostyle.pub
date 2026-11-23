import { m } from '../../generated/paraglide/messages';

const tag = (name: string) => `<${name}>`;

const tags = (...names: string[]) =>
  names
    .map(tag)
    .reduce((first, second) =>
      m.theme_settings_target_pattern_pair({ first, second }),
    );

const inside = (ancestor: string, element: string) => () =>
  m.theme_settings_target_pattern_inside({
    ancestor: tag(ancestor),
    element: tag(element),
  });

const LEVELS = [1, 2, 3, 4, 5, 6];

/**
 * Targets, keyed by `<group>/<target>`, or by the target alone for the parts
 * that modules share, like `call`. Keying element tags by their group keeps a
 * module target like the `anchor` of endnotes from reading as every `<a>`.
 */
export const TARGET_LABELS: ReadonlyMap<string, () => string> = new Map<
  string,
  () => string
>([
  ['_basic/anchor', () => tag('a')],
  ['_basic/big', () => tag('big')],
  ['_basic/blockquote', () => tag('blockquote')],
  ['_basic/blockquote-p', inside('blockquote', 'p')],
  ['_basic/bold', () => tags('b', 'strong')],
  ['_basic/bold-emphasis', m.theme_settings_target_bold_emphasis],
  ['_basic/caption', () => tag('caption')],
  ['_basic/cite', () => tag('cite')],
  ['_basic/crossref-call', m.theme_settings_target_crossref_call],
  ['_basic/dd', () => tag('dd')],
  ['_basic/del', () => tag('del')],
  ['_basic/dl', () => tag('dl')],
  ['_basic/dt', () => tag('dt')],
  ['_basic/dt-dd', () => tags('dt', 'dd')],
  ['_basic/emphasis', () => tag('em')],
  ['_basic/figcaption', () => tag('figcaption')],
  ['_basic/figcaption-p', inside('figcaption', 'p')],
  ['_basic/figure', () => tag('figure')],
  [
    '_basic/figure-item',
    () => m.theme_settings_target_pattern_images_in({ element: tag('figure') }),
  ],
  ['_basic/figure-table', inside('figure', 'table')],
  ...LEVELS.map((level): [string, () => string] => [
    `_basic/h${level}`,
    () => tag(`h${level}`),
  ]),
  [
    '_basic/heading',
    () =>
      m.theme_settings_target_pattern_range({
        first: tag('h1'),
        last: tag('h6'),
      }),
  ],
  ['_basic/hr', () => tag('hr')],
  ['_basic/img', () => tag('img')],
  ['_basic/li', () => tag('li')],
  // Description lists fall back to these as well.
  ['_basic/lists', () => tags('ul', 'ol', 'dl')],
  [
    '_basic/lists-marker',
    () => m.theme_settings_target_pattern_markers_of({ element: tag('li') }),
  ],
  ['_basic/monospace', () => tags('code', 'kbd', 'pre', 'samp')],
  ['_basic/ol', () => tag('ol')],
  ['_basic/p', () => tag('p')],
  [
    '_basic/p-first',
    () => m.theme_settings_target_pattern_first({ element: tag('p') }),
  ],
  ['_basic/pre', () => tag('pre')],
  ['_basic/rt', () => tag('rt')],
  ['_basic/ruby', () => tag('ruby')],
  ['_basic/small', () => tag('small')],
  ['_basic/sub', () => tag('sub')],
  ['_basic/sup', () => tag('sup')],
  ['_basic/table', () => tag('table')],
  ['_basic/table-cell', () => tags('th', 'td')],
  [
    '_basic/table-container',
    () =>
      m.theme_settings_target_pattern_container_of({ element: tag('table') }),
  ],
  ['_basic/table-row', () => tag('tr')],
  [
    '_basic/table-row-even',
    () => m.theme_settings_target_pattern_even({ element: tag('tr') }),
  ],
  [
    '_basic/table-row-odd',
    () => m.theme_settings_target_pattern_odd({ element: tag('tr') }),
  ],
  ['_basic/td', () => tag('td')],
  ['_basic/th', () => tag('th')],
  ['_basic/ul', () => tag('ul')],
  [
    '_meta-properties/document-first-page',
    m.theme_settings_target_document_first_page,
  ],
  ['_meta-properties/document-root', m.theme_settings_target_document_root],
  ['_meta-properties/first-page', m.theme_settings_target_first_page],
  ['call', m.theme_settings_target_call],
  ['marker', m.theme_settings_target_marker],
  ['root', m.theme_settings_target_root],
  ['citation/call', m.theme_settings_target_citation_call],
  ['citation/item', m.theme_settings_target_citation_item],
  ['citation/items', m.theme_settings_target_citation_items],
  ['footnote/call', m.theme_settings_target_note_call],
  ['endnote/call', m.theme_settings_target_note_call],
  ['sidenote/call', m.theme_settings_target_note_call],
  ['footnote/marker', m.theme_settings_target_note_marker],
  ['endnote/marker', m.theme_settings_target_note_marker],
  ['sidenote/marker', m.theme_settings_target_note_marker],
  ['footnote/item', m.theme_settings_target_footnote_item],
  ['footnote/area', m.theme_settings_target_footnote_area],
  ['footnote/area-before', m.theme_settings_target_footnote_area_before],
  ['endnote/anchor', m.theme_settings_target_endnote_anchor],
  ['endnote/backlink', m.theme_settings_target_endnote_backlink],
  ['endnote/call-sup', m.theme_settings_target_endnote_call_sup],
  ['endnote/item', m.theme_settings_target_endnote_item],
  ['endnote/section', m.theme_settings_target_endnote_section],
  ['endnote/section-heading', m.theme_settings_target_endnote_section_heading],
  ['endnote/section-hr', m.theme_settings_target_endnote_section_hr],
  ['endnote/section-ol', m.theme_settings_target_endnote_section_ol],
  ['equation/item', m.theme_settings_target_equation_item],
  ['math/display', m.theme_settings_target_math_display],
  ['page/call', m.theme_settings_target_page_call],
  ['page/doc', m.theme_settings_target_page_doc],
  ['section/call', m.theme_settings_target_section_call],
  ['section/marker', m.theme_settings_target_section_marker],
  ['section/root', m.theme_settings_target_section_root],
  ...LEVELS.flatMap((level): [string, () => string][] => [
    [
      `section/h${level}`,
      () =>
        m.theme_settings_target_pattern_section_of({
          element: tag(`h${level}`),
          section: tag('section'),
        }),
    ],
    [
      `section/h${level}-marker`,
      () =>
        m.theme_settings_target_pattern_numbers_of({
          element: tag(`h${level}`),
        }),
    ],
  ]),
  ['toc/anchor', m.theme_settings_target_toc_anchor],
  ['toc/page-counter', m.theme_settings_target_toc_page_counter],
  ['toc/page-leader', m.theme_settings_target_toc_page_leader],
  ['page/mbox', m.theme_settings_target_mbox],
  ['page/mbox-top', m.theme_settings_target_mbox_top],
  ['page/mbox-bottom', m.theme_settings_target_mbox_bottom],
  ['page/mbox-left', m.theme_settings_target_mbox_left],
  ['page/mbox-right', m.theme_settings_target_mbox_right],
  ['page/mbox-top-left', m.theme_settings_target_mbox_top_left],
  ['page/mbox-top-center', m.theme_settings_target_mbox_top_center],
  ['page/mbox-top-right', m.theme_settings_target_mbox_top_right],
  ['page/mbox-bottom-left', m.theme_settings_target_mbox_bottom_left],
  ['page/mbox-bottom-center', m.theme_settings_target_mbox_bottom_center],
  ['page/mbox-bottom-right', m.theme_settings_target_mbox_bottom_right],
  ['page/mbox-left-top', m.theme_settings_target_mbox_left_top],
  ['page/mbox-left-middle', m.theme_settings_target_mbox_left_middle],
  ['page/mbox-left-bottom', m.theme_settings_target_mbox_left_bottom],
  ['page/mbox-right-top', m.theme_settings_target_mbox_right_top],
  ['page/mbox-right-middle', m.theme_settings_target_mbox_right_middle],
  ['page/mbox-right-bottom', m.theme_settings_target_mbox_right_bottom],
  ['page/mbox-top-left-corner', m.theme_settings_target_mbox_top_left_corner],
  ['page/mbox-top-right-corner', m.theme_settings_target_mbox_top_right_corner],
  [
    'page/mbox-bottom-left-corner',
    m.theme_settings_target_mbox_bottom_left_corner,
  ],
  [
    'page/mbox-bottom-right-corner',
    m.theme_settings_target_mbox_bottom_right_corner,
  ],
  ['page/mbox-top-inner', m.theme_settings_target_mbox_top_inner],
  ['page/mbox-bottom-inner', m.theme_settings_target_mbox_bottom_inner],
  ['page/mbox-left-inner', m.theme_settings_target_mbox_left_inner],
  ['page/mbox-right-inner', m.theme_settings_target_mbox_right_inner],
  ['page/mbox-top-outside', m.theme_settings_target_mbox_top_outside],
  ['page/mbox-top-inside', m.theme_settings_target_mbox_top_inside],
  ['page/mbox-bottom-outside', m.theme_settings_target_mbox_bottom_outside],
  ['page/mbox-bottom-inside', m.theme_settings_target_mbox_bottom_inside],
  ['page/mbox-outside', m.theme_settings_target_mbox_outside],
  ['page/mbox-inside', m.theme_settings_target_mbox_inside],
  ['prism/block-code', m.theme_settings_target_prism_block_code],
  ['prism/inline-code', m.theme_settings_target_prism_inline_code],
  ['prism/atrule', m.theme_settings_target_prism_atrule],
  ['prism/attr-name', m.theme_settings_target_prism_attr_name],
  ['prism/attr-value', m.theme_settings_target_prism_attr_value],
  ['prism/boolean', m.theme_settings_target_prism_boolean],
  ['prism/builtin', m.theme_settings_target_prism_builtin],
  ['prism/cdata', m.theme_settings_target_prism_cdata],
  ['prism/char', m.theme_settings_target_prism_char],
  ['prism/class-name', m.theme_settings_target_prism_class_name],
  ['prism/comment', m.theme_settings_target_prism_comment],
  ['prism/constant', m.theme_settings_target_prism_constant],
  ['prism/deleted', m.theme_settings_target_prism_deleted],
  ['prism/doctype', m.theme_settings_target_prism_doctype],
  ['prism/entity', m.theme_settings_target_prism_entity],
  ['prism/function', m.theme_settings_target_prism_function],
  ['prism/important', m.theme_settings_target_prism_important],
  ['prism/inserted', m.theme_settings_target_prism_inserted],
  ['prism/keyword', m.theme_settings_target_prism_keyword],
  ['prism/namespace', m.theme_settings_target_prism_namespace],
  ['prism/number', m.theme_settings_target_prism_number],
  ['prism/operator', m.theme_settings_target_prism_operator],
  ['prism/prolog', m.theme_settings_target_prism_prolog],
  ['prism/property', m.theme_settings_target_prism_property],
  ['prism/punctuation', m.theme_settings_target_prism_punctuation],
  ['prism/regex', m.theme_settings_target_prism_regex],
  ['prism/selector', m.theme_settings_target_prism_selector],
  ['prism/string', m.theme_settings_target_prism_string],
  ['prism/symbol', m.theme_settings_target_prism_symbol],
  ['prism/tag', m.theme_settings_target_prism_tag],
  ['prism/url', m.theme_settings_target_prism_url],
  ['prism/variable', m.theme_settings_target_prism_variable],
]);
