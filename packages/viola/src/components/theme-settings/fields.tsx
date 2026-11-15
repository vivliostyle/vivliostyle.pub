import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import {
  getDescriptorUnits,
  type ValueDescriptor,
} from '../../libs/theme-variables';
import { toPickerColor } from './color';
import {
  composeDimension,
  decodeOption,
  encodeOption,
  type FieldOverride,
  type FieldShape,
  getDefaultUnit,
  getSelectedOption,
  parseFieldValue,
  resolveFieldView,
} from './field-state';
import { NativeSelect } from './native-select';
import { useDraft } from './use-draft';

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

function TextValueInput({
  value,
  onCommit,
  onRevert,
  suggestions = [],
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
  > & { suggestions?: readonly string[] }) {
  const [draft, setDraft] = useDraft(value);
  const listId = useId();
  const commit = (text: string) =>
    text.trim() === value.trim() ? onRevert() : onCommit(text);

  return (
    <>
      <Input
        {...aria}
        type="text"
        className={cn('h-8 font-mono text-xs md:text-xs', className)}
        value={draft}
        placeholder={placeholder}
        list={suggestions.length > 0 ? listId : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          // Picking a datalist suggestion is a choice, not typing.
          const { inputType } = event.nativeEvent as Partial<InputEvent>;
          if (
            suggestions.length > 0 &&
            (inputType === undefined || inputType === 'insertReplacementText')
          ) {
            commit(event.target.value);
          }
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (isComposing(event)) {
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(draft);
          } else if (event.key === 'Escape') {
            setDraft(value);
            onRevert();
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
 * Number + unit for dimensions and numbers, a select for keywords, and free
 * text behind "Custom value…" for anything the two cannot express.
 */
function KeywordUnitField(props: FieldProps) {
  const { value, descriptor, defaultValue, label, onCommit, onRevert } = props;
  const shape = useMemo<FieldShape>(
    () => ({
      keywords: descriptor.keywords,
      units: getDescriptorUnits(descriptor),
    }),
    [descriptor],
  );
  const defaultUnit = getDefaultUnit(shape, defaultValue);
  const [override, setOverride] = useState<FieldOverride>(null);
  const view = resolveFieldView(value, override, shape, defaultUnit);
  const committed = parseFieldValue(value, shape);
  const [number, setNumber] = useDraft(
    view.kind === 'dimension' ? view.number : '',
  );
  const defaultView = defaultValue
    ? parseFieldValue(defaultValue, shape)
    : null;

  const commitNumber = (unit: string) => {
    const next = composeDimension(number, unit);
    // Leaving the number empty must not drop a keyword or custom value.
    if (
      next === value.trim() ||
      (next === '' && committed.kind !== 'dimension')
    ) {
      onRevert();
    } else {
      onCommit(next);
    }
  };

  const handleSelect = (encoded: string) => {
    const option = decodeOption(encoded);
    switch (option.kind) {
      case 'default':
        setOverride(null);
        onCommit('');
        break;
      case 'keyword':
        setOverride(null);
        onCommit(option.keyword);
        break;
      case 'custom':
        setOverride({ kind: 'custom' });
        break;
      case 'unit':
        setOverride({ kind: 'dimension', unit: option.unit });
        if (number.trim() !== '') {
          commitNumber(option.unit);
        }
        break;
    }
  };

  return (
    <div className="flex gap-2">
      {view.kind === 'dimension' && (
        <Input
          {...fieldAria(props)}
          type="number"
          step="any"
          inputMode="decimal"
          className="h-8 w-28 font-mono text-xs md:text-xs"
          value={number}
          placeholder={
            defaultView?.kind === 'dimension' && defaultView.unit === view.unit
              ? defaultView.number
              : undefined
          }
          onChange={(event) => setNumber(event.target.value)}
          onBlur={() => commitNumber(view.unit)}
          onKeyDown={(event) => {
            if (isComposing(event)) {
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              commitNumber(view.unit);
            } else if (event.key === 'Escape') {
              setNumber(committed.kind === 'dimension' ? committed.number : '');
              onRevert();
            }
          }}
        />
      )}
      <NativeSelect
        {...(view.kind === 'dimension' || view.kind === 'custom'
          ? { 'aria-label': m.theme_settings_unit_aria({ name: label }) }
          : fieldAria(props))}
        className={cn(view.kind === 'custom' ? 'shrink-0' : 'flex-1')}
        value={encodeOption(getSelectedOption(view))}
        onChange={(event) => handleSelect(event.target.value)}
      >
        {shape.units.length === 0 && (
          <option value={encodeOption({ kind: 'default' })}>
            {defaultValue
              ? m.theme_settings_option_default_with_value({
                  value: defaultValue,
                })
              : m.theme_settings_option_default()}
          </option>
        )}
        {shape.units.length > 0 && (
          <optgroup label={m.theme_settings_option_group_units()}>
            {shape.units.map((unit) => (
              <option key={unit} value={encodeOption({ kind: 'unit', unit })}>
                {unit || m.theme_settings_unit_none()}
              </option>
            ))}
          </optgroup>
        )}
        {shape.keywords.length > 0 && (
          <optgroup label={m.theme_settings_option_group_keywords()}>
            {shape.keywords.map((keyword) => (
              <option
                key={keyword}
                value={encodeOption({ kind: 'keyword', keyword })}
              >
                {keyword}
              </option>
            ))}
          </optgroup>
        )}
        <option value={encodeOption({ kind: 'custom' })}>
          {m.theme_settings_option_custom()}
        </option>
      </NativeSelect>
      {view.kind === 'custom' && (
        <TextValueInput
          {...fieldAria(props)}
          className="flex-1"
          value={value}
          placeholder={defaultValue}
          suggestions={shape.keywords}
          onCommit={onCommit}
          onRevert={onRevert}
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
      return <KeywordUnitField {...props} />;
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
