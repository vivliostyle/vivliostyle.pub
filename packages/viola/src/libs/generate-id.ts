import { customAlphabet, urlAlphabet } from 'nanoid';
import { alphanumeric } from 'nanoid-dictionary';

const nanoid = customAlphabet(urlAlphabet);

export function generateId<T extends string>(): T {
  return nanoid() as T;
}

// `projectId` is used in the sandbox iframe subdomain as `sandbox-${projectId}`.
// Keep it safe for use inside a single DNS label: lowercase letters, digits,
// and interior `-` are valid, while characters such as `_`, uppercase, and
// other non-DNS-label characters can cause Chromium to drop
// `cross-origin-isolated`, breaking `SharedArrayBuffer` in the CLI worker.
// We intentionally generate the stricter lowercase-alphanumeric subset here
// for maximum compatibility.
// Length 25 keeps ~129 bits of entropy against this 36-char alphabet
// (≥ nanoid's default ~126).
const projectIdNanoid = customAlphabet(
  'abcdefghijklmnopqrstuvwxyz0123456789',
  25,
);

export function generateProjectId<T extends string>(): T {
  return projectIdNanoid() as T;
}

const getRandomAlphanumeric = customAlphabet(alphanumeric);

export function generateRandomName(): string {
  return getRandomAlphanumeric(8);
}
