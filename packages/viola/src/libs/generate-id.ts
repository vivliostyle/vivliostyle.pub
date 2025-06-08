import { customAlphabet, urlAlphabet } from 'nanoid';
import { alphanumeric } from 'nanoid-dictionary';

const nanoid = customAlphabet(urlAlphabet);

export function generateId<T extends string>(): T {
  return nanoid() as T;
}

const getRandomAlphanumeric = customAlphabet(alphanumeric);

export function generateRandomName(): string {
  return getRandomAlphanumeric(8);
}
