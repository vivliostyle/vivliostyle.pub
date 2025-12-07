import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContext, useEditor } from '@tiptap/react';
import { VFM } from '@vivliostyle/vfm';
import DomPurify from 'dompurify';
import parseHtml, {
  domToReact,
  Element as ElementNode,
  type HTMLReactParserOptions,
} from 'html-react-parser';
import {
  createContext,
  isValidElement,
  type JSX,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useDebounce } from 'react-use';

import { PubExtensions } from '@v/tiptap-extensions';
import { cn } from '@v/ui/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@v/ui/tabs';
import CodeEditor from '../../../../components/code-editor';
import {
  EditArea,
  EditorStyleContainer,
} from '../../../../components/content-editor';

type AstTabType = 'tree' | 'html' | 'json';

export interface AstViewerContext {
  markdown: string;
  selectingAstTab: AstTabType;
  editorAst?: unknown;
  editorHtml?: string;
  onMarkdownChange?: (markdown: string) => void;
  onSelectingAstTabChange?: (tab: AstTabType) => void;
  onEditorAstChange?: (editorAst: unknown) => void;
  onEditorHtmlChange?: (editorHtml: string) => void;
}

export const defaultAstViewerContext: AstViewerContext = {
  markdown: '',
  selectingAstTab: 'tree',
};

export const AstViewerContext = createContext<AstViewerContext>(
  defaultAstViewerContext,
);

const deferMs = 200;

export function RichEditorPane() {
  const context = useContext(AstViewerContext);
  const [contentInEditor, setContentInEditor] = useState('');

  const editor = useEditor({
    content: context.markdown,
    extensions: [
      PubExtensions.configure(),
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
      UndoRedo.configure({}),
    ],
    onMount: ({ editor }) => {
      editor.once('update', () => {
        context.onEditorAstChange?.(editor.getJSON());
        context.onEditorHtmlChange?.(editor.getHTML());
      });
    },
    onUpdate: useCallback(() => {
      setContentInEditor(editor.getMarkdown());
    }, []),
  });

  const [, cancel] = useDebounce(
    () => {
      context.onMarkdownChange?.(contentInEditor);
      context.onEditorAstChange?.(editor.getJSON());
      context.onEditorHtmlChange?.(editor.getHTML());
    },
    deferMs,
    [contentInEditor],
  );

  useEffect(() => {
    if (contentInEditor === context.markdown) {
      return;
    }
    editor.commands.setContent(context.markdown, { contentType: 'markdown' });
    setTimeout(cancel, deferMs - 1);

    context.onEditorAstChange?.(editor.getJSON());
    context.onEditorHtmlChange?.(editor.getHTML());
  }, [context.markdown]);

  return (
    <EditorContext.Provider value={{ editor }}>
      <EditorStyleContainer>
        <EditArea />
      </EditorStyleContainer>
    </EditorContext.Provider>
  );
}

export function RawEditorPane() {
  const context = useContext(AstViewerContext);
  const [contentInEditor, setContentInEditor] = useState(context.markdown);

  const [, cancel] = useDebounce(
    () => context.onMarkdownChange?.(contentInEditor),
    deferMs,
    [contentInEditor],
  );

  useEffect(() => {
    if (contentInEditor === context.markdown) {
      return;
    }
    setContentInEditor(context.markdown);
    setTimeout(cancel, deferMs - 1);
  }, [context.markdown]);

  return (
    <CodeEditor
      aria-label="Markdown raw editor"
      language="markdown"
      code={contentInEditor}
      onCodeUpdate={setContentInEditor}
    />
  );
}

const processor = VFM({ partial: true });

export function VfmPreviewPane() {
  const context = useContext(AstViewerContext);
  const [html, setHtml] = useState('');
  useEffect(() => {
    const html = DomPurify.sanitize(
      processor.processSync(context.markdown).toString(),
    );
    setHtml(html);
  }, [context.markdown]);

  return (
    <EditorStyleContainer>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized above */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </EditorStyleContainer>
  );
}

function AstTreeCollapsible({
  value,
  children,
  summaryNode,
}: React.PropsWithChildren<{ value: unknown; summaryNode?: React.ReactNode }>) {
  if (!value || typeof value !== 'object') {
    return (
      <>
        {summaryNode}
        {children}
      </>
    );
  }

  const [open] = useState(
    Boolean(
      Array.isArray(value) ||
        (value &&
          typeof value === 'object' &&
          (value as { type?: string }).type),
    ),
  );
  return (
    <details open={open} className="group open:details-content:inline">
      <summary className="inline cursor-pointer select-none before:content-['+'] before:text-green-600 before:me-2 [details[open]>&]:before:content-['-'] [details[open]>&]:before:text-red-600">
        {summaryNode}
        {(value as { type?: string }).type && (
          <span className="text-cyan-600">
            {(value as { type?: string }).type}&nbsp;
          </span>
        )}
        <span className="[details[open]>summary>&]:hidden">
          {Array.isArray(value) ? (
            <span className="text-neutral-400">Array[{value.length}]</span>
          ) : (
            <span className="text-neutral-400">
              {'{ '}
              <span className="italic">{Object.keys(value).join(', ')}</span>
              {' }'}
            </span>
          )}
          &nbsp;
        </span>
      </summary>
      {children}
    </details>
  );
}

function AstTreeItem({ value }: { value: unknown }) {
  return (
    <AstTreeCollapsible value={value}>
      <AstTreeValue value={value} />
    </AstTreeCollapsible>
  );
}

function AstTreeEntry({ entry: [key, value] }: { entry: [string, unknown] }) {
  return (
    <AstTreeCollapsible
      value={value}
      summaryNode={
        <>
          <span className="text-amber-700">{key}</span>
          <span className="text-neutral-400">:&nbsp;</span>
        </>
      }
    >
      <AstTreeValue value={value} />
    </AstTreeCollapsible>
  );
}

function AstTreeValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <>
        <span className="text-neutral-400">[</span>
        <ul className="ms-1 ps-5 border-s">
          {value.map((v, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: FIXME
            <li key={i}>
              <AstTreeItem value={v} />
            </li>
          ))}
        </ul>
        <span className="text-neutral-400">]</span>
      </>
    );
  }
  if (value && typeof value === 'object') {
    return (
      <span>
        <span className="text-neutral-400">{'{'}</span>
        <ul className="ms-1 ps-5 border-s">
          {Object.entries(value).map(([k, v]) => (
            <li key={k}>
              <AstTreeEntry entry={[k, v]} />
            </li>
          ))}
        </ul>
        <span className="text-neutral-400">{'}'}</span>
      </span>
    );
  }
  if (value == null) {
    return <span className="text-muted">{`${value}`}</span>;
  }
  return (
    <span
      className={cn(
        typeof value === 'number' ? 'text-blue-600' : 'text-green-600',
      )}
    >
      {JSON.stringify(value)}
    </span>
  );
}

const attributesToNodes = (attributes: Record<string, string>) => {
  const attribs = { ...attributes };
  const frag: React.ReactNode[] = [];
  if (attribs.id) {
    frag.push(
      <span key={'id'} className="text-blue-600">
        #{attribs.id}
      </span>,
    );
    delete attribs.id;
  }
  if (attribs.class) {
    frag.push(
      <span key={'class'} className="text-cyan-600">
        .{attribs.class.split(' ').join('.')}
      </span>,
    );
    delete attribs.class;
  }
  for (const key of Object.keys(attribs)) {
    if (key.startsWith('aria-') || key.startsWith('data-')) {
      continue;
    }
    frag.push(
      <span key={key}>
        [<span className="text-amber-700">{key}</span>=
        <span className="text-green-600">"{attribs[key]}"</span>]
      </span>,
    );
  }
  return frag.length === 0 ? null : (
    <>
      {'{'}
      {frag}
      {'}'}
    </>
  );
};
const htmlTreeParserOptions = {
  transform(reactNode, domNode, index) {
    if (isValidElement(reactNode) && domNode instanceof ElementNode) {
      const attribsNodes = attributesToNodes(domNode.attribs);

      if (['br', 'hr', 'img', 'input', 'meta', 'link'].includes(domNode.name)) {
        return (
          <div key={index} className="text-neutral-400">
            &lt;<span className="text-green-600">{domNode.name}</span>
            &nbsp;/&gt;
            {attribsNodes && <>&nbsp;{attribsNodes}</>}
          </div>
        );
      }
      return (
        <details key={index} open className="group open:details-content:inline">
          <summary className="inline cursor-pointer select-none text-neutral-400">
            &lt;<span className="text-green-600">{domNode.name}</span>
            <span className="[details[open]>summary>&]:hidden">&nbsp;/</span>
            &gt;
            {attribsNodes && <>&nbsp;{attribsNodes}</>}
          </summary>
          <ul className="ms-1 ps-5 border-s">
            {[reactNode].flat().map((n) => (
              <li key={n.key}>{n}</li>
            ))}
          </ul>
          <span className="text-neutral-400">
            &lt;/<span className="text-green-600">{domNode.name}</span>&gt;
          </span>
        </details>
      );
    }
    return reactNode as unknown as JSX.Element;
  },
  replace(domNode) {
    if (domNode instanceof ElementNode) {
      return (
        <div
          data-tag={domNode.name}
          data-attrib={JSON.stringify(domNode.attribs)}
        >
          {domToReact(domNode.children as ElementNode[], htmlTreeParserOptions)}
        </div>
      );
    }
  },
} satisfies HTMLReactParserOptions;

export function TiptapAstViewerPane() {
  const context = useContext(AstViewerContext);

  return (
    <Tabs
      value={context.selectingAstTab}
      onValueChange={(e) => context.onSelectingAstTabChange?.(e as AstTabType)}
      className="w-fit min-w-full"
    >
      <TabsList className="sticky top-0 right-0 self-end">
        <TabsTrigger value="tree">Tree</TabsTrigger>
        <TabsTrigger value="html">HTML</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
      <TabsContent value="tree" className="ps-2">
        <code className="text-sm">
          {context.editorAst ? (
            <AstTreeItem value={context.editorAst} />
          ) : undefined}
        </code>
      </TabsContent>
      <TabsContent value="html" className="ps-2">
        <code className="text-sm">
          {parseHtml(context.editorHtml || '', htmlTreeParserOptions)}
        </code>
      </TabsContent>
      <TabsContent value="json" className="ps-2">
        <pre className="text-xs">
          <code>
            {context.editorAst
              ? JSON.stringify(context.editorAst, null, 2)
              : ''}
          </code>
        </pre>
      </TabsContent>
    </Tabs>
  );
}

export function VfmAstViewerPane() {
  const context = useContext(AstViewerContext);
  const [json, setJson] = useState<unknown>();
  const [html, setHtml] = useState('');

  useEffect(() => {
    setJson(processor.parse(context.markdown));
    setHtml(processor.processSync(context.markdown).toString());
  }, [context.markdown]);

  return (
    <Tabs
      value={context.selectingAstTab}
      onValueChange={(e) => context.onSelectingAstTabChange?.(e as AstTabType)}
      className="w-fit min-w-full"
    >
      <TabsList className="sticky top-0 right-0 self-end">
        <TabsTrigger value="tree">Tree</TabsTrigger>
        <TabsTrigger value="html">HTML</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
      <TabsContent value="tree" className="ps-2">
        <code className="text-sm">
          {json ? <AstTreeItem value={json} /> : undefined}
        </code>
      </TabsContent>
      <TabsContent value="html" className="ps-2">
        <code className="text-sm">
          {parseHtml(html, htmlTreeParserOptions)}
        </code>
      </TabsContent>
      <TabsContent value="json" className="ps-2">
        <pre className="text-xs">
          <code>{json ? JSON.stringify(json, null, 2) : ''}</code>
        </pre>
      </TabsContent>
    </Tabs>
  );
}
