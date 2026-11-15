// Side-effect module: Safari lacks Symbol.dispose / Symbol.asyncDispose.
// @vivliostyle/cli keys its disposables with the bare well-known symbols, but
// its oxc-lowered `using` blocks (_usingCtx) look them up via a Symbol.for
// fallback; aliasing both to Symbol.for keeps the keys and lookups in sync.
const symbolCtor = Symbol as { dispose?: symbol; asyncDispose?: symbol };
symbolCtor.dispose ??= Symbol.for('Symbol.dispose');
symbolCtor.asyncDispose ??= Symbol.for('Symbol.asyncDispose');
