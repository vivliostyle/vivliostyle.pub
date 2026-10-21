import { useMolecule } from 'bunshi/react';
import { useEffect, useTransition } from 'react';
import { useSnapshot } from 'valtio';

import {
  StackedRadioGroup,
  StackedRadioGroupItem,
} from '@v/ui/custom/stacked-radio';
import { m } from '../../../generated/paraglide/messages';
import { usePromiseState } from '../../../hooks/use-promise-state';
import { $draftProject } from '../../../stores/accessors';
import { THEME_TEMPLATE_PREFIX } from '../../../stores/actions/resolve-template-source';
import { Sandbox } from '../../../stores/proxies/sandbox';
import { TemplateStoreMolecule } from './store';

const officialTemplateMessages: Record<
  keyof typeof Sandbox.officialTemplates,
  { title: () => string; description: () => string }
> = {
  blank: {
    title: m.new_project_template_blank_title,
    description: m.new_project_template_blank_description,
  },
  basic: {
    title: m.new_project_template_basic_title,
    description: m.new_project_template_basic_description,
  },
};

export function TemplateSelectForm() {
  const { templateStoreProxy } = useMolecule(TemplateStoreMolecule);
  const snap = useSnapshot(templateStoreProxy);
  const [isPending, startTransition] = useTransition();
  const draftSnap = useSnapshot($draftProject).valueOrThrow();
  const { value: installedTheme } = usePromiseState(
    draftSnap.theme.installPromise,
  );
  const themeTemplates = installedTheme?.templates ?? [];

  // A template chosen together with the theme in the theme browser.
  const requestedTemplateId = draftSnap.theme.requestedTemplateId;
  useEffect(() => {
    if (
      requestedTemplateId &&
      themeTemplates.some((t) => t.id === requestedTemplateId)
    ) {
      $draftProject.valueOrThrow().theme.requestedTemplateId = undefined;
      startTransition(() =>
        templateStoreProxy.selectTemplate(
          `${THEME_TEMPLATE_PREFIX}${requestedTemplateId}`,
        ),
      );
    }
  }, [requestedTemplateId, themeTemplates, templateStoreProxy]);

  // Another theme no longer offers the template of the previous one.
  const selected = snap.selected;
  useEffect(() => {
    if (
      installedTheme &&
      selected?.startsWith(THEME_TEMPLATE_PREFIX) &&
      !themeTemplates.some(
        (t) => `${THEME_TEMPLATE_PREFIX}${t.id}` === selected,
      )
    ) {
      startTransition(() => templateStoreProxy.selectTemplate('basic'));
    }
  }, [installedTheme, selected, themeTemplates, templateStoreProxy]);

  return (
    <form className="contents">
      <div className="grid gap-4">
        <h3 className="text-xl font-bold">
          {m.new_project_template_section_title()}
        </h3>
        <StackedRadioGroup
          className="grid-cols-2"
          value={snap.selected}
          onValueChange={(value) => {
            startTransition(() => templateStoreProxy.selectTemplate(value));
          }}
        >
          {Object.entries(Sandbox.officialTemplates).map(
            ([value, { title, description }]) => {
              const messages =
                officialTemplateMessages[
                  value as keyof typeof Sandbox.officialTemplates
                ];
              return (
                <StackedRadioGroupItem
                  key={value}
                  value={value}
                  disabled={isPending}
                  isLoading={isPending && snap.selected === value}
                >
                  {messages ? messages.title() : title}
                  <p className="text-xs text-muted-foreground">
                    {messages ? messages.description() : description}
                  </p>
                </StackedRadioGroupItem>
              );
            },
          )}
          {themeTemplates.map((template) => {
            const value = `${THEME_TEMPLATE_PREFIX}${template.id}`;
            return (
              <StackedRadioGroupItem
                key={value}
                value={value}
                disabled={isPending}
                isLoading={isPending && snap.selected === value}
              >
                {m.new_project_template_from_theme({
                  name: template.name || template.id,
                })}
                {template.description && (
                  <p className="text-xs text-muted-foreground">
                    {template.description}
                  </p>
                )}
              </StackedRadioGroupItem>
            );
          })}
        </StackedRadioGroup>
      </div>
    </form>
  );
}
