import type { EditorMenuCommand, EditorMenuRunContext } from './types';

const commands = new Map<string, EditorMenuCommand>();
const groupLabels = new Map<string, () => string>();

/** Re-registering an id replaces the previous command (keeps HMR working). */
export function registerEditorMenuCommand(command: EditorMenuCommand): void {
  commands.set(command.id, command);
}

export function getEditorMenuCommand(
  id: string,
): EditorMenuCommand | undefined {
  return commands.get(id);
}

export function registerEditorMenuGroupLabel(
  id: string,
  label: () => string,
): void {
  groupLabels.set(id, label);
}

export function getEditorMenuGroupLabel(
  id: string,
): (() => string) | undefined {
  return groupLabels.get(id);
}

export function runEditorMenuCommand(
  command: EditorMenuCommand,
  ctx: EditorMenuRunContext,
): void {
  const report = (error: unknown) =>
    console.error(`[editor-menu] Command "${command.id}" failed`, error);
  // Called synchronously so commands that open a file picker keep the user
  // activation of the triggering click or key press.
  try {
    Promise.resolve(command.run?.(ctx)).catch(report);
  } catch (error) {
    report(error);
  }
}
