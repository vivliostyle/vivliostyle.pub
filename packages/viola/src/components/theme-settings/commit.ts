import {
  removeVariable,
  setVariable,
  ThemeCssEditError,
  type ThemeCssEditErrorCode,
  type ThemeScopeId,
  type ValueDescriptor,
  type ValueValidationReason,
  validateValue,
} from '../../libs/theme-variables';

export type CommitError = ValueValidationReason | ThemeCssEditErrorCode;

export type CommitResult =
  | { ok: true; css: string }
  | { ok: false; error: CommitError };

export interface CommitRequest {
  scope: ThemeScopeId;
  name: string;
  descriptor: ValueDescriptor;
  /** Empty unsets the variable. */
  value: string;
}

export function commitValue(
  css: string,
  { scope, name, descriptor, value }: CommitRequest,
): CommitResult {
  const text = value.trim();
  try {
    if (text === '') {
      return { ok: true, css: removeVariable(css, scope, name) };
    }
    const validation = validateValue(descriptor, text);
    if (!validation.valid) {
      return { ok: false, error: validation.reason };
    }
    return { ok: true, css: setVariable(css, scope, name, text) };
  } catch (error) {
    if (error instanceof ThemeCssEditError) {
      return { ok: false, error: error.code };
    }
    throw error;
  }
}
