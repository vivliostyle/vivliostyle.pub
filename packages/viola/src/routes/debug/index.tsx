import { createFileRoute, Link } from '@tanstack/react-router';

type DebugPage = {
  to: string;
  title: string;
  description: string;
};

const debugPages: DebugPage[] = [
  {
    to: '/debug/ast-viewer',
    title: 'AST Viewer',
    description:
      'Inspect TipTap ProseMirror and VFM AST/HTML side-by-side for a markdown + CSS pair.',
  },
  {
    to: '/debug/indexeddb-persistence',
    title: 'IndexedDB Persistence',
    description:
      'Minimal editor bound to a Yjs doc + y-indexeddb, with a live log of every persisted update entry.',
  },
];

export const Route = createFileRoute('/debug/')({
  component: DebugIndexView,
});

function DebugIndexView() {
  return (
    <div className="size-full overflow-auto p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-semibold">Debug pages</h1>
        <p className="mb-6 text-muted-foreground text-sm">
          Internal tools for inspecting editor and persistence behaviour.
        </p>
        <ul className="flex flex-col gap-3">
          {debugPages.map((page) => (
            <li key={page.to}>
              <Link
                to={page.to}
                className="block rounded-md border border-neutral-300 px-4 py-3 transition-colors hover:bg-accent"
              >
                <div className="font-medium">{page.title}</div>
                <div className="text-muted-foreground text-xs font-mono">
                  {page.to}
                </div>
                <p className="mt-1 text-sm">{page.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
