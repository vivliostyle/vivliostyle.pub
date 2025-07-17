// https://github.com/npm/npm-package-arg

import { valid, validRange } from 'semver';

import { validate as validatePackageName } from './validate-npm-package-name.js';

const hasSlashes = /[/]/;
const isURL = /^(?:git[+])?[a-z]+:/i;
const isGit = /^[^@]+@[^:.]+\.[^:]+:.+$/i;
const isFileType = /[.](?:tgz|tar.gz|tar)$/i;
const isPosixFile = /^(?:[.]|~[/]|[/]|[a-zA-Z]:)/;

export function npa(arg: string): Result {
  let name: string | undefined;
  let spec: string | undefined;
  const nameEndsAt = arg.indexOf('@', 1); // Skip possible leading @
  const namePart = nameEndsAt > 0 ? arg.slice(0, nameEndsAt) : arg;
  if (isURL.test(arg)) {
    spec = arg;
  } else if (isGit.test(arg)) {
    spec = `git+ssh://${arg}`;
    // eslint-disable-next-line max-len
  } else if (
    !namePart.startsWith('@') &&
    (hasSlashes.test(namePart) || isFileType.test(namePart))
  ) {
    spec = arg;
  } else if (nameEndsAt > 0) {
    name = namePart;
    spec = arg.slice(nameEndsAt + 1) || '*';
  } else {
    const valid = validatePackageName(arg);
    if (valid.validForOldPackages) {
      name = arg;
      spec = '*';
    } else {
      spec = arg;
    }
  }
  return resolve(name, spec, arg);
}

function isFileSpec(spec: string | undefined) {
  if (!spec) {
    return false;
  }
  if (spec.toLowerCase().startsWith('file:')) {
    return true;
  }
  return isPosixFile.test(spec);
}

function isAliasSpec(spec: string | undefined) {
  if (!spec) {
    return false;
  }
  return spec.toLowerCase().startsWith('npm:');
}

function resolve(
  name: string | undefined,
  spec: string | undefined,
  arg: string,
) {
  const res = new Result({
    raw: arg,
    name: name,
    rawSpec: spec,
  });

  if (name) {
    res.name = name;
  }

  if (isFileSpec(spec)) {
    // return fromFile(res, where)
    throw new Error('file specifier is not allowed');
  }
  if (isAliasSpec(spec)) {
    // return fromAlias(res, where)
    throw new Error('alias specifier is not allowed');
  }

  // const hosted = HostedGit.fromUrl(spec, {
  //   noGitPlus: true,
  //   noCommittish: true,
  // })
  // if (hosted) {
  //   return fromHostedGit(res, hosted)
  // }
  if (spec && isURL.test(spec)) {
    // return fromURL(res)
    throw new Error('url specifier is not allowed');
  }
  if (spec && (hasSlashes.test(spec) || isFileType.test(spec))) {
    // return fromFile(res, where)
    throw new Error('file specifier is not allowed');
  }
  return fromRegistry(res);
}

function fromRegistry(res: Result) {
  res.registry = true;
  const spec = res.rawSpec.trim();
  // no save spec for registry components as we save based on the fetched
  // version, not on the argument so this can't compute that.
  res.saveSpec = null;
  res.fetchSpec = spec;
  const version = valid(spec, true);
  const range = validRange(spec, true);
  if (version) {
    res.type = 'version';
  } else if (range) {
    res.type = 'range';
  } else {
    if (encodeURIComponent(spec) !== spec) {
      throw invalidTagName(spec, res.raw);
    }
    res.type = 'tag';
  }
  return res;
}

function invalidPackageName(
  name: string,
  valid: ReturnType<typeof validatePackageName>,
  raw: string,
) {
  const err = new Error(
    `Invalid package name "${name}" of package "${raw}": ${valid.errors.join('; ')}.`,
  );
  return err;
}

function invalidTagName(name: string, raw: string) {
  const err = new Error(
    `Invalid tag name "${name}" of package "${raw}": Tags may not have any characters that encodeURIComponent encodes.`,
  );
  return err;
}

export class Result {
  type: 'tag' | 'version' | 'range';
  // | "git"
  // | "file"
  // | "directory"
  // | "remote"
  // | "alias"
  registry: boolean;
  name?: string | null;
  scope?: string | null;
  escapedName?: string | null;
  rawSpec: string;
  saveSpec: string | null;
  fetchSpec: string | null;
  gitRange?: string | undefined;
  gitCommittish?: string | undefined;
  hosted?: undefined;
  raw: string;

  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: FIXME
    opts: any,
  ) {
    this.type = opts.type;
    this.registry = opts.registry;
    // this.where = opts.where
    if (opts.raw == null) {
      this.raw = opts.name ? `${opts.name}@${opts.rawSpec}` : opts.rawSpec;
    } else {
      this.raw = opts.raw;
    }
    // this.name = undefined
    // this.escapedName = undefined
    // this.scope = undefined
    this.rawSpec = opts.rawSpec || '';
    this.saveSpec = opts.saveSpec;
    this.fetchSpec = opts.fetchSpec;
    if (opts.name) {
      this.setName(opts.name);
    }
    this.gitRange = opts.gitRange;
    this.gitCommittish = opts.gitCommittish;
    // this.gitSubdir = opts.gitSubdir
    this.hosted = opts.hosted;
  }

  // TODO move this to a getter/setter in a semver major
  setName(name: string) {
    const valid = validatePackageName(name);
    if (!valid.validForOldPackages) {
      throw invalidPackageName(name, valid, this.raw);
    }

    this.name = name;
    this.scope = name[0] === '@' ? name.slice(0, name.indexOf('/')) : undefined;
    // scoped packages in couch must have slash url-encoded, e.g. @foo%2Fbar
    this.escapedName = name.replace('/', '%2f');
    return this;
  }

  toString() {
    const full: string[] = [];
    if (this.name != null && this.name !== '') {
      full.push(this.name);
    }
    const spec = this.saveSpec || this.fetchSpec || this.rawSpec;
    if (spec != null && spec !== '') {
      full.push(spec);
    }
    return full.length ? full.join('@') : this.raw;
  }

  toJSON() {
    const result = Object.assign({}, this);
    delete result.hosted;
    return result;
  }
}
