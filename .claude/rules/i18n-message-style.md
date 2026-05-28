---
paths:
  - "packages/viola/messages/*.json"
---

# i18n message wording style

Per-locale wording rules for `@v/viola` i18n messages (`packages/viola/messages/{locale}.json`). When you add, edit, or machine-translate a message in a given locale, follow the rules in that locale's section. When you add a new locale, add a new section here.

This file complements — not replaces — the i18n process documented in `CLAUDE.md` (key naming, machine-translation workflow, Fink/Sherlock entry points). Naming and workflow live in `CLAUDE.md`; wording lives here.

## Universal rules

- Do not break ICU placeholders. Keep `{name}` / `{count, plural, ...}` exactly as written; do not translate placeholder names.
- Do not embed HTML or Markdown in message values. Decorate at the JSX call site, not inside the JSON string.
- Avoid leading or trailing whitespace unless the message is explicitly composed inline with surrounding JSX (and even then, prefer reordering over whitespace).
- Do not duplicate keys across contexts. The same English string often translates differently depending on context (see CLAUDE.md key-naming rules).
- **Keep keys sorted alphabetically** across every locale file. `$schema` stays first (it sorts before letters in ASCII), then all other keys in case-sensitive alphabetical order. When you add or rename a key, insert it at its sorted position rather than appending. A one-shot fix is `jq -S '.' messages/<locale>.json | sponge messages/<locale>.json` (or write to a temp file then `mv`).

## Japanese (`ja.json`)

### No space at half-width / full-width boundaries

Do not insert ASCII whitespace between full-width Japanese characters and adjacent half-width characters (Latin letters, digits, punctuation, ICU placeholder braces).

```jsonc
// Bad
"theme_install_other_section_title": "npm から他のテーマをインストール",
"theme_custom_css_section_title": "カスタム CSS を編集",
"account_password_min_chars_note": "8 文字以上で入力してください。",
"bibliography_toc_depth_level": "レベル {level}",

// Good
"theme_install_other_section_title": "npmから他のテーマをインストール",
"theme_custom_css_section_title": "カスタムCSSを編集",
"account_password_min_chars_note": "8文字以上で入力してください。",
"bibliography_toc_depth_level": "レベル{level}",
```

The same rule applies on either side of an ICU placeholder (`レベル {level}` is forbidden; `レベル{level}` is correct).

### Prefer full-width separators in Japanese sentences

Mechanically copying an English half-width `:` into a Japanese sentence forces a space after the colon, which then collides with the previous rule. Inside Japanese prose, prefer full-width punctuation (`：`, `？`, `！`, `「」`, `（）`, `。`, `、`).

```jsonc
// Bad: half-width colon + space collides with the following full-width character
"edit_pane_title_with_file": "コンテンツエディター: ファイル {filename}",
"side_menu_delete_project_confirm": "プロジェクト「{title}」を削除しますか? この操作は取り消せません。",

// Good: full-width colon and question mark
"edit_pane_title_with_file": "コンテンツエディター：ファイル{filename}",
"side_menu_delete_project_confirm": "プロジェクト「{title}」を削除しますか？　この操作は取り消せません。",
```

Exception: when a half-width colon is followed exclusively by half-width content (URLs, identifiers, `Error.message` strings, code values), the half-width form is fine.

```jsonc
"account_server_label": "サーバー:",        // followed by <code>{baseUrl}</code>
"theme_install_error": "エラー: {message}", // {message} is Error.message (usually ASCII)
```

### Insert a half-width space after `？` / `！` when more text follows

When a full-width question mark or exclamation mark is mid-string and more text follows in the same message, insert a single half-width ASCII space after the mark. This is an explicit, narrowly-scoped exception to the "no space at half-width / full-width boundaries" rule above: it applies **only** as a sentence-break marker after `？` / `！`, not to noun phrases or other constructions.

```jsonc
// Bad: no breathing room between sentences
"side_menu_delete_project_confirm": "プロジェクト「{title}」を削除しますか?この操作は取り消せません。",
// Bad: full-width space (U+3000) is too wide for a sentence break here
"side_menu_delete_project_confirm": "プロジェクト「{title}」を削除しますか？　この操作は取り消せません。",
// Good
"side_menu_delete_project_confirm": "プロジェクト「{title}」を削除しますか？ この操作は取り消せません。",
```

If `？` or `！` is the final character of the message, do not add a trailing space.

### Do not inherit English structure

When translating, do not preserve word ordering or whitespace that only made sense in English. The most common case is JSX-composed sentences where the English message keeps a leading or trailing space to glue to surrounding elements — Japanese should drop that whitespace and, if necessary, reorder.

```jsonc
// en.json — leading space glues onto a preceding <Link>
"start_sign_in_to_sync_suffix": " to sync projects with the cloud.",

// ja.json — Japanese has no inter-word space, so drop the leading space
"start_sign_in_to_sync_suffix": "するとプロジェクトをクラウドと同期できます。",
```

### Proper nouns and loan-word romanization

- Preserve the official casing of brand and technology names: `Vivliostyle`, `EPUB`, `PDF`, `npm`, `CSS`, `HTML`.
- Retain the trailing `ー` (chōonpu) on katakana loanwords following common UI convention: `エディター`, `サーバー`, `コンピューター` (not `エディタ` / `サーバ` / `コンピュータ`).

## Adding a new locale

When you add a new locale to `project.inlang/settings.json`, also add a `## <Language> (`<code>.json`)` section here covering at minimum:

- Whitespace and punctuation conventions where the language differs from English defaults.
- Mixed-script handling rules (CJK + Latin, RTL + LTR, etc.).
- Loanword / proper-noun normalization preferences.
- Any tone/register choice (formal vs. casual) the maintainers want enforced across messages.
