import { cn } from '@v/ui/lib/utils';
import { useId, useState } from 'react';
import { useSnapshot } from 'valtio';
import { Button } from '#ui/button';
import { Check, Loader2 } from '#ui/icon';
import { Input } from '#ui/input';
import { installTheme } from '../../actions';
import { theme } from '../../stores/theme';

const officialThemes = [
  { packageName: '@vivliostyle/theme-base', title: 'Base Theme' },
  { packageName: '@vivliostyle/theme-techbook', title: 'Techbook' },
  { packageName: '@vivliostyle/theme-academic', title: 'Academic' },
  { packageName: '@vivliostyle/theme-bunko', title: 'Bunko' },
  { packageName: '@vivliostyle/theme-gutenberg', title: 'Gutenberg' },
  { packageName: '@vivliostyle/theme-slide', title: 'Slide' },
] satisfies {
  packageName: string;
  title: string;
}[];

function InstalledIcon({ className, ...props }: React.ComponentProps<'svg'>) {
  return <Check {...props} strokeWidth={4} className={cn(className)} />;
}

function LoadingIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span {...props} className={cn('size-4 *:size-full', className)}>
      <Loader2 className="animate-spin" />
    </span>
  );
}

export function Theme() {
  const themeSnap = useSnapshot(theme);
  const usesCustomTheme = !officialThemes.some(
    (t) => t.packageName === themeSnap.packageName,
  );
  const [packageNameInput, setPackageNameInput] = useState(() =>
    usesCustomTheme ? themeSnap.packageName : '',
  );
  const packageNameInputDescriptionId = useId();
  const currentPackageName = theme.installingPackageName || theme.packageName;

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h3 className="text-l font-bold">Vivliostyle Theme</h3>
        <ul className="grid grid-cols-2 gap-2">
          {officialThemes.map((t) => (
            <li key={t.packageName}>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  'size-full text-left',
                  t.packageName === currentPackageName && 'border-primary',
                )}
                onClick={() => installTheme(t.packageName)}
              >
                <span className="flex-1">{t.title}</span>
                {t.packageName === themeSnap.installingPackageName ? (
                  <LoadingIcon />
                ) : (
                  <InstalledIcon
                    className={cn(
                      t.packageName !== currentPackageName && 'invisible',
                    )}
                  />
                )}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <h3 className="text-l font-bold">Install other themes from npm</h3>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            const value = e.currentTarget.packageName.value.trim();
            setPackageNameInput(value);
            installTheme(value);
          }}
        >
          <div className="flex items-center gap-2">
            <label className="contents">
              <span className="sr-only">Package name</span>
              <div className="relative flex-1 flex">
                <Input
                  type="text"
                  name="packageName"
                  className={cn(
                    'flex-1 pr-8',
                    packageNameInput === currentPackageName && 'border-primary',
                  )}
                  aria-describedby={packageNameInputDescriptionId}
                  value={packageNameInput}
                  onChange={(e) => setPackageNameInput(e.target.value)}
                  disabled={!!themeSnap.installingPackageName}
                />
                <div className="absolute inset-y-0 right-3 my-auto size-4">
                  {themeSnap.installingPackageName === packageNameInput ? (
                    <LoadingIcon />
                  ) : (
                    <InstalledIcon
                      className={cn(
                        'size-full',
                        packageNameInput !== currentPackageName && 'invisible',
                      )}
                    />
                  )}
                </div>
              </div>
            </label>
            <Button type="submit" disabled={!!themeSnap.installingPackageName}>
              Install
            </Button>
          </div>
          <p
            id={packageNameInputDescriptionId}
            className="text-sm text-gray-500"
          >
            Enter the npm package name of the theme you want to install.
          </p>
          {themeSnap.installingError && (
            <p className="text-sm text-destructive" aria-live="polite">
              Error: {themeSnap.installingError.message}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
