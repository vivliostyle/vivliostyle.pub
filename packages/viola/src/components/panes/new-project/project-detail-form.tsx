import { useNavigate } from '@tanstack/react-router';
import { LANGUAGES } from '@vivliostyle/cli/constants';
import { useMolecule } from 'bunshi/react';
import { invariant } from 'outvariant';
import { useCallback, useState, useTransition } from 'react';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@v/ui/command';
import { LoadingUI } from '@v/ui/custom/loading-ui';
import {
  StackedRadioGroup,
  StackedRadioGroupItem,
} from '@v/ui/custom/stacked-radio';
import { ChevronDownIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@v/ui/popover';
import { useLiveInputField } from '../../../hooks/use-live-field';
import { $draftProject, $project } from '../../../stores/accessors';
import { setupProjectFromDraft } from '../../../stores/actions/setup-project-from-draft';
import type { ProjectId } from '../../../stores/proxies/project';
import { Theme } from '../../../stores/proxies/theme';
import { TemplateStoreMolecule } from './store';

function BookTitleInput({ children }: React.PropsWithChildren) {
  const inputProps = useLiveInputField(
    () => $draftProject.valueOrThrow().bibliography.title,
    {
      onSave: (value) => {
        const title = value.trim();
        $draftProject.valueOrThrow().bibliography.title = title;
        return title;
      },
    },
  );

  return (
    <label className="grid gap-2">
      {children}
      <div>
        <Input type="text" name="bookTitle" required {...inputProps} />
      </div>
    </label>
  );
}

function AuthorInput({ children }: React.PropsWithChildren) {
  const inputProps = useLiveInputField(
    () => $draftProject.valueOrThrow().bibliography.author,
    {
      onSave: (value) => {
        const author = value.trim();
        $draftProject.valueOrThrow().bibliography.author = author;
        return author;
      },
    },
  );

  return (
    <label className="grid gap-2">
      {children}
      <div>
        <Input type="text" name="author" required {...inputProps} />
      </div>
    </label>
  );
}

function LanguageSelect({ children }: React.PropsWithChildren) {
  const snap = useSnapshot($draftProject).valueOrThrow();
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (value: string) => {
      setOpen(false);
      $draftProject.valueOrThrow().bibliography.language = value;
    },
    [snap],
  );

  return (
    <div className="grid gap-2">
      {children}
      <Popover open={open} onOpenChange={setOpen}>
        {/** biome-ignore lint/a11y/useSemanticElements: Combobox with search */}
        <PopoverTrigger
          role="combobox"
          className={cn(
            "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            'relative w-xs has-focus-visible:border-ring',
          )}
        >
          <input
            type="text"
            name="language"
            required
            value={snap.bibliography.language}
            tabIndex={-1}
            className="sr-only inset-0 size-auto pointer-events-none"
          />
          {LANGUAGES[snap.bibliography.language as keyof typeof LANGUAGES] || (
            <span className="text-muted-foreground">Select language</span>
          )}
          <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-xs p-0">
          <Command>
            <CommandInput placeholder="Search language..." />
            <CommandList>
              <CommandEmpty>No language found.</CommandEmpty>
              <CommandGroup>
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <CommandItem key={code} value={code} onSelect={handleSelect}>
                    {name}
                    <span aria-hidden="true" className="text-muted-foreground">
                      ({code})
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ThemeSelect({ children }: React.PropsWithChildren) {
  const snap = useSnapshot($draftProject).valueOrThrow();

  const handleSelect = useCallback((value: string) => {
    $draftProject.valueOrThrow().theme.packageName = value;
  }, []);

  return (
    <div className="grid gap-2">
      {children}
      <StackedRadioGroup
        className="grid-cols-2"
        value={snap.theme.packageName}
        onValueChange={handleSelect}
      >
        {Object.entries(Theme.officialThemes).map(([value, { title }]) => (
          <StackedRadioGroupItem key={value} value={value} required>
            {title}
          </StackedRadioGroupItem>
        ))}
      </StackedRadioGroup>
    </div>
  );
}

export function ProjectDetailForm() {
  const { templateStoreProxy } = useMolecule(TemplateStoreMolecule);
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        const templateValue = templateStoreProxy.selected;
        if (!templateValue) {
          return;
        }
        startTransition(async () => {
          await setupProjectFromDraft({
            projectId: 'alpha-v1' as ProjectId,
            templateValue,
          });
          const project = $project.valueOrThrow();
          const contentId = project.content.readingOrder[0];
          const file = project.content.files.get(contentId);
          invariant(file, 'First content file not found');
          navigate({
            to: '/edit/$',
            params: {
              _splat: file.filename,
            },
            replace: true,
          });
        });
      }}
    >
      <section className="grid gap-4">
        <h3 className="text-xl font-bold">Project Details</h3>

        <p className="text-sm">
          All fields are optional and can be changed later in project settings.
        </p>

        <BookTitleInput>
          <span className="text-l font-bold">Book title</span>
        </BookTitleInput>

        <AuthorInput>
          <span className="text-l font-bold">Author</span>
        </AuthorInput>

        <LanguageSelect>
          <span className="text-l font-bold">Language</span>
        </LanguageSelect>

        <ThemeSelect>
          <span className="text-l font-bold">Theme</span>
        </ThemeSelect>
      </section>

      <Button type="submit" loading={isPending}>
        <span>Create Project</span>
        <LoadingUI>Creating project</LoadingUI>
      </Button>
    </form>
  );
}
