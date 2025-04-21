import { useSnapshot } from 'valtio';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#ui/dialog';
import { SidebarProvider, SidebarTrigger } from '#ui/sidebar';
import { ui } from '../stores/ui';
import { Pane } from './pane';
import { Sandbox } from './sandbox';
import { SideMenu } from './side-menu';

export function Layout(_: { children?: React.ReactNode }) {
  const uiSnap = useSnapshot(ui);

  return (
    <SidebarProvider>
      <SideMenu />
      <div className="size-full flex flex-col">
        <main className="relative size-full flex-1 overflow-auto overscroll-contain scrollbar-stable">
          <div className="absolute top-0 left-0 z-10 p-2">
            <SidebarTrigger className="size-8 cursor-pointer" />
          </div>
          <div className="size-full max-w-xl mx-auto">
            {uiSnap.tabs.map((tab) => (
              <Pane key={tab.id} content={tab} />
            ))}
          </div>
        </main>
      </div>

      {uiSnap.dedicatedModal && (
        <Dialog open>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Title</DialogTitle>
            </DialogHeader>

            <Pane content={uiSnap.dedicatedModal} />
          </DialogContent>
        </Dialog>
      )}

      <Sandbox />
    </SidebarProvider>
  );
}
