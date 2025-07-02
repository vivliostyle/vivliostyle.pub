import type { Checkbox } from '@v/ui/checkbox';
import type { Input } from '@v/ui/input';
import type { Select } from '@v/ui/select';
import type React from 'react';
import { useCallback, useState } from 'react';
import { useDebounce } from 'react-use';

export function useLiveInputField<T extends string | number>(
  initialValue: T | (() => T),
  {
    onSave,
  }: {
    onSave?: (value: T) => T | undefined | Promise<T | undefined>;
  } = {},
) {
  const [hasChanged, setHasChanged] = useState(false);
  const [value, setValue] = useState(initialValue);

  const save = useCallback(async () => {
    const savedValue = await onSave?.(value);
    if (savedValue !== undefined) {
      setValue(savedValue);
    }
    setHasChanged(false);
  }, [value, onSave]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value as T);
    setHasChanged(true);
  }, []);

  const onBlur = useCallback(() => {
    if (hasChanged) {
      save();
      setHasChanged(false);
    }
  }, [hasChanged, save]);

  useDebounce(
    () => {
      if (hasChanged) {
        save();
        setHasChanged(false);
      }
    },
    2000,
    [hasChanged],
  );

  return { value, onChange, onBlur } satisfies React.ComponentProps<
    typeof Input
  >;
}

export function useLiveCheckboxField<T extends boolean>(
  initialValue: T | (() => T),
  {
    onSave,
  }: {
    onSave?:
      | ((value: T) => void)
      | ((value: T) => T | undefined | Promise<T | undefined>);
  } = {},
) {
  const [value, setValue] = useState(initialValue);

  const onCheckedChange = useCallback(
    async (checked: T) => {
      const savedValue = await onSave?.(checked);
      setValue(savedValue !== undefined ? savedValue : checked);
    },
    [onSave],
  );

  return {
    checked: value,
    onCheckedChange,
  } satisfies React.ComponentProps<typeof Checkbox>;
}

export function useLiveSelectField<T extends string>(
  initialValue: T | (() => T),
  {
    onSave,
  }: {
    onSave?:
      | ((value: T) => void)
      | ((value: T) => T | undefined | Promise<T | undefined>);
  } = {},
) {
  const [value, setValue] = useState(initialValue);

  const onValueChange = useCallback(
    async (value: T) => {
      const savedValue = await onSave?.(value);
      setValue(savedValue !== undefined ? savedValue : value);
    },
    [onSave],
  );

  return { value, onValueChange } satisfies React.ComponentProps<typeof Select>;
}
