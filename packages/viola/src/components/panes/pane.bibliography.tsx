import { LANGUAGES } from '@vivliostyle/cli/constants';
import type React from 'react';
import { use, useCallback, useState } from 'react';
import { useSnapshot } from 'valtio';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@v/ui/command';
import { ChevronDownIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@v/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@v/ui/select';
import { Switch } from '@v/ui/switch';
import {
  useLiveCheckboxField,
  useLiveInputField,
  useLiveSelectField,
} from '../../hooks/use-live-field';
import { $project } from '../../stores/accessors';
import { createPane, PaneContainer, ScrollOverflow } from './util';

type BibliographyPaneProperty = object;

declare global {
  interface PanePropertyMap {
    bibliography: BibliographyPaneProperty;
  }
}

export const Pane = createPane<BibliographyPaneProperty>({
  title: () => 'Bibliography',
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <Content {...props} />
      </PaneContainer>
    </ScrollOverflow>
  ),
});

function BookTitleInput({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Input>>) {
  const inputProps = useLiveInputField(
    () => $project.valueOrThrow().bibliography.title,
    {
      onSave: (value) => {
        const title = value.trim();
        $project.valueOrThrow().bibliography.title = title;
        return title;
      },
    },
  );

  return (
    <label className="grid gap-2">
      {children}
      <Input {...props} {...inputProps} type="text" name="bookTitle" />
    </label>
  );
}

function AuthorInput({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Input>>) {
  const inputProps = useLiveInputField(
    () => $project.valueOrThrow().bibliography.author,
    {
      onSave: (value) => {
        const author = value.trim();
        $project.valueOrThrow().bibliography.author = author;
        return author;
      },
    },
  );

  return (
    <label className="grid gap-2">
      {children}
      <Input {...props} {...inputProps} type="text" name="author" />
    </label>
  );
}

function LanguageSelect({ children }: React.PropsWithChildren) {
  const snap = useSnapshot($project).valueOrThrow();
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback((value: string) => {
    setOpen(false);
    $project.valueOrThrow().bibliography.language = value;
  }, []);

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

function UseTocSwitch({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Switch>>) {
  const inputProps = useLiveCheckboxField(
    () => $project.valueOrThrow().toc.enabled,
    {
      onSave: (value) => {
        $project.valueOrThrow().toc.enabled = value;
      },
    },
  );

  return (
    <label className="contents">
      <Switch {...props} {...inputProps} />
      {children}
    </label>
  );
}

function TocTitleInput({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Input>>) {
  const inputProps = useLiveInputField(
    () => $project.valueOrThrow().toc.title,
    {
      onSave: (value) => {
        const title = value.trim();
        $project.valueOrThrow().toc.title = title;
        return title;
      },
    },
  );

  return (
    <label className="contents">
      {children}
      <Input {...props} {...inputProps} type="text" name="tocTitle" />
    </label>
  );
}

function TocSectionDepthSelect({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Select>>) {
  const inputProps = useLiveSelectField(
    () => `${$project.valueOrThrow().toc.sectionDepth}`,
    {
      onSave: (value) => {
        $project.valueOrThrow().toc.sectionDepth = value ? Number(value) : 0;
      },
    },
  );

  return (
    <label className="contents">
      {children}
      <Select {...props} {...inputProps}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Do not display sections</SelectItem>
          <SelectItem value="1">Level 1</SelectItem>
          <SelectItem value="2">Level 2</SelectItem>
          <SelectItem value="3">Level 3</SelectItem>
          <SelectItem value="4">Level 4</SelectItem>
          <SelectItem value="5">Level 5</SelectItem>
          <SelectItem value="6">Level 6</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

function Content(_: BibliographyPaneProperty) {
  const projectSnap = useSnapshot($project).valueOrThrow();
  use(projectSnap.setupPromise);

  return (
    <div className="grid gap-4">
      <BookTitleInput>
        <span className="text-l font-bold">Book Title</span>
      </BookTitleInput>

      <AuthorInput>
        <span className="text-l font-bold">Author</span>
      </AuthorInput>

      <LanguageSelect>
        <span className="text-l font-bold">Language</span>
      </LanguageSelect>

      <section className="grid gap-2">
        <h3 className="text-l font-bold">Table of Contents</h3>
        <div className="flex items-center gap-2">
          <UseTocSwitch>
            <span className="text-sm">Enable Table of Contents</span>
          </UseTocSwitch>
        </div>

        <section className="grid gap-2">
          <TocTitleInput disabled={!projectSnap.toc.enabled}>
            <span
              className={cn(
                'text-sm font-bold',
                projectSnap.toc.enabled
                  ? 'text-secondary-foreground'
                  : 'text-muted-foreground',
              )}
            >
              Table of Contents Title
            </span>
          </TocTitleInput>
        </section>

        <section className="grid gap-2">
          <TocSectionDepthSelect disabled={!projectSnap.toc.enabled}>
            <span
              className={cn(
                'text-sm font-bold',
                projectSnap.toc.enabled
                  ? 'text-secondary-foreground'
                  : 'text-muted-foreground',
              )}
            >
              Table of Contents Depth
            </span>
          </TocSectionDepthSelect>
        </section>
      </section>
    </div>
  );
}
