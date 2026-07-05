// Side-effect module: Safari doesn't implement Symbol.dispose /
// Symbol.asyncDispose. Lowering `using` syntax (transform.target in
// rolldown.config.ts) is not enough — @vivliostyle/cli's dist keys its
// disposables with the bare well-known symbols, and its bundled
// __disposeResources helper throws "Symbol.dispose is not defined" when they
// are missing. Symbol.for matches the fallback oxc's own _usingCtx helper
// uses, so lowered `using` blocks find the same symbol.
const symbolCtor = Symbol as { dispose?: symbol; asyncDispose?: symbol };
symbolCtor.dispose ??= Symbol.for('Symbol.dispose');
symbolCtor.asyncDispose ??= Symbol.for('Symbol.asyncDispose');
