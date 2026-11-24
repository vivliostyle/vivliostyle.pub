import type React from 'react';
import { useId, useRef, useState } from 'react';

import { Checkbox } from '@v/ui/checkbox';
import { Label } from '@v/ui/label';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../../generated/paraglide/messages';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { isMathSource, selectedNodeOf } from '../../../libs/editor/vfm';
import { dismissPanel, PanelForm } from './panel-form';

export function MathPanel({ editor, close }: EditorMenuPanelProps) {
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const displayId = useId();
  const [math] = useState(() => selectedNodeOf(editor.state, 'math'));
  const [initial] = useState(() => ({
    latex: String(math?.attrs.latex ?? ''),
    display: Boolean(math?.attrs.display),
  }));
  const [display, setDisplay] = useState(initial.display);
  const [invalid, setInvalid] = useState(false);

  const apply = () => {
    const latex = sourceRef.current?.value ?? '';
    if (
      !latex ||
      (math && latex === initial.latex && display === initial.display)
    ) {
      dismissPanel({ editor, close });
      return;
    }
    if (!isMathSource(editor, latex, display)) {
      setInvalid(true);
      return;
    }
    editor.chain().focus().setMath({ latex, display }).run();
    close();
  };

  // Display math can span lines, so only Enter on its own submits.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={sourceRef}
      submitLabel={m.math_panel_apply_aria()}
      onSubmit={apply}
      error={invalid && m.math_panel_invalid_source()}
    >
      <div className="flex flex-col gap-1">
        <textarea
          ref={sourceRef}
          defaultValue={initial.latex}
          rows={initial.latex.includes('\n') ? 3 : 1}
          placeholder={m.math_panel_source_placeholder()}
          aria-label={m.math_panel_source_aria()}
          aria-invalid={invalid}
          spellCheck={false}
          className={cn(
            'w-72 resize-y rounded-md border border-input bg-transparent px-2 py-1 font-mono text-sm shadow-xs outline-none',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'aria-invalid:border-destructive',
          )}
          onChange={() => setInvalid(false)}
          onKeyDown={handleKeyDown}
        />
        <Label htmlFor={displayId} className="px-1 font-normal">
          <Checkbox
            id={displayId}
            checked={display}
            onCheckedChange={(checked) => {
              setDisplay(checked === true);
              setInvalid(false);
            }}
          />
          {m.math_panel_display_label()}
        </Label>
      </div>
    </PanelForm>
  );
}
