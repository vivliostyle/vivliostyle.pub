export {
  THEME_VARIABLE_CATEGORIES,
  type ThemeVariableCategory,
} from './categories';
export {
  parseThemeCss,
  removeVariable,
  setVariable,
  ThemeCssEditError,
  type ThemeCssEditErrorCode,
  type ThemeCssModel,
  type ThemeCssScope,
  type ThemeCssVariable,
} from './css-model';
export type { CssDiagnostic, CssDiagnosticCode } from './css-scanner';
export {
  resolveThemeDefaults,
  scanThemeDeclarations,
  type ThemeDeclarations,
  type ThemeDefaultsOptions,
} from './defaults';
export {
  buildThemeVariableSchema,
  flattenThemeVariables,
  getThemeVariableName,
  groupThemeVariables,
  loadThemeVariableSchema,
  type ThemeVariable,
  type ThemeVariableDefault,
  type ThemeVariableGroup,
  type ThemeVariableSchema,
  type ThemeVariableSubgroup,
  type ThemeVariableSubgroupRef,
} from './schema';
export {
  DEFAULT_THEME_SCOPE,
  getThemeScope,
  isVariableGroupInScope,
  THEME_SCOPES,
  type ThemeScope,
  type ThemeScopeId,
} from './scopes';
export { isFoldedModule } from './subjects';
export {
  CSS_DATA_TYPES,
  type CssDataType,
  describeVariable,
  parseSyntax,
  type ValueDescriptor,
  type ValueInputKind,
  type ValueMultiplier,
  type ValueType,
} from './syntax';
export {
  CSS_WIDE_KEYWORDS,
  type Dimension,
  getDescriptorUnits,
  getUnits,
  joinDimension,
  splitDimension,
  type ValueValidationReason,
  type ValueValidationResult,
  validateValue,
} from './validate';
