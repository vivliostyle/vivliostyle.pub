import { useMemo, useRef, useState } from 'react';

import { CROSS_REFERENCE } from '@v/tiptap-extensions';
import { Input } from '@v/ui/input';
import { m } from '../../../generated/paraglide/messages';
import {
  canRefer,
  type ReferenceTarget,
  referenceTargets,
  referTo,
  selectedReference,
} from '../../../libs/editor/cross-reference';
import type { EditorMenuPanelProps } from '../../../libs/editor/menu/types';
import { styledReferenceTypes } from '../../../libs/editor/styled-elements';
import { NativeSelect } from '../../theme-settings/native-select';
import { dismissPanel, PanelForm } from './panel-form';

const TYPE_LABELS: Record<string, () => string> = {
  sec: m.cross_reference_panel_type_sec,
  fig: m.cross_reference_panel_type_fig,
  tbl: m.cross_reference_panel_type_tbl,
  lst: m.cross_reference_panel_type_lst,
  eq: m.cross_reference_panel_type_eq,
  thm: m.cross_reference_panel_type_thm,
  sidenote: m.cross_reference_panel_type_sidenote,
  cite: m.cross_reference_panel_type_cite,
  appendix: m.cross_reference_panel_type_appendix,
  page: m.cross_reference_panel_type_page,
};
const TYPE_ORDER = Object.keys(TYPE_LABELS);

const typeLabel = (type: string) => TYPE_LABELS[type]?.() ?? type;

/**
 * Inserts a reference to an element of the document, or one written by
 * hand such as to another file, or changes the selected reference.
 */
export function CrossReferencePanel({ editor, close }: EditorMenuPanelProps) {
  const hrefRef = useRef<HTMLInputElement>(null);
  const [reference] = useState(() => selectedReference(editor));
  const types = useMemo(() => {
    const supported = [...styledReferenceTypes(editor)];
    const own = String(reference?.attrs['data-ref'] ?? '');
    if (own && !supported.includes(own)) {
      supported.push(own);
    }
    return supported.sort(
      (a, b) =>
        (TYPE_ORDER.indexOf(a) + 1 || TYPE_ORDER.length + 1) -
        (TYPE_ORDER.indexOf(b) + 1 || TYPE_ORDER.length + 1),
    );
  }, [editor, reference]);
  // A reference of a type the theme has no rule for shows nothing; one to
  // a page can point at anything.
  const options = useMemo(() => {
    const targets = referenceTargets(editor.state.doc).filter((target) =>
      canRefer(editor, target),
    );
    return types.flatMap((group) =>
      targets
        .filter((target) => group === 'page' || target.type === group)
        .map((target) => ({ target, type: group })),
    );
  }, [editor, types]);
  const [type, setType] = useState(
    () => String(reference?.attrs['data-ref'] ?? '') || types[0] || 'sec',
  );
  const [href, setHref] = useState(() => String(reference?.attrs.href ?? ''));
  const [optionIndex, setOptionIndex] = useState(-1);
  const [invalid, setInvalid] = useState(false);

  const target = options[optionIndex]?.target;
  const hrefOf = (it: ReferenceTarget) => (it.id ? `#${it.id}` : '');

  const apply = () => {
    if (target && href === hrefOf(target)) {
      if (!referTo(editor, target, type)) {
        setInvalid(true);
        return;
      }
      close();
      return;
    }
    if (
      reference &&
      href === reference.attrs.href &&
      type === reference.attrs['data-ref']
    ) {
      dismissPanel({ editor, close });
      return;
    }
    if (!href.trim()) {
      setInvalid(true);
      return;
    }
    const done = editor
      .chain()
      .focus()
      .setHtmlElement(CROSS_REFERENCE, { 'data-ref': type, href: href.trim() })
      .run();
    if (!done) {
      setInvalid(true);
      return;
    }
    close();
  };

  return (
    <PanelForm
      editor={editor}
      close={close}
      initialFocusRef={hrefRef}
      submitLabel={m.cross_reference_panel_apply_aria()}
      onSubmit={apply}
      error={invalid && m.cross_reference_panel_invalid()}
    >
      <div className="flex flex-col gap-1">
        {options.length === 0 ? (
          <p className="w-72 px-1 text-xs text-muted-foreground">
            {m.cross_reference_panel_no_targets()}
          </p>
        ) : (
          <NativeSelect
            aria-label={m.cross_reference_panel_target_aria()}
            value={optionIndex}
            className="h-7 w-72"
            onChange={(event) => {
              const index = Number(event.target.value);
              const picked = options[index];
              setOptionIndex(index);
              setInvalid(false);
              if (picked) {
                setType(picked.type);
                setHref(hrefOf(picked.target));
              }
            }}
          >
            <option value={-1}>
              {m.cross_reference_panel_target_placeholder()}
            </option>
            {types.map((group) => {
              const grouped = options
                .map((it, index) => ({ ...it, index }))
                .filter((it) => it.type === group);
              return (
                grouped.length > 0 && (
                  <optgroup key={group} label={typeLabel(group)}>
                    {grouped.map(({ target: it, index }) => (
                      <option key={`${group}:${it.pos}`} value={index}>
                        {it.id
                          ? `${it.label} (#${it.id})`
                          : m.cross_reference_panel_new_id({
                              label: it.label,
                            })}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </NativeSelect>
        )}
        <div className="flex gap-1">
          <NativeSelect
            aria-label={m.cross_reference_panel_type_aria()}
            value={type}
            className="h-7 w-28"
            onChange={(event) => setType(event.target.value)}
          >
            {types.map((it) => (
              <option key={it} value={it}>
                {typeLabel(it)}
              </option>
            ))}
          </NativeSelect>
          <Input
            ref={hrefRef}
            value={href}
            placeholder={
              target && !target.id
                ? m.cross_reference_panel_href_new_placeholder()
                : m.cross_reference_panel_href_placeholder()
            }
            aria-label={m.cross_reference_panel_href_aria()}
            aria-invalid={invalid}
            spellCheck={false}
            className="h-7 w-44 font-mono"
            onChange={(event) => {
              setHref(event.target.value);
              setInvalid(false);
            }}
          />
        </div>
      </div>
    </PanelForm>
  );
}
