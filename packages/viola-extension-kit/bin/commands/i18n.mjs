import {
  existsSync,
  mkdirSync,
  readdirSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { compile } from '@inlang/paraglide-js';

// Plugin modules are pinned to the same versions as `@v/viola`'s
// project.inlang/settings.json so every package compiles against one toolchain.
const modules = [
  'https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.4.0/dist/index.js',
  'https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2.2.6/dist/index.js',
];

export default async function i18n(args) {
  const { values } = parseArgs({
    args,
    options: { watch: { type: 'boolean', short: 'w' } },
  });

  const cwd = process.cwd();
  const messagesDir = join(cwd, 'messages');
  if (!existsSync(messagesDir)) {
    console.error(`[viola i18n] no messages/ directory at ${messagesDir}`);
    process.exit(1);
  }

  const projectDir = join(
    cwd,
    'node_modules/.cache/viola-extension-i18n/project.inlang',
  );
  const outdir = join(cwd, 'src/generated/paraglide');

  let previous;
  const build = async () => {
    const locales = readdirSync(messagesDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .sort();
    if (locales.length === 0) {
      throw new Error('no messages/<locale>.json files found');
    }
    const baseLocale = locales.includes('en') ? 'en' : locales[0];

    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'settings.json'),
      `${JSON.stringify(
        {
          $schema: 'https://inlang.com/schema/project-settings',
          baseLocale,
          locales,
          modules,
          'plugin.inlang.messageFormat': {
            pathPattern: join(messagesDir, '{locale}.json'),
          },
        },
        null,
        2,
      )}\n`,
    );

    previous = await compile({
      project: projectDir,
      outdir,
      strategy: ['baseLocale'],
      emitTsDeclarations: true,
      cleanOutdir: previous === undefined,
      previousCompilation: previous,
    });
  };

  if (!values.watch) {
    try {
      await build();
    } catch (error) {
      console.error(`[viola i18n] ${error.message}`);
      process.exit(1);
    }
    return;
  }

  const rebuild = () =>
    build()
      .then(() => console.log('[viola i18n] compiled messages'))
      .catch((error) => console.error(`[viola i18n] ${error.message}`));

  await rebuild();

  let timer;
  watch(messagesDir, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });
  console.log(`[viola i18n] watching ${messagesDir} for changes`);
}
