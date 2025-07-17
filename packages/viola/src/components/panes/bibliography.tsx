import type React from 'react';
import { use } from 'react';
import { useSnapshot } from 'valtio';

import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
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
import { $project } from '../../stores/project';

function BookTitleInput({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Input>>) {
  const inputProps = useLiveInputField(() => $project.bibliography.title, {
    onSave: (value) => {
      const title = value.trim();
      $project.bibliography.title = title;
      return title;
    },
  });

  return (
    <label className="contents">
      {children}
      <Input {...props} {...inputProps} type="text" name="bookTitle" />
    </label>
  );
}

function AuthorInput({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Input>>) {
  const inputProps = useLiveInputField(() => $project.bibliography.author, {
    onSave: (value) => {
      const author = value.trim();
      $project.bibliography.author = author;
      return author;
    },
  });

  return (
    <label className="contents">
      {children}
      <Input {...props} {...inputProps} type="text" name="author" />
    </label>
  );
}

function UseTocSwitch({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Switch>>) {
  const inputProps = useLiveCheckboxField(() => $project.toc.enabled, {
    onSave: (value) => {
      $project.toc.enabled = value;
    },
  });

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
  const inputProps = useLiveInputField(() => $project.toc.title, {
    onSave: (value) => {
      const title = value.trim();
      $project.toc.title = title;
      return title;
    },
  });

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
  const inputProps = useLiveSelectField(() => `${$project.toc.sectionDepth}`, {
    onSave: (value) => {
      $project.toc.sectionDepth = value ? Number(value) : 0;
    },
  });

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

export function Bibliography() {
  use($project.setupPromise);

  const projectSnap = useSnapshot($project);

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <BookTitleInput>
          <span className="text-l font-bold">Book Title</span>
        </BookTitleInput>
      </section>

      <section className="grid gap-2">
        <AuthorInput>
          <span className="text-l font-bold">Author</span>
        </AuthorInput>
      </section>

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
