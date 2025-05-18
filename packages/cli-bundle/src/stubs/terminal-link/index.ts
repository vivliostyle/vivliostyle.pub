export default (
  text: string,
  _url: string,
  _options?: {
    readonly fallback?: ((text: string, url: string) => string) | boolean;
  },
): string => text;
