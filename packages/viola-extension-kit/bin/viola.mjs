#!/usr/bin/env node
import { parseArgs } from 'node:util';

const commands = {
  i18n: () => import('./commands/i18n.mjs'),
};

const argv = process.argv.slice(2);
const { tokens } = parseArgs({
  args: argv,
  strict: false,
  allowPositionals: true,
  tokens: true,
});

const commandToken = tokens.find((token) => token.kind === 'positional');
const command = commandToken?.value;
const load = command ? commands[command] : undefined;

if (!load) {
  console.error(
    command ? `[viola] unknown command: ${command}` : '[viola] missing command',
  );
  console.error(
    `[viola] available commands: ${Object.keys(commands).join(', ')}`,
  );
  process.exit(1);
}

const { default: run } = await load();
await run(argv.slice(commandToken.index + 1));
