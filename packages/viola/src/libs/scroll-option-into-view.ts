// Unlike Element.scrollIntoView, never scrolls the listbox's own scroll
// ancestors, such as the editor pane behind a popover.
export function scrollOptionIntoView(
  listbox: HTMLElement,
  option: HTMLElement,
): void {
  const top = listbox.getBoundingClientRect().top + listbox.clientTop;
  const bottom = top + listbox.clientHeight;
  const rect = option.getBoundingClientRect();
  if (rect.top < top) {
    listbox.scrollTop -= top - rect.top;
  } else if (rect.bottom > bottom) {
    listbox.scrollTop += rect.bottom - bottom;
  }
}
