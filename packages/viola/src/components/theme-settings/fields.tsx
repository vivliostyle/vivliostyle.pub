import { useEffect, useId, useMemo, useRef } from 'react';

import { ChevronDown } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import {
  getDescriptorUnits,
  type ValueDescriptor,
} from '../../libs/theme-variables';
import { toPickerColor } from './color';
import { completeUnits, getDefaultUnit } from './field-state';
import { useDraft } from './use-draft';
import { useNumberStepper } from './use-number-stepper';

export interface FieldProps {
  /** Value in the current scope; empty when unset. */
  value: string;
  descriptor: ValueDescriptor;
  defaultValue: string | undefined;
  label: string;
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  /** An empty value unsets the variable. */
  onCommit: (value: string) => void;
  /** Drops the error of a failed commit. */
  onRevert: () => void;
}

const GENERIC_FONT_FAMILIES = [
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'math',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
];

const COLOR_KEYWORDS = ['currentColor', 'transparent'];

const isComposing = (event: React.KeyboardEvent) =>
  event.nativeEvent.isComposing || event.keyCode === 229;

const asTyped = (text: string) => text;

function TextValueInput({
  value,
  onCommit,
  onRevert,
  suggestions = [],
  complete = asTyped,
  placeholder,
  className,
  ...aria
}: Pick<FieldProps, 'value' | 'onCommit' | 'onRevert'> &
  Pick<
    React.ComponentProps<'input'>,
    | 'placeholder'
    | 'className'
    | 'aria-label'
    | 'aria-labelledby'
    | 'aria-describedby'
    | 'aria-invalid'
  > & {
    suggestions?: readonly string[];
    /** Rewrites the text before it is committed and shown. */
    complete?: (text: string) => string;
  }) {
  const [draft, setDraft] = useDraft(value);
  const listId = useId();
  const stepper = useNumberStepper();
  const commit = (text: string) =>
    text.trim() === value.trim() ? onRevert() : onCommit(text);
  const commitDraft = (text: string) => {
    const completed = complete(text);
    if (completed !== text) {
      setDraft(completed);
    }
    commit(completed);
  };

  return (
    <>
      <Input
        {...aria}
        ref={stepper.ref}
        type="text"
        className={cn('h-8 font-mono text-xs md:text-xs', className)}
        value={draft}
        placeholder={placeholder}
        list={suggestions.length > 0 ? listId : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          stepper.reset();
          setDraft(event.target.value);
          // Picking a datalist suggestion is a choice, not typing.
          const { inputType } = event.nativeEvent as Partial<InputEvent>;
          if (
            suggestions.length > 0 &&
            (inputType === undefined || inputType === 'insertReplacementText')
          ) {
            commitDraft(event.target.value);
          }
        }}
        onBlur={() => {
          stepper.reset();
          commitDraft(draft);
        }}
        onKeyDown={(event) => {
          if (isComposing(event)) {
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            commitDraft(draft);
          } else if (event.key === 'Escape') {
            stepper.reset();
            setDraft(value);
            onRevert();
          } else {
            const stepped = stepper.step(event, {
              fallback: placeholder,
              complete,
            });
            if (stepped !== null) {
              setDraft(stepped);
              onCommit(stepped);
            }
          }
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
    </>
  );
}

function fieldAria({ labelId, describedBy, invalid }: FieldProps) {
  return {
    'aria-labelledby': labelId,
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
  };
}

/**
 * Lists the keywords one click away whatever the input holds, which a
 * datalist does not: it only offers what matches the text.
 */
function KeywordMenu({
  keywords,
  value,
  label,
  onPick,
}: {
  keywords: readonly string[];
  value: string;
  label: string;
  onPick: (keyword: string) => void;
}) {
  const text = value.trim().toLowerCase();
  const current = keywords.find((k) => k.toLowerCase() === text) ?? '';
  const name = m.theme_settings_keyword_menu_aria({ name: label });
  return (
    <div className="relative size-8 shrink-0">
      <select
        aria-label={name}
        title={name}
        className="peer absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
        value={current}
        onChange={(event) => onPick(event.target.value)}
      >
        {/* Selected while the value is no keyword, so that any pick is a change. */}
        <option value="" disabled hidden />
        {keywords.map((keyword) => (
          <option key={keyword} value={keyword}>
            {keyword}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none grid size-full place-items-center rounded-md border border-input text-muted-foreground peer-hover:bg-accent peer-hover:text-accent-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-ring"
      >
        <ChevronDown className="size-4" />
      </span>
    </div>
  );
}

function KeywordTextField(props: FieldProps) {
  const { value, descriptor, defaultValue, label, onCommit, onRevert } = props;
  const units = useMemo(() => getDescriptorUnits(descriptor), [descriptor]);
  const complete = (text: string) =>
    completeUnits(
      text,
      descriptor,
      getDefaultUnit(units, [text, value, defaultValue]),
    );

  return (
    <div className="flex gap-2">
      <TextValueInput
        {...fieldAria(props)}
        className="flex-1"
        value={value}
        placeholder={defaultValue}
        complete={complete}
        onCommit={onCommit}
        onRevert={onRevert}
      />
      {descriptor.keywords.length > 0 && (
        <KeywordMenu
          keywords={descriptor.keywords}
          value={value}
          label={label}
          onPick={onCommit}
        />
      )}
    </div>
  );
}

function ColorField(props: FieldProps) {
  const { value, descriptor, defaultValue, label, onCommit, onRevert } = props;
  const valueColor = useMemo(() => toPickerColor(value), [value]);
  const defaultColor = useMemo(
    () => (defaultValue ? toPickerColor(defaultValue) : null),
    [defaultValue],
  );
  const showsPicker = value.trim() === '' || valueColor !== null;
  const [pickerColor, setPickerColor] = useDraft(
    valueColor ?? defaultColor ?? '#000000',
  );
  const pickerRef = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });
  // React's onChange is the `input` event, which fires on every move of the
  // picker; `change` fires once the choice is made.
  useEffect(() => {
    const picker = pickerRef.current;
    if (!showsPicker || !picker) {
      return;
    }
    const handleChange = () => onCommitRef.current(picker.value);
    picker.addEventListener('change', handleChange);
    return () => picker.removeEventListener('change', handleChange);
  }, [showsPicker]);

  return (
    <div className="flex gap-2">
      {showsPicker && (
        <input
          ref={pickerRef}
          type="color"
          aria-label={m.theme_settings_color_picker_aria({ name: label })}
          className={cn(
            'h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            valueColor === null && 'opacity-50',
          )}
          value={pickerColor}
          onChange={(event) => setPickerColor(event.target.value)}
        />
      )}
      <TextValueInput
        {...fieldAria(props)}
        className="flex-1"
        value={value}
        placeholder={defaultValue}
        suggestions={[...COLOR_KEYWORDS, ...descriptor.keywords]}
        onCommit={onCommit}
        onRevert={onRevert}
      />
    </div>
  );
}

export function ValueField(props: FieldProps) {
  const { descriptor, defaultValue } = props;
  switch (descriptor.input) {
    case 'color':
      return <ColorField {...props} />;
    case 'select':
    case 'dimension':
    case 'number':
      return <KeywordTextField {...props} />;
    default:
      return (
        <TextValueInput
          {...fieldAria(props)}
          value={props.value}
          placeholder={defaultValue}
          suggestions={
            descriptor.input === 'font-family'
              ? [...descriptor.keywords, ...GENERIC_FONT_FAMILIES]
              : descriptor.keywords
          }
          onCommit={props.onCommit}
          onRevert={props.onRevert}
        />
      );
  }
}
