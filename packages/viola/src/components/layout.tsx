import { SidebarProvider, SidebarTrigger } from '#ui/sidebar';
import { Editor } from '../components/editor';
import { SideMenu } from './side-menu';

export function Layout() {
  return (
    <SidebarProvider>
      <SideMenu />
      <main className="relative size-full">
        <div className="absolute top-0 left-0 z-10 p-2">
          <SidebarTrigger className="size-8 cursor-pointer" />
        </div>
        <div className="h-full max-w-xl mx-auto">
          <Editor />
        </div>
        {/* <div className="h-screen">
          <Preview />
        </div> */}
      </main>
    </SidebarProvider>
  );
}
