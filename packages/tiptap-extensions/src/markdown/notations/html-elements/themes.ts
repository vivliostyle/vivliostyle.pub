import { declareNotation } from '../../declare';
import type { NotationDefinition } from '../../notation';

const ID = ['id'];

const span = (name: string, className: string) =>
  declareNotation({
    kind: 'htmlMark',
    name,
    version: 1,
    tag: 'span',
    classes: [className],
    keepOtherAttributes: true,
  });

const div = (name: string, className: string) =>
  declareNotation({
    kind: 'htmlBlock',
    name,
    version: 1,
    tag: 'div',
    classes: [className],
    capture: ID,
    keepOtherAttributes: true,
  });

const tcy = span('tcy', 'tcy');
const upright = span('upright', 'upright');

/**
 * Markup of particular themes, by theme, whose classes are not shared by
 * the others: those of a theme only mean something with it.
 */
export const themeElementNotations: Readonly<
  Record<string, NotationDefinition[]>
> = {
  '@vivliostyle/theme-bunko': [
    tcy,
    upright,
    span('sesame', 'sesame'),
    span('sesameDot', 'sesame_dot'),
  ],
  '@vivliostyle/theme-epub3j': [tcy, upright, span('emSesame', 'em-sesame')],
  '@vivliostyle/theme-academic': [div('frameBlock', 'frame')],
  // The boxes the manuscripts of Pub's templates show in their own CSS.
  template: [div('noteBlock', 'note'), div('warningBlock', 'warning')],
};

/** Every definition of `themeElementNotations`, each once. */
export function allThemeElementNotations(): NotationDefinition[] {
  return [...new Set(Object.values(themeElementNotations).flat())];
}
