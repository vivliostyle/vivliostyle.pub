import { useEffect, useState } from 'react';

export const Pending = Symbol('pending');
export const Fulfilled = Symbol('fulfilled');
export const Rejected = Symbol('rejected');

export function usePromiseState<T>(promise?: Promise<T>) {
  const [state, setState] = useState<
    typeof Pending | typeof Fulfilled | typeof Rejected
  >(Pending);
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    promise?.then(
      (result) => {
        setValue(result);
        setState(Fulfilled);
      },
      (err) => {
        setError(err);
        setState(Rejected);
      },
    );
    return () => {
      setState(Pending);
      setValue(undefined);
      setError(undefined);
    };
  }, [promise]);
  return { state, value, error };
}
