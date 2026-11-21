import { useMolecule } from 'bunshi/react';
import { useTransition } from 'react';
import { useSnapshot } from 'valtio';

import {
  StackedRadioGroup,
  StackedRadioGroupItem,
} from '@v/ui/custom/stacked-radio';
import { m } from '../../../generated/paraglide/messages';
import {
  type OfficialTemplateId,
  officialTemplates,
} from '../../../stores/catalog';
import { TemplateStoreMolecule } from './store';

const officialTemplateMessages: Record<
  OfficialTemplateId,
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
          {Object.entries(officialTemplates).map(
            ([value, { title, description }]) => {
              const messages =
                officialTemplateMessages[value as OfficialTemplateId];
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
        </StackedRadioGroup>
      </div>
    </form>
  );
}
