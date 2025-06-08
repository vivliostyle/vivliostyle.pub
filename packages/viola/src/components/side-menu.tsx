import { Link } from '@tanstack/react-router';
import { type Snapshot, useSnapshot } from 'valtio';
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
import { createContentFile } from '../stores/actions/content-file';
import { $content, type HierarchicalReadingOrder } from '../stores/content';

function CreateNewFileButton() {
  return (
    <button type="button" onClick={() => createContentFile({ format: 'html' })}>
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
              <Link to="/theme">
                <span>Customize theme</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <span>Settings</span>
              </Link>
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

function FileTreeGroup({ tree }: { tree: HierarchicalReadingOrder }) {
  const [name, ...items] = tree;

  const children = items.map((item) => {
    if (item.length < 2) {
      return null;
    }
    const Item = name === '.' ? SidebarMenuItem : SidebarMenuSubItem;
    const hasChildren = Array.isArray(item[1]);
    return (
      <Item key={item[0]}>
        <SidebarMenuButton
          size="sm"
          variant={hasChildren ? 'heading' : 'default'}
          asChild
        >
          {typeof item[1] === 'string' ? (
            <Link to="/edit/$contentId" params={{ contentId: item[1] }} replace>
              <span>{item[0]}</span>
            </Link>
          ) : (
            <span>{item[0]}</span>
          )}
        </SidebarMenuButton>
        {hasChildren && (
          <FileTreeGroup tree={item as HierarchicalReadingOrder} />
        )}
      </Item>
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
      tree={content.hierarchicalReadingOrder as HierarchicalReadingOrder}
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
