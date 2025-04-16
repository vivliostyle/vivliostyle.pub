import { type Snapshot, useSnapshot } from 'valtio';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '#ui/sidebar';
import {
  type HierarchicalReadingOrder,
  content,
  rootChar,
} from '../stores/content';

function FileTreeGroup({ tree }: { tree: Snapshot<HierarchicalReadingOrder> }) {
  const [name, ...items] = tree;

  const children = items.map((item) => {
    if (item.length < 2) {
      return null;
    }
    const Item = name === rootChar ? SidebarMenuItem : SidebarMenuSubItem;
    const hasChildren = Array.isArray(item[1]);
    return (
      <Item key={item[0]}>
        <SidebarMenuButton
          size="sm"
          variant={hasChildren ? 'heading' : 'default'}
          asChild
        >
          <a href="#TODO">
            <span>{item[0]}</span>
          </a>
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
  console.log(JSON.parse(JSON.stringify(hierarchicalReadingOrder)));

  return <FileTreeGroup tree={hierarchicalReadingOrder} />;
}

export function SideMenu() {
  return (
    <Sidebar>
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
