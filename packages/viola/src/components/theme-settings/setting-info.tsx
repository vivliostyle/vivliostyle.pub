import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@v/ui/button';
import { HoverCardContent } from '@v/ui/hover-card';
import { Check, Copy, ExternalLink } from '@v/ui/icon';
import { m } from '../../generated/paraglide/messages';
import {
  describeVariable,
  type ThemeVariable,
  type ValueDescriptor,
  type ValueType,
} from '../../libs/theme-variables';
import { getVariableLabel } from './labels';
import { useDistinctMessage } from './live-region';
import { getValueTypeLabel } from './messages';
import {
  type CssReference,
  getCssReference,
  getDataTypeUrl,
  getValueUnits,
} from './value-info';

/** The one card of a list, for the info button last used in it. */
export function SettingInfoCard({
  getVariable,
  isImportant,
}: {
  getVariable: (name: string) => ThemeVariable | undefined;
  isImportant: (name: string) => boolean;
}) {
  const titleId = useId();
  return (
    <HoverCardContent
      align="start"
      hideWhenDetached
      aria-labelledby={titleId}
      className="grid w-80 gap-3 p-3 text-xs"
    >
      {(name) => {
        const variable = getVariable(name);
        return (
          variable && (
            <InfoCard
              titleId={titleId}
              variable={variable}
              descriptor={describeVariable(variable)}
              label={getVariableLabel(variable)}
              important={isImportant(name)}
            />
          )
        );
      }}
    </HoverCardContent>
  );
}

function InfoCard({
  titleId,
  variable,
  descriptor,
  label,
  important,
}: {
  titleId: string;
  variable: ThemeVariable;
  descriptor: ValueDescriptor;
  label: string;
  important: boolean;
}) {
  const { universal, keywords, types, multiplier } = descriptor;
  const units = universal ? [] : getValueUnits(descriptor);
  const hasHint = keywords.length > 0 || types.length > 0;

  return (
    <>
      <div className="grid gap-1">
        <p id={titleId} className="text-sm font-medium">
          {label}
        </p>
        <VariableName name={variable.name} important={important} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {universal ? (
          <>
            <InfoItem term={m.theme_settings_info_types()}>
              {m.theme_settings_info_any_value()}
            </InfoItem>
            {hasHint && (
              // For `*`, the hint comes from the consuming properties and
              // constrains nothing.
              <InfoItem term={m.theme_settings_info_typical()}>
                <TypeList types={types} />
                <CodeList items={keywords} />
              </InfoItem>
            )}
          </>
        ) : (
          <>
            {keywords.length > 0 && (
              <InfoItem term={m.theme_settings_info_keywords()}>
                <CodeList items={keywords} />
              </InfoItem>
            )}
            {types.length > 0 && (
              <InfoItem term={m.theme_settings_info_types()}>
                <TypeList types={types} />
              </InfoItem>
            )}
            {units.length > 0 && (
              <InfoItem term={m.theme_settings_info_units()}>
                <p className="font-mono">{units.join(' ')}</p>
              </InfoItem>
            )}
          </>
        )}
        {universal && variable.syntax.trim() !== '*' && (
          <InfoItem term={m.theme_settings_info_syntax()}>
            <code className="font-mono">{variable.syntax}</code>
          </InfoItem>
        )}
        <InfoItem term={m.theme_settings_info_used_in()}>
          {variable.properties.length > 0 ? (
            <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
              {variable.properties.map((name) => (
                <li key={name}>
                  <ReferenceLink reference={getCssReference(name)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              {m.theme_settings_info_no_properties()}
            </p>
          )}
        </InfoItem>
      </dl>
      {multiplier && (
        <p className="text-muted-foreground">
          {multiplier === 'comma'
            ? m.theme_settings_info_list_comma()
            : m.theme_settings_info_list_space()}
        </p>
      )}
    </>
  );
}

function InfoItem({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="grid min-w-0 gap-1">{children}</dd>
    </>
  );
}

function VariableName({
  name,
  important,
}: {
  name: string;
  important: boolean;
}) {
  const codeRef = useRef<HTMLElement>(null);
  // A new object on every copy, so that a repeated copy restarts the timer.
  const [feedback, setFeedback] = useState<{
    copied: boolean;
    message: string;
  } | null>(null);
  const distinct = useDistinctMessage();

  useEffect(() => {
    if (!feedback) {
      return;
    }
    // A failure takes longer to read, and the user goes on to copy by hand.
    const timer = setTimeout(
      () => setFeedback(null),
      feedback.copied ? 1500 : 4000,
    );
    return () => clearTimeout(timer);
  }, [feedback]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setFeedback({
        copied: true,
        message: distinct(m.theme_settings_info_copied()),
      });
    } catch {
      // Selecting the name leaves copying to the user.
      if (codeRef.current) {
        window.getSelection()?.selectAllChildren(codeRef.current);
      }
      setFeedback({
        copied: false,
        message: distinct(m.theme_settings_info_copy_failed()),
      });
    }
  };

  return (
    <div className="grid">
      <div className="flex items-start gap-1">
        <code
          ref={codeRef}
          className="min-w-0 flex-1 break-all py-0.5 font-mono text-muted-foreground select-all"
        >
          {name}
        </code>
        {important && (
          <code className="mt-0.5 shrink-0 rounded-sm border px-1 font-mono text-[10px]">
            !important
          </code>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-0.5 size-6 shrink-0 [&_svg]:size-3.5"
          aria-label={m.theme_settings_info_copy_name_aria()}
          title={m.theme_settings_info_copy_name_aria()}
          onClick={copy}
        >
          {feedback?.copied ? <Check /> : <Copy />}
        </Button>
      </div>
      {/* Kept mounted while empty: a live region is announced when its text
          changes, not when it appears. */}
      <output
        className={
          feedback?.copied === false
            ? 'text-destructive'
            : 'text-muted-foreground'
        }
      >
        {feedback?.message}
      </output>
    </div>
  );
}

function TypeList({ types }: { types: readonly ValueType[] }) {
  if (types.length === 0) {
    return null;
  }
  return (
    <ul className="grid gap-0.5">
      {types.map((type) => {
        const url = getDataTypeUrl(type);
        return (
          <li key={type} className="flex flex-wrap items-baseline gap-x-1.5">
            <span>{getValueTypeLabel(type)}</span>
            {url && <MdnLink name={`<${type}>`} url={url} />}
          </li>
        );
      })}
    </ul>
  );
}

function CodeList({ items }: { items: readonly string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((item) => (
        <li key={item}>
          <code className="rounded-sm bg-muted px-1 font-mono">{item}</code>
        </li>
      ))}
    </ul>
  );
}

function ReferenceLink({ reference }: { reference: CssReference }) {
  const name = reference.atRule
    ? `${reference.atRule} ${reference.name}`
    : reference.name;
  return reference.url ? (
    <MdnLink name={name} url={reference.url} />
  ) : (
    <code className="font-mono">{name}</code>
  );
}

function MdnLink({ name, url }: { name: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={m.theme_settings_info_mdn_link_aria({ name })}
      className="inline-flex items-center gap-0.5 rounded-sm font-mono underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-current focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {name}
      <ExternalLink aria-hidden className="size-3 shrink-0" />
    </a>
  );
}
