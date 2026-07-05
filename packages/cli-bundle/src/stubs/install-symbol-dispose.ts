// Safari lacks Symbol.dispose/asyncDispose, and lowering `using` syntax
// (transform.target in rolldown.config.ts) is not enough: @vivliostyle/cli
// keys its disposables with the bare well-known symbols and its bundled
// __disposeResources helper throws when they're missing. Symbol.for matches
// the fallback in oxc's own _usingCtx helper.
const symbolCtor = Symbol as { dispose?: symbol; asyncDispose?: symbol };
symbolCtor.dispose ??= Symbol.for('Symbol.dispose');
symbolCtor.asyncDispose ??= Symbol.for('Symbol.asyncDispose');
