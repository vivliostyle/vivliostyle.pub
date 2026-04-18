import { useMolecule } from 'bunshi/react';
import { useTransition } from 'react';
import { useSnapshot } from 'valtio';

import {
  StackedRadioGroup,
  StackedRadioGroupItem,
} from '@v/ui/custom/stacked-radio';
import { Sandbox } from '../../../stores/proxies/sandbox';
import { TemplateStoreMolecule } from './store';

export function TemplateSelectForm() {
  const { templateStoreProxy } = useMolecule(TemplateStoreMolecule);
  const snap = useSnapshot(templateStoreProxy);
  const [isPending, startTransition] = useTransition();

  return (
    <form className="contents">
      <div className="grid gap-4">
        <h3 className="text-xl font-bold">Choose Template</h3>
        <StackedRadioGroup
          className="grid-cols-2"
          value={snap.selected}
          onValueChange={(value) => {
            startTransition(() => templateStoreProxy.selectTemplate(value));
          }}
        >
          {Object.entries(Sandbox.officialTemplates).map(
            ([value, { title, description }]) => (
              <StackedRadioGroupItem
                key={value}
                value={value}
                disabled={isPending}
                isLoading={isPending && snap.selected === value}
              >
                {title}
                <p className="text-xs text-muted-foreground">{description}</p>
              </StackedRadioGroupItem>
            ),
          )}
        </StackedRadioGroup>
      </div>
    </form>
  );
}
