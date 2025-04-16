import { useSnapshot } from 'valtio';
import { SidebarProvider, SidebarTrigger } from '#ui/sidebar';
import { Editor } from '../components/editor';
import { ui } from '../stores/ui';
import { Preview } from './preview';
import { Sandbox, sandboxOrigin } from './sandbox';
import { SideMenu } from './side-menu';

export function Layout() {
  const tabs = useSnapshot(ui.tabs);

  return (
    <SidebarProvider>
      <SideMenu />
      <div className="size-full flex flex-col">
        <main className="relative size-full flex-1 overflow-auto overscroll-contain scrollbar-stable">
          <div className="absolute top-0 left-0 z-10 p-2">
            <SidebarTrigger className="size-8 cursor-pointer" />
          </div>
          <div className="size-full max-w-xl mx-auto">
            {tabs.map((tab) => {
              if (tab.type === 'editor') {
                return <Editor key={tab.id} {...tab} />;
              }
              if (tab.type === 'preview') {
                return (
                  <div key={tab.id} className="h-full">
                    <Preview origin={sandboxOrigin} />
                  </div>
                );
              }
            })}
          </div>
        </main>
      </div>
      <Sandbox />
    </SidebarProvider>
  );
}
