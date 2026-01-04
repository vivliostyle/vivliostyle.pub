import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Link } from '@tanstack/react-router';
import type React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@v/ui/dropdown';
import {
  BookOpen,
  CirclePlus,
  MoreHorizontal,
  Palette,
  Printer,
} from '@v/ui/icon';
import { cn } from '@v/ui/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarSeparator,
} from '@v/ui/sidebar';
import VivliostyleLogo from '../assets/vivliostyle-logo.svg';
import { $content, $project, $projects } from '../stores/accessors';
import {
  createContentFile,
  deleteContentFile,
  moveContentFileInReadingOrder,
} from '../stores/actions/content-file';
import {
  exportEpub,
  exportProjectZip,
  exportWebPub,
} from '../stores/actions/export-project';
import { printPdf } from '../stores/actions/print-pdf';
import type {
  ContentId,
  HierarchicalReadingOrder,
} from '../stores/proxies/content';

const DraggingContentContext = createContext<ContentId | null>(null);

function AddNewFileButton({ children }: React.PropsWithChildren) {
  return (
    <SidebarMenuButton
      onClick={() => createContentFile({ format: 'markdown' })}
    >
      {children}
    </SidebarMenuButton>
  );
}

function ApplicationDropdownMenu({ children }: React.PropsWithChildren) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        <DropdownMenuItem asChild>
          <Link to="/preview">
            <Printer />
            <span>Open Print Preview</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem inset onClick={printPdf}>
          <span>Print PDF</span>
        </DropdownMenuItem>
        <DropdownMenuItem inset onClick={exportEpub}>
          <span>Export EPUB</span>
        </DropdownMenuItem>
        <DropdownMenuItem inset onClick={exportWebPub}>
          <span>Export Web Publication</span>
        </DropdownMenuItem>
        <DropdownMenuItem inset onClick={exportProjectZip}>
          <span>Export Vivliostyle Project files</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel
          inset
          className={cn('text-xs text-muted-foreground my-1')}
        >
          <p>Vivliostyle Pub Alpha</p>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectDropdownMenu({ children }: React.PropsWithChildren) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        <DropdownMenuItem asChild>
          <Link to="/bibliography">
            <BookOpen />
            <span>Bibliography</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/theme">
            <Palette />
            <span>Customize theme</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TopMenuSection() {
  const projectSnap = useSnapshot($project.valueOrThrow);
  return (
    <SidebarMenu>
      <div className={cn('flex items-center gap-0.5')}>
        <ApplicationDropdownMenu>
          <Button variant="ghost" size="icon" className={cn('h-10 w-10 p-2')}>
            <img src={VivliostyleLogo} alt="" />
            <div className="sr-only">Open workspace menu</div>
          </Button>
        </ApplicationDropdownMenu>
        <ProjectDropdownMenu>
          <SidebarMenuButton
            className={cn(
              'font-semibold px-0.5',
              !projectSnap.bibliography.title && 'text-muted-foreground',
            )}
          >
            <span>{projectSnap.bibliography.title || 'Untitled'}</span>
          </SidebarMenuButton>
        </ProjectDropdownMenu>
      </div>
    </SidebarMenu>
  );
}

function ContentMenuSection() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <AddNewFileButton>
          <CirclePlus />
          Add new file
        </AddNewFileButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function FileDropdownMenu({
  contentId,
  children,
}: React.PropsWithChildren<{ contentId: ContentId }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            deleteContentFile({ contentId });
          }}
        >
          <span>Delete file</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FileTreeItem({
  item,
  name,
  children,
  className,
  ...other
}: React.PropsWithChildren<
  React.ComponentProps<'li'> & {
    item: ContentId | HierarchicalReadingOrder;
    name: string;
  }
>) {
  const content = useSnapshot($content).valueOrThrow;
  const draggingContentId = useContext(DraggingContentContext);
  const sortable = typeof item === 'string' && useSortable({ id: item });

  const file = typeof item === 'string' ? content.files.get(item) : undefined;

  const Item = name === '.' ? SidebarMenuItem : SidebarMenuSubItem;

  return (
    <Item
      className="group/file-tree-item touch-manipulation"
      {...(sortable
        ? {
            ref: sortable.setNodeRef,
            style: {
              transform: sortable.transform
                ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
                : undefined,
              transition: sortable.transition,
              opacity: draggingContentId === item ? 0 : 1,
            },
            ...sortable.attributes,
            ...sortable.listeners,
          }
        : {})}
      {...other}
    >
      <SidebarMenuButton
        size="sm"
        variant={typeof item === 'string' ? 'default' : 'heading'}
        asChild
      >
        {file ? (
          <Link to="/edit/$" params={{ _splat: file.filename }} replace>
            <span className={cn(!file?.summary && 'text-muted-foreground')}>
              {file?.summary || 'Empty file'}
            </span>
          </Link>
        ) : (
          <span>{name}</span>
        )}
      </SidebarMenuButton>
      {typeof item === 'string' && (
        <FileDropdownMenu contentId={item}>
          <SidebarMenuAction className="opacity-0 group-hover/file-tree-item:opacity-100 group-has-[*:focus]/file-tree-item:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal aria-label="Open menu" />
          </SidebarMenuAction>
        </FileDropdownMenu>
      )}
      {children}
    </Item>
  );
}

function FileTreeDraggingItem() {
  const draggingContentId = useContext(DraggingContentContext);
  const content = useSnapshot($content).valueOrThrow;
  const file = draggingContentId && content.files.get(draggingContentId);

  if (!file) {
    return null;
  }
  return (
    <SidebarMenuItem>
      <div className="opacity-80 flex w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left bg-sidebar-accent text-sidebar-accent-foreground [&>span:last-child]:truncate text-sm min-h-7">
        <span className={cn(!file?.summary && 'text-muted-foreground')}>
          {file?.summary || 'Empty file'}
        </span>
      </div>
    </SidebarMenuItem>
  );
}

function FileTreeGroup({ tree }: { tree: HierarchicalReadingOrder }) {
  const [name, ...items] = tree;

  const children = items.map((item) => {
    if (item.length < 2) {
      return null;
    }
    const hasChildren = Array.isArray(item[1]);
    return (
      <FileTreeItem
        key={item[0]}
        name={item[0]}
        item={item[1] as ContentId | HierarchicalReadingOrder}
      >
        {hasChildren && (
          <FileTreeGroup tree={item as HierarchicalReadingOrder} />
        )}
      </FileTreeItem>
    );
  });

  return name === '.' ? (
    <SidebarMenu>{children}</SidebarMenu>
  ) : (
    <SidebarMenuSub size="sm">{children}</SidebarMenuSub>
  );
}

function FileTree() {
  const content = useSnapshot($content).valueOrThrow;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [draggingContentId, setDraggingContentId] = useState<ContentId | null>(
    null,
  );
  const onDragStart = useCallback(({ active }: DragStartEvent) => {
    setDraggingContentId(active.id as ContentId);
  }, []);
  const onDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    setDraggingContentId(null);
    if (over && active.id !== over.id) {
      moveContentFileInReadingOrder({
        fromContentId: [active.id as ContentId],
        toContentId: over.id as ContentId,
        fromDepth: 0,
        toDepth: 0,
      });
    }
  }, []);
  const onDragCancel = useCallback(() => {
    setDraggingContentId(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      {...{ onDragStart, onDragEnd, onDragCancel }}
    >
      <DraggingContentContext.Provider value={draggingContentId}>
        <SortableContext
          items={[...content.readingOrder]}
          strategy={verticalListSortingStrategy}
        >
          <FileTreeGroup
            tree={
              // @ts-ignore: Type instantiation is excessively deep and possibly infinite.
              content.hierarchicalReadingOrder as HierarchicalReadingOrder
            }
          />
        </SortableContext>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {draggingContentId && <FileTreeDraggingItem />}
          </DragOverlay>,
          document.body,
        )}
      </DraggingContentContext.Provider>
    </DndContext>
  );
}

export function SideMenu() {
  const projects = useSnapshot($projects);

  if (!projects.currentProjectId) {
    return <Sidebar />;
  }
  return (
    <Sidebar>
      <SidebarHeader>
        <TopMenuSection />
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <ContentMenuSection />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <FileTree />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
