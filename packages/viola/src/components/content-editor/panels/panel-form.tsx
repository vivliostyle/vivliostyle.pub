import type React from 'react';
import { type ReactNode, type RefObject, useEffect, useState } from 'react';

import { Button, type ButtonProps } from '@v/ui/button';
import { CheckIcon } from '@v/ui/icon';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';

export function dismissPanel({ editor, close }: EditorMenuPanelProps) {
  close();
  editor.commands.focus();
}

export function PanelButton({
  label,
  type = 'button',
  ...props
}: Omit<
  ButtonProps,
  'size' | 'variant' | 'className' | 'aria-label' | 'title'
> & { label: string }) {
  return (
    <Button
      type={type}
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      aria-label={label}
      title={label}
      {...props}
    />
  );
}

export interface PanelFormProps extends EditorMenuPanelProps {
  /** Focused on mount. */
  initialFocusRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Selected in that field on mount, instead of its whole value. */
  initialSelection?: { from: number; to: number };
  submitLabel: string;
  onSubmit: () => void;
  /** Buttons placed after the submit button. */
  actions?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

export function PanelForm({
  editor,
  close,
  initialFocusRef,
  initialSelection,
  submitLabel,
  onSubmit,
  actions,
  error,
  children,
}: PanelFormProps) {
  const [selection] = useState(initialSelection);

  useEffect(() => {
    const field = initialFocusRef.current;
    if (!field) {
      return;
    }
    // The panel can mount before its popover is positioned, when scrolling to
    // the field would jump the editor pane.
    field.focus({ preventScroll: true });
    field.setSelectionRange(
      selection?.from ?? 0,
      selection?.to ?? field.value.length,
    );
  }, [initialFocusRef, selection]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dismissPanel({ editor, close });
  };

  return (
    <div className="flex flex-col gap-1">
      <form
        className="flex items-start gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={handleKeyDown}
      >
        {children}
        <PanelButton type="submit" label={submitLabel}>
          <CheckIcon />
        </PanelButton>
        {actions}
      </form>
      {error && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
