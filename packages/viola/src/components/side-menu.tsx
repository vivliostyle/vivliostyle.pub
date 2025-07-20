import { Link } from '@tanstack/react-router';
import type React from 'react';
import { useSnapshot } from 'valtio';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@v/ui/dropdown';
import { MoreHorizontal } from '@v/ui/icon';
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
} from '@v/ui/sidebar';
import {
  createContentFile,
  deleteContentFile,
} from '../stores/actions/content-file';
import {
  exportEpub,
  exportProjectZip,
  exportWebPub,
} from '../stores/actions/export-project';
import {
  $content,
  type ContentId,
  type HierarchicalReadingOrder,
} from '../stores/content';

function CreateNewFileButton() {
  return (
    <button
      type="button"
      onClick={() => createContentFile({ format: 'markdown' })}
    >
      Create a new file
    </button>
  );
}

function WorkspaceMenu() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton>
              <span className="font-semibold">Vivliostyle Pub</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem asChild>
              <Link to="/bibliography">
                <span>Bibliography</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/theme">
                <span>Customize theme</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={exportEpub}>
              <span>Export EPUB</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportWebPub}>
              <span>Export Web Publication</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportProjectZip}>
              <span>Export Vivliostyle Project files</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <CreateNewFileButton />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function FileMenu({
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
  const content = useSnapshot($content);

  const file = typeof item === 'string' ? content.files.get(item) : undefined;

  const Item = name === '.' ? SidebarMenuItem : SidebarMenuSubItem;

  return (
    <Item className="group/file-tree-item" {...other}>
      <SidebarMenuButton
        size="sm"
        variant={typeof item === 'string' ? 'default' : 'heading'}
        asChild
      >
        {typeof item === 'string' ? (
          <Link to="/edit/$contentId" params={{ contentId: item }} replace>
            <span className={cn(!file?.summary && 'text-muted-foreground')}>
              {file?.summary || 'Empty file'}
            </span>
          </Link>
        ) : (
          <span>{name}</span>
        )}
      </SidebarMenuButton>
      {typeof item === 'string' && (
        <FileMenu contentId={item}>
          <SidebarMenuAction className="opacity-0 group-hover/file-tree-item:opacity-100 group-has-[*:focus]/file-tree-item:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal aria-label="Open menu" />
          </SidebarMenuAction>
        </FileMenu>
      )}
      {children}
    </Item>
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
  const content = useSnapshot($content);

  return (
    <FileTreeGroup
      tree={
        (
          content as unknown as {
            hierarchicalReadingOrder: HierarchicalReadingOrder;
          }
        ).hierarchicalReadingOrder
      }
    />
  );
}

export function SideMenu() {
  return (
    <Sidebar>
      <SidebarHeader>
        <WorkspaceMenu />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <FileTree />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
