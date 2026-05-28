import { lazy, useEffect, useId, useState } from 'react';
import { useDebounce } from 'react-use';
import { ref, useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import { Check, Loader2 } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
import { m } from '../../generated/paraglide/messages';
import { usePromiseState } from '../../hooks/use-promise-state';
import { getOfficialThemeTitle } from '../../libs/official-theme-title';
import { $sandbox, $theme } from '../../stores/accessors';
import { SandboxFile } from '../../stores/proxies/sandbox';
import { Theme } from '../../stores/proxies/theme';
import { createPane, PaneContainer, ScrollOverflow } from './util';

type ThemePaneProperty = object;

declare global {
  interface PanePropertyMap {
    theme: ThemePaneProperty;
  }
}

export const Pane = createPane<ThemePaneProperty>({
  title: () => m.theme_pane_title(),
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <Content {...props} />
      </PaneContainer>
    </ScrollOverflow>
  ),
});

const CodeEditor = lazy(() => import('../code-editor'));

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

function Content(_: ThemePaneProperty) {
  const themeSnap = useSnapshot($theme).valueOrThrow();
  const packageNameInputDescriptionId = useId();
  const [customCss, setCustomCss] = useState(() => themeSnap.customCss);
  const { value: installedTheme } = usePromiseState(themeSnap.installPromise);
  const currentPackageName =
    themeSnap.installingPackageName || installedTheme?.packageName;

  const [packageNameInput, setPackageNameInput] = useState('');
  useEffect(() => {
    if (
      installedTheme &&
      !(installedTheme.packageName in Theme.officialThemes)
    ) {
      setPackageNameInput(installedTheme.packageName);
    }
  });

  useDebounce(
    () => {
      $theme.valueOrThrow().customCss = customCss;
      $sandbox.valueOrThrow().files['style.css'] = ref(
        new SandboxFile('text/css', customCss),
      );
    },
    1000,
    [customCss],
  );

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h3 className="text-l font-bold">{m.theme_official_section_title()}</h3>
        <ul className="grid grid-cols-2 gap-2">
          {Object.entries(Theme.officialThemes).map(
            ([packageName, { title }]) => {
              return (
                <li key={packageName}>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'size-full text-left',
                      packageName === currentPackageName && 'border-primary',
                    )}
                    onClick={() => $theme.valueOrThrow().install(packageName)}
                  >
                    <span className="flex-1">
                      {getOfficialThemeTitle(packageName, title)}
                    </span>
                    {packageName === themeSnap.installingPackageName ? (
                      <LoadingIcon />
                    ) : (
                      <InstalledIcon
                        className={cn(
                          packageName !== currentPackageName && 'invisible',
                        )}
                      />
                    )}
                  </Button>
                </li>
              );
            },
          )}
        </ul>
      </section>

      <section className="grid gap-2">
        <h3 className="text-l font-bold">
          {m.theme_install_other_section_title()}
        </h3>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            const value = e.currentTarget.packageName.value.trim();
            setPackageNameInput(value);
            $theme.valueOrThrow().install(value);
          }}
        >
          <div className="flex items-center gap-2">
            <label className="contents">
              <span className="sr-only">{m.theme_package_name_aria()}</span>
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
              {m.theme_install_button()}
            </Button>
          </div>
          <p
            id={packageNameInputDescriptionId}
            className="text-sm text-gray-500"
          >
            {m.theme_package_name_description()}
          </p>
          {themeSnap.installFailure && (
            <p className="text-sm text-destructive" aria-live="polite">
              {m.theme_install_error({
                message: themeSnap.installFailure.message,
              })}
            </p>
          )}
        </form>
      </section>

      <section className="grid gap-2">
        <h3 className="text-l font-bold">
          {m.theme_custom_css_section_title()}
        </h3>
        <CodeEditor
          aria-label={m.theme_custom_css_editor_aria()}
          code={customCss}
          onCodeUpdate={setCustomCss}
        />
      </section>
    </div>
  );
}
