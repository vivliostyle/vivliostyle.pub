# Editor bug hunt: brief for AI agents

You are a QA agent. Your job is to break the Markdown editor in
`@v/tiptap-extensions`: find inputs that make it lose text, change what a
manuscript means, rewrite lines nobody touched, refuse to save, throw, or
render markup that runs script. Report each bug as a JSON file that a program
can replay. Work like a hostile tester: assume the editor has bugs, and hunt
for them on purpose instead of confirming that it works.

Read this whole brief before you start. The section *Rules of engagement* is
binding.

## 1. What this exercise is

- **Authorised, defensive QA.** The maintainers of this repository commissioned
  this work on their own code. "Adversarial" means *adversarial test inputs*:
  odd text, edge-case key sequences, conflicting commands, malformed markup.
  These are the same inputs fuzzers and property tests use. Nothing here
  attacks a system, a person or a service.
- **It all runs locally.** Every probe runs in a headless ProseMirror/TipTap
  editor in a local Node process, inside the agent sandbox. The harness
  makes no network calls, has no users or credentials, and touches no
  deployment. Breaking the editor here harms nothing. It is the point.
- **Security findings are in scope as detections.** One oracle checks whether
  the editor's own DOM would carry script-capable markup (event-handler
  attributes, `javascript:` URLs, `<script>`/`<iframe>`). The editor renders
  on the app's origin, so such markup is a defect. When the oracle fires,
  that is the whole proof. Do not build exploit chains or payloads that do
  anything, and do not try them against any running site.

## 2. Rules of engagement

Allowed:

- Read anything in the repository except `secrets/`.
- Write files under `packages/tiptap-extensions/bug-hunt/work/`, which git
  ignores. Put probes, generators, logs and findings there.
- Run `pnpm bug-hunt …` from `packages/tiptap-extensions`. You may also run
  that package's tests (`pnpm --filter @v/tiptap-extensions test`) and its
  typecheck.
- Write probe generators (Node or Python scripts) under `bug-hunt/work/`. Run
  them with plain interpreters, and pass input paths as arguments.

Not allowed:

- Do not change `src/`, `testing/`, `tests/` or the harness while hunting. A
  hunter reports bugs and does not fix them. If you think the harness is
  wrong, record it as a harness issue (see §7).
- Do not disable, bypass or widen the sandbox. Do not read `secrets/`. Make
  no network calls: the hunt needs none, so do not run `pnpm install` or
  fetch packages either. Start no dev servers or browsers, and never probe
  `*.vivliostyle.pub`, `vspub.dev` or PR previews.
- Do not commit, push, or open issues or PRs unless the operator asks.
- Do not loosen or reinterpret an expectation to make a finding fit. Do not
  invent evidence. Every claim in a finding must come from a harness verdict,
  a VFM rendering, or a file in the repo.
- Keep the load bounded. Run large batches with `--timeout` (§4.2). Stop a
  generator once it keeps producing the same fingerprint group.

If a rule blocks legitimate work, stop and tell the operator. Do not work
around it.

## 3. The system under test

Read these first:

- The root `CLAUDE.md`, the `@v/tiptap-extensions` section and *Editor
  behaviour tests*. It states the guarantees you are attacking.
- `testing/` (the case framework, the headless driver, the saving-property
  checks and the independent read-back judge) and `tests/cases/*.cases.ts`
  (pinned behaviour, including known failures marked `fails:`).
- `src/markdown/` (the reader and writer, notation definitions under
  `notations/`, the reuse of the baseline) and `src/markdown/notations/**`
  for the syntax each definition reads, writes and escapes.

How the editor works:

- A file is read into a ProseMirror document. Saving diffs the document
  against a **baseline** (the last saved markdown) and keeps the source of
  everything not edited, down to the character. After every save the result
  becomes the new baseline.
- Manuscripts are typeset by **VFM**. Markdown syntax is defined by
  *notation definitions*: CommonMark, GFM, VFM (ruby `{base|text}`, math
  `$…$`/`$$…$$`, footnotes `^[…]`/`[^1]`, attributes `{#id .c k=v}`,
  `[[toc]]`, section ends, code-fence titles), and HTML elements that themes
  style (`<span class="footnote">`, `<a data-ref>`, note and theorem blocks,
  figcaptions, `tcy`, sesame, and others). Syntax that no definition handles
  stays **raw markdown**.
- A document records which notations (and versions) it was made with, and is
  read and written with that set.

Guarantees, any of which is a bug when broken:

1. An unedited document saves byte for byte.
2. Editing a block changes only that block's lines. Inside an edited
   textblock, unchanged content keeps its source.
3. What is saved reads back as the same document (ignoring what markdown
   cannot hold: empty paragraphs, whitespace at the edges of emphasis, and
   bare URLs that GFM autolinks).
4. A save never gives up on the baseline (`generated` strategy).
5. When no markdown can hold the document, the save is refused instead of
   writing something that means something else. A state that ordinary
   typing or a command reaches, and that markdown cannot hold, is still a
   bug: commands and plugins are supposed to keep the document writable.
6. The editor never puts script-capable markup in its DOM.
7. Typing, key presses, input rules and commands keep the document valid,
   and do what a user would expect.
8. A document without a notation in its record does not gain that syntax.

## 4. The harness

Everything runs from `packages/tiptap-extensions`:

```sh
pnpm bug-hunt run <file|-> [--full] [--properties] [--timeout ms] [--out f]
pnpm bug-hunt minimize <file|-> [--oracle name] [--budget n]
pnpm bug-hunt verify [dir|files…] [--out report.json] [--expect-reproduced]
pnpm bug-hunt case <finding.json>
pnpm bug-hunt commands | notations | oracles
```

The formats are defined in `bug-hunt/schema.json`. Examples are in
`bug-hunt/examples/`.

### 4.1 Probes

A probe is a file as the editor opens it, plus what a user does to it:

```json
{
  "id": "p-0001",
  "given": "# 見出し\n\n本文‸です。\n",
  "steps": [
    "**太字**",
    { "kind": "press", "key": "Enter" },
    { "kind": "command", "name": "toggleBold", "returns": true },
    { "kind": "select", "text": "本文", "at": "range" },
    { "kind": "save" },
    { "kind": "reload" },
    { "kind": "recordNotations", "without": ["ruby"] }
  ],
  "expect": "# 見出し\n\n本文**太字**\n\n‸です。\n",
  "options": { "properties": true }
}
```

- `‸` (U+2038) in `given` marks the caret, and two of them mark a range. It
  cannot appear as content, so use another character to test punctuation.
  In `expect` it also checks the selection.
- Step kinds: a bare string (typed one character at a time through keymaps
  and input rules), `type`, `press` (TipTap notation: `Enter`, `Shift-Tab`,
  `Mod-b`, `Backspace`, `Delete`), `command` (any name from `pnpm bug-hunt
  commands`, with JSON `args`), `select` (`anchor`/`head` positions, `node`,
  `all`, or `text` with `nth` and `at`), `pasteText` (text inserted as a
  pasted transaction, so paste rules run), `pasteContent` (ProseMirror JSON
  nodes pasted over the selection), `save`, `reload` and
  `recordNotations`.
- A probe gets a final save after its steps in any case, just as the app's
  autosave would.
- `options.properties` also runs the slow saving-property checks on `given`
  and on the final save.
- Run many probes at once as a JSON array or as JSONL (one probe per line).

The headless driver cannot do what only a browser does: caret keys, the
browser's clipboard parsing, IME composition, drag and drop. Commands that
parse HTML or strings of content (`insertContent("<b>x</b>")`) or emit paste
events also need a DOM. Such probes come back `unsupported`. Simulate pastes
with `pasteText` and `pasteContent`, and pass JSON content to `insertContent`.
Content pasted from outside is supposed to become something the document's
notation set can write, so pasting nodes it lacks is a valid attack. Note
anything that needs a real browser in your session notes (§6.3).

### 4.2 Verdicts and oracles

`run` prints one verdict per probe: `status` (`clean`, `violations`,
`invalid-probe`, `unsupported`), `oracles`, `violations` (`oracle`, `step`,
`detail`; `--full` adds `actual`/`expected`), `signals`, `saved` and
`fingerprint`. With `--full` you also get `doc`, `savedWithSelection`,
`strategy`, a per-step `trace`, and `html.editor` / `html.vfm` (the editor's
DOM and VFM's rendering of the saved file).

| oracle | fires when | typical severity |
| --- | --- | --- |
| `step-threw` | a step or a check throws inside editor code | crash |
| `invalid-document` | the document breaks the schema after a step | corruption |
| `save-refused` | the writer finds no markdown that holds the document | save-blocked |
| `read-back` | the saved markdown reads back as a different document (the writer's own comparison) | data-loss |
| `judge` | an independent comparison, sharing no code with the writer, finds differences | data-loss |
| `baseline-given-up` | the save was written anew instead of reusing the baseline | corruption |
| `locality` | blocks unchanged at the start or end of the document lost their bytes | corruption |
| `unstable-save` | reopening the saved file and saving it unedited changes it | corruption |
| `properties` | a saving guarantee fails on `given` or on the save (with `options.properties`) | corruption |
| `unsafe-dom` | the editor's DOM would carry script-capable markup | security |
| `expectation` | the save, the selection, the doc or a command's result differs from what the probe expects | depends |
| `hang` | a probe outlives `--timeout` (only with `--timeout`) | crash |

`signals` are observations that need judging and are not bugs by
themselves. Examples: a `locality` change under the `repaired` strategy
(rewriting neighbours is an allowed repair), or read-back differences in a
document recorded with fewer notations (the checks read with the current
set).

`invalid-probe` means your probe is wrong: an unknown command, a position
out of range, or a malformed step. It says nothing about the editor. Fix the
probe. Note that a command called with arguments of the wrong type is a
probe error even when it then breaks something. Check the command's
signature in `src/` (search for `declare module '@tiptap/core'`) before you
blame the editor.

Always run large or generated batches with `--timeout 20000`, so that an
infinite loop becomes a `hang` verdict instead of a stuck process.

## 5. How to hunt

Spend most of your effort on objective oracles. Use `expectation` only where
the right answer can be shown (§5.1, §6.1).

### 5.1 Metamorphic relations (objective, no judgement needed)

The expected output follows from the input, so set `expect` mechanically:

- Type X, then Backspace → the file is byte-identical to `given`.
- Press Enter, then Backspace, at any position → identical.
- Toggle a mark (or a block format) twice over a selection → identical.
- Select a range, type its exact text back → identical.
- Undo all steps (`options.history`) → identical.
- Save, reload, save → identical (`unstable-save` already checks this).
- Edit block *k* only → every other block keeps its bytes (`locality` and
  `properties` check this).
- The same edit done by typing and by the equivalent command → the same
  file.

### 5.2 Exhaustive boundaries

For a small `given`, enumerate **every caret position and every range**, and
apply one step: Enter, Backspace, Delete, or typing one of
`* _ ~ \` $ { } | ^ [ ] ( ) < > & # ! \ - + = : "`, `「`, `」`, `、`, `。`,
U+3000 or a newline. Generate these probes with a script. Edges between a
mark and plain text, between a node and text, and at the start and end of
every block are where bugs live.

### 5.3 Grammar-based generation

Build documents from the fragment lists in `testing/markdown-properties.ts`
(`FRAGMENTS`, `VFM_FRAGMENTS`, `HTML_ELEMENT_FRAGMENTS`, the `*_INSERTS`), and
from the `given` of every case in `tests/cases/`. Then mutate them: splice
fragments into one another, nest them, and insert characters at token
boundaries. Use a seeded PRNG, and record the seed in the probe `id` so that
batches can be reproduced.

### 5.4 Attack surface catalogue

Assign yourself (or let the operator assign) a few areas, and go deep:

- **CJK and Unicode**: emphasis next to `「」『』（）、。！？` (VFM reads
  flanking differently from micromark), U+3000, surrogate pairs (𠮷),
  emoji ZWJ sequences, combining marks, variation selectors, ZWSP/ZWJ/BOM
  mid-text, U+2028/U+2029, NUL, bidi controls, NBSP, tabs.
- **Source shape**: CRLF, lone CR, mixed endings, BOM, frontmatter (and
  `---` that is not frontmatter), no trailing newline or many, trailing
  spaces and backslashes (hard breaks), very long lines, 1000-block
  documents.
- **Block structure**: lazy continuation, deeply nested lists and quotes,
  switching list markers (`-*+`, `1.`/`1)`), loose and tight lists,
  indented code versus list continuation, setext underlines, `- - -`, the
  seven kinds of HTML blocks, link reference definitions, GFM tables with
  pipes in code, and task lists.
- **Inline syntax**: `***`, intraword `_`, backtick runs, autolinks and bare
  URLs followed by punctuation or CJK, link destinations with parentheses,
  spaces or `<>`, entities (valid, invalid, numeric), inline HTML and
  comments.
- **VFM syntax**: ruby with pipes, escapes and marks in its base; math next
  to prices (`$5 and $10`); nested footnotes; footnote labels; attributes
  after headings, links, images and code; `[[toc]]`; section ends; code
  fence titles; and VFM's precedence of emphasis and links over later
  constructs.
- **HTML elements of themes**: upper-case tags, attribute order, duplicate
  attributes, entities in attributes, unclosed or mismatched tags, missing
  blank lines inside block elements, unknown extra attributes, classes in
  any order, and `on*`/`javascript:`/`srcdoc` anywhere (watch `unsafe-dom`).
- **Input rules and keymaps**: markdown shortcuts typed inside list items,
  quotes, footnotes, ruby, math, code, link text, headings and table cells;
  closing a delimiter next to CJK; Backspace right after an input rule fires
  (`undoInputRule`); Enter, Backspace and Delete at the boundary of every
  node type; `Shift-Enter`, `Tab`, `Shift-Tab` and `Mod-*` shortcuts.
- **Commands**: every command from `pnpm bug-hunt commands`, on empty,
  collapsed, cross-block, `all` and node selections; marks across raw
  markdown and atoms; `setRuby`/`setMath`/`setLink`/`setHeadingAttributes`/
  `setCodeBlockInfo`/`setHtmlElement` with hostile strings (quotes, braces,
  backticks, newlines, `|`, `$`, `javascript:`); and commands applied twice,
  then undone.
- **Notation records**: `recordNotations` without a notation, then typing,
  pasting (`pasteText`, `pasteContent`) or inserting its syntax and nodes,
  then saving.
- **Save sequences**: edit, save, edit, save, with `reload` in between;
  edit and revert; a long random walk with a save after every step.

### 5.5 Reading the code

Read the notation definitions and look for asymmetries between them: a
character the writer does not escape although the reader gives it meaning,
a writing style the reader does not accept, an attribute the parser keeps
but the writer drops, a plugin that fixes states only on some transaction
paths. Then write the probe that proves it. A hypothesis without a
reproducing probe is not a finding.

## 6. From violation to finding

### 6.1 Triage: is it a bug?

Report a violation only after checking:

1. **Reproducible.** It replays with `pnpm bug-hunt run`, and the status is
   `violations`, not `invalid-probe` or `unsupported`.
2. **Not a known limitation.** Search `tests/cases/*.cases.ts` for `fails:`
   reasons, and the difference list in `tests/vfm-html.test.ts`. If it is an
   instance of one, still report it, but fill `knownLimitation` and set the
   severity it deserves.
3. **Judged against VFM, not against micromark.** For meaning (emphasis,
   math, ruby, raw HTML), compare `html.vfm` with what the user sees in the
   editor (`doc`, `html.editor`). Put the rendering in
   `expected.evidence` as `{ "kind": "vfm-render", "markdown": …, "html": … }`.
4. **Reachable.** States reached by typing, key presses or commands with
   well-typed arguments rate higher than states reached only by inserting
   hand-built JSON. Rate a crash from a schema-invalid `insertContent` lowest.
5. **Not a duplicate.** Group by `oracle` + `area` + `hypothesis`. Report a
   new finding only when the probe exercises a different cause. Otherwise
   list it in `related`.

### 6.2 Minimize

Run `pnpm bug-hunt minimize probe.json --oracle <name>` for automatic
oracles. It drops steps, blocks and characters while the oracle still
fires. You cannot shrink `expectation` findings automatically, because the
expected output would have to shrink with them. Shrink those by hand, and
re-run after every cut. A finding's probe must be minimal: removing any
step, block or character should make it pass.

### 6.3 Write the finding

Write one file per bug, `bug-hunt/work/findings/<id>.json`, conforming to
`#/$defs/finding` in `schema.json`:

```json
{
  "schema": "vivliostyle-pub/editor-finding@1",
  "id": "F-<agent>-0001",
  "title": "Typing ** inside 「」 leaves escaped asterisks instead of bold",
  "oracle": "expectation",
  "severity": "wrong-result",
  "category": "input-rule",
  "probe": { "given": "「‸」\n", "steps": ["**太字**"] },
  "expected": {
    "markdown": "「**太字**‸」\n",
    "rationale": "Why that output is right, citing the guarantee in §3 or VFM's reading.",
    "evidence": [{ "kind": "vfm-render", "markdown": "…", "html": "…" }]
  },
  "area": { "notations": ["strong"], "files": ["src/markdown/notations/commonmark.ts"] },
  "knownLimitation": null,
  "confidence": "medium",
  "hypothesis": "The bold input rule does not fire where the closing delimiter is followed by CJK punctuation",
  "related": [],
  "found": { "by": "<agent name and model>", "commit": "<git sha>", "harnessVersion": 1, "fingerprint": "<from the verdict>" }
}
```

Rules:

- `probe.expect` stays out of the probe. The expectation is
  `expected.markdown`, and `verify` replays the probe against it. For
  automatic oracles, set `expected.markdown` to the correct save anyway
  (usually the save without the defect), because it becomes the case's
  `expect`.
- `title` is one English sentence about what the user experiences, and
  becomes the case name. `hypothesis` reads like a case's `fails` reason.
- Severity: `data-loss` (text or meaning disappears from the file),
  `corruption` (bytes change outside the edit, invalid documents, unstable
  saves), `crash` (throws or hangs), `save-blocked` (reachable states that
  cannot be saved), `security` (`unsafe-dom`), `wrong-result` (an input rule,
  key or command does the wrong thing but nothing is lost), `minor`
  (cosmetic source differences).
- `confidence`: `high` if an objective oracle fires or a metamorphic
  relation breaks; `medium` if it rests on VFM evidence; `low` if it rests
  on your reading of intent.

When you finish, also write:

- `bug-hunt/work/report.json`, from
  `pnpm bug-hunt verify --out bug-hunt/work/report.json`. Every finding must
  be `valid` and in state `reproduced`.
- `bug-hunt/work/session.json`:
  `{ "schema": "vivliostyle-pub/editor-bug-hunt-session@1", "agent": …,
  "commit": …, "areas": […], "probesRun": n, "seeds": […],
  "needsBrowser": [{ "probe": …, "why": … }], "harnessIssues": n }`.
- `bug-hunt/work/harness-issues.jsonl`, if any: one
  `{ "probe": …, "oracle": …, "why": … }` per line for verdicts you believe
  the harness gets wrong.

## 7. Downstream pipeline (for operators and fixing agents)

1. **Hunt.** One or more agents, each with its own areas and ID prefix,
   write `work/findings/*.json`.
2. **Gate.** `pnpm bug-hunt verify --expect-reproduced --out report.json`
   rejects invalid or non-reproducing findings, and marks duplicates by
   fingerprint.
3. **Triage.** Sort by severity, then confidence. A human decides on
   `expectation` findings that rest on intent.
4. **Pin.** `pnpm bug-hunt case <finding>` prints an editor case with
   `fails:` set. Add it to the fitting suite in `tests/cases/` (it must fail
   at first, as the root guide requires), and finish any `select` steps by
   hand.
5. **Fix.** A fixing agent changes `src/` until the case passes, then
   removes `fails`. It never changes the expected markdown to match the
   code.
6. **Close.** `verify` reports the finding as `fixed`. Re-run the hunter's
   batch to look for regressions.

## 8. Checklist before you stop

- [ ] Every finding replays: `verify` shows `valid: true` and `state: reproduced`.
- [ ] Every probe is minimal and has no `expect`. `expected.markdown` and
      `rationale` are filled in, with VFM evidence where meaning is involved.
- [ ] Known limitations are marked and duplicates are merged.
- [ ] You wrote nothing outside `bug-hunt/work/`.
- [ ] `session.json` lists the areas you covered, the seeds you used, and
      what needs a real browser.
