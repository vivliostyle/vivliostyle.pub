import { m } from '../../generated/paraglide/messages';
import type {
  ThemeScopeId,
  ThemeVariableCategory,
  ValueType,
} from '../../libs/theme-variables';
import type { CommitError } from './commit';
import { humanizeKey } from './labels';

const GROUP_LABELS: Record<string, () => string> = {
  '_meta-properties': m.theme_settings_group_meta,
  _basic: m.theme_settings_group_basic,
  page: m.theme_settings_group_page,
  appendix: m.theme_settings_group_appendix,
  citation: m.theme_settings_group_citation,
  endnote: m.theme_settings_group_endnote,
  equation: m.theme_settings_group_equation,
  figure: m.theme_settings_group_figure,
  footnote: m.theme_settings_group_footnote,
  listing: m.theme_settings_group_listing,
  math: m.theme_settings_group_math,
  prism: m.theme_settings_group_prism,
  section: m.theme_settings_group_section,
  sidenote: m.theme_settings_group_sidenote,
  table: m.theme_settings_group_table,
  theorem: m.theme_settings_group_theorem,
  toc: m.theme_settings_group_toc,
};

export function getGroupLabel(groupId: string): string {
  // A module added by a newer theme-base still gets a readable title.
  return GROUP_LABELS[groupId]?.() ?? humanizeKey(groupId.replace(/^_+/, ''));
}

const CATEGORY_LABELS: Record<ThemeVariableCategory, () => string> = {
  'page-setup': m.theme_settings_category_page_setup,
  font: m.theme_settings_category_font,
  spacing: m.theme_settings_category_spacing,
  alignment: m.theme_settings_category_alignment,
  'line-breaking': m.theme_settings_category_line_breaking,
  'writing-mode': m.theme_settings_category_writing_mode,
  decoration: m.theme_settings_category_decoration,
  color: m.theme_settings_category_color,
  margin: m.theme_settings_category_margin,
  border: m.theme_settings_category_border,
  layout: m.theme_settings_category_layout,
  visibility: m.theme_settings_category_visibility,
  fragmentation: m.theme_settings_category_fragmentation,
  columns: m.theme_settings_category_columns,
  'generated-content': m.theme_settings_category_generated_content,
  other: m.theme_settings_category_other,
};

export function getCategoryLabel(category: ThemeVariableCategory): string {
  return CATEGORY_LABELS[category]();
}

const SCOPE_LABELS: Record<ThemeScopeId, () => string> = {
  root: m.theme_settings_scope_root,
  page: m.theme_settings_scope_page,
  'page-left': m.theme_settings_scope_page_left,
  'page-right': m.theme_settings_scope_page_right,
  'page-first': m.theme_settings_scope_page_first,
  'print-root': m.theme_settings_scope_print_root,
  'screen-root': m.theme_settings_scope_screen_root,
};

export function getScopeLabel(scope: ThemeScopeId): string {
  return SCOPE_LABELS[scope]();
}

const ERROR_MESSAGES: Record<CommitError, () => string> = {
  empty: m.theme_settings_error_empty,
  malformed: m.theme_settings_error_malformed,
  'missing-unit': m.theme_settings_error_missing_unit,
  'unknown-unit': m.theme_settings_error_unknown_unit,
  'not-allowed': m.theme_settings_error_not_allowed,
  'invalid-name': m.theme_settings_error_invalid_name,
  'invalid-value': m.theme_settings_error_invalid_value,
  'unsafe-edit': m.theme_settings_error_unsafe_edit,
};

export function getCommitErrorMessage(error: CommitError): string {
  return ERROR_MESSAGES[error]();
}

const VALUE_TYPE_LABELS: Record<ValueType, () => string> = {
  length: m.theme_settings_info_type_length,
  percentage: m.theme_settings_info_type_percentage,
  'length-percentage': m.theme_settings_info_type_length_percentage,
  number: m.theme_settings_info_type_number,
  integer: m.theme_settings_info_type_integer,
  angle: m.theme_settings_info_type_angle,
  time: m.theme_settings_info_type_time,
  resolution: m.theme_settings_info_type_resolution,
  color: m.theme_settings_info_type_color,
  string: m.theme_settings_info_type_string,
  'custom-ident': m.theme_settings_info_type_custom_ident,
  'font-family': m.theme_settings_info_type_font_family,
};

export function getValueTypeLabel(type: ValueType): string {
  return VALUE_TYPE_LABELS[type]();
}
