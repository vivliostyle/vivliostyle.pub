// Long enough for a cold start, where the worker compiles every manuscript
// and core fetches remote fonts before the first page.
export const defaultStallTimeout = 30_000;
