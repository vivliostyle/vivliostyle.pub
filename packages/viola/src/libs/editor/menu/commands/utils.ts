export function splitKeywords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
