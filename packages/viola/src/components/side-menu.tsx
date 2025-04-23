import { Link } from '@tanstack/react-router';
import type React from 'react';
import { type Snapshot, ref, useSnapshot } from 'valtio';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#ui/dropdown';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '#ui/sidebar';
import { generateId } from '../libs/generate-id';
import {
  type ContentId,
  type HierarchicalReadingOrder,
  content,
  rootChar,
} from '../stores/content';
import { ui } from '../stores/ui';

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
              <Link to="/settings">
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function FileTreeGroup({ tree }: { tree: Snapshot<HierarchicalReadingOrder> }) {
  const [name, ...items] = tree;

  const children = items.map((item) => {
    if (item.length < 2) {
      return null;
    }
    const Item = name === rootChar ? SidebarMenuItem : SidebarMenuSubItem;
    const hasChildren = Array.isArray(item[1]);
    const select = () => {
      const id = item[1] as ContentId | HierarchicalReadingOrder;
      const tab = ui.tabs.at(0);
      if (
        typeof id !== 'string' ||
        (tab?.type === 'editor' && tab.contentId !== item[0])
      ) {
        return;
      }
      ui.tabs = [
        {
          id: generateId(),
          type: 'editor',
          contentId: id,
          title: ref(() => <>Editor</>),
        },
      ];
    };
    return (
      <Item key={item[0]}>
        <SidebarMenuButton
          size="sm"
          variant={hasChildren ? 'heading' : 'default'}
          asChild
        >
          <Link to="/" onClick={select}>
            <span>{item[0]}</span>
          </Link>
        </SidebarMenuButton>
        {hasChildren && (
          <FileTreeGroup tree={item as Snapshot<HierarchicalReadingOrder>} />
        )}
      </Item>
    );
  });

  return name === rootChar ? (
    <SidebarMenu>{children}</SidebarMenu>
  ) : (
    <SidebarMenuSub size="sm">{children}</SidebarMenuSub>
  );
}

function FileTree() {
  const { hierarchicalReadingOrder } = useSnapshot(content);

  return <FileTreeGroup tree={hierarchicalReadingOrder} />;
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
