// https://github.com/npm/validate-npm-package-name

const scopedPackagePattern = /^(?:@([^\/]+?)[\/])?([^\/]+?)$/;
const blacklist = ['node_modules', 'favicon.ico'];

export function validate(name: unknown) {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (name === null) {
    errors.push('name cannot be null');
    return done(warnings, errors);
  }

  if (name === undefined) {
    errors.push('name cannot be undefined');
    return done(warnings, errors);
  }

  if (typeof name !== 'string') {
    errors.push('name must be a string');
    return done(warnings, errors);
  }

  if (!name.length) {
    errors.push('name length must be greater than zero');
  }

  if (name.match(/^\./)) {
    errors.push('name cannot start with a period');
  }

  if (name.match(/^_/)) {
    errors.push('name cannot start with an underscore');
  }

  if (name.trim() !== name) {
    errors.push('name cannot contain leading or trailing spaces');
  }

  // No funny business
  for (const blacklistedName of blacklist) {
    if (name.toLowerCase() === blacklistedName) {
      errors.push(`${blacklistedName} is a blacklisted name`);
    }
  }

  // Generate warnings for stuff that used to be allowed

  if (name.length > 214) {
    warnings.push('name can no longer contain more than 214 characters');
  }

  // mIxeD CaSe nAMEs
  if (name.toLowerCase() !== name) {
    warnings.push('name can no longer contain capital letters');
  }

  if (/[~'!()*]/.test(name.split('/').slice(-1)[0])) {
    warnings.push('name can no longer contain special characters ("~\'!()*")');
  }

  if (encodeURIComponent(name) !== name) {
    // Maybe it's a scoped package name, like @user/package
    const nameMatch = name.match(scopedPackagePattern);
    if (nameMatch) {
      const user = nameMatch[1];
      const pkg = nameMatch[2];
      if (
        encodeURIComponent(user) === user &&
        encodeURIComponent(pkg) === pkg
      ) {
        return done(warnings, errors);
      }
    }

    errors.push('name can only contain URL-friendly characters');
  }

  return done(warnings, errors);
}

const done = (warnings: string[], errors: string[]) => {
  const result = {
    validForNewPackages: errors.length === 0 && warnings.length === 0,
    validForOldPackages: errors.length === 0,
    warnings: warnings,
    errors: errors,
  };
  if (!result.warnings.length) {
    // @ts-ignore
    // biome-ignore lint/performance/noDelete:
    delete result.warnings;
  }
  if (!result.errors.length) {
    // @ts-ignore
    // biome-ignore lint/performance/noDelete:
    delete result.errors;
  }
  return result;
};
