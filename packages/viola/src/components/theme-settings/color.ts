const HEX = /^#(?:([\da-f])([\da-f])([\da-f])|([\da-f]{6}))$/i;

/** `#rgb` / `#rrggbb` as the `#rrggbb` that `<input type="color">` takes. */
export function parseHexColor(value: string): string | null {
  const match = value.trim().match(HEX);
  if (!match) {
    return null;
  }
  const [, r, g, b, full] = match;
  return `#${full ?? `${r}${r}${g}${g}${b}${b}`}`.toLowerCase();
}

let context: CanvasRenderingContext2D | null | undefined;

/**
 * The opaque color `value` names, as `#rrggbb`. Named and functional colors
 * are resolved by a canvas, which leaves `fillStyle` alone for anything it
 * cannot parse; two different sentinels tell that apart from a real match.
 */
export function toPickerColor(value: string): string | null {
  const hex = parseHexColor(value);
  if (hex || typeof document === 'undefined') {
    return hex;
  }
  const text = value.trim();
  // These resolve against the canvas element, not against the document.
  if (text === '' || /var\(|currentcolor|inherit|initial|unset/i.test(text)) {
    return null;
  }
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) {
    return null;
  }
  const resolve = (sentinel: string) => {
    const ctx = context as CanvasRenderingContext2D;
    ctx.fillStyle = sentinel;
    ctx.fillStyle = text;
    return String(ctx.fillStyle);
  };
  const resolved = resolve('#010203');
  return resolved === resolve('#030201') && /^#[\da-f]{6}$/.test(resolved)
    ? resolved
    : null;
}
