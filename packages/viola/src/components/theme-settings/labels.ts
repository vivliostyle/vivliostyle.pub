import { m } from '../../generated/paraglide/messages';
import { isFoldedModule, type ThemeVariable } from '../../libs/theme-variables';
import { getGroupLabel, humanizeKey } from './messages';
import { TARGET_LABELS } from './vocabulary';

export function findTargetLabel(
  group: string,
  target: string,
): string | undefined {
  return (
    TARGET_LABELS.get(`${group}/${target}`) ?? TARGET_LABELS.get(target)
  )?.();
}

export function getTargetLabel(group: string, target: string): string {
  return findTargetLabel(group, target) ?? humanizeKey(target);
}

export function getVariableLabel(
  variable: Pick<
    ThemeVariable,
    'group' | 'target' | 'propertyKey' | 'subgroup'
  >,
): string {
  const { group, target, propertyKey, subgroup } = variable;
  const detail = (text: string) =>
    m.theme_settings_label_with_detail({ label: propertyKey, detail: text });
  // A folded module shares the subgroup of an element, whose heading names
  // neither the module nor its target.
  if (isFoldedModule(group)) {
    return detail(
      target === null ? getGroupLabel(group) : getTargetLabel(group, target),
    );
  }
  // The heading of the subgroup names the target, unless the variable joined
  // the subgroup from a target of its own.
  if (
    target === null ||
    (subgroup.kind === 'target' && subgroup.id === target)
  ) {
    return propertyKey;
  }
  return detail(getTargetLabel(group, target));
}
