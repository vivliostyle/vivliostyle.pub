import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useSnapshot } from 'valtio';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#ui/dialog';
import { SidebarProvider, SidebarTrigger } from '#ui/sidebar';
import { $ui, type PaneContent } from '../stores/ui';
import { Pane } from './pane';
import { Sandbox } from './sandbox';
import { SideMenu } from './side-menu';

function DedicatedModal() {
  const router = useRouter();
  const uiSnap = useSnapshot($ui);
  const [open, setOpen] = useState(false);
  const [modalContent, setModalContent] = useState<PaneContent>();

  useEffect(() => {
    if (uiSnap.dedicatedModal) {
      setModalContent(uiSnap.dedicatedModal);
      setOpen(true);
    }
  }, [uiSnap.dedicatedModal]);

  useEffect(
    () =>
      router.subscribe('onBeforeLoad', ({ fromLocation, toLocation }) => {
        if (fromLocation.pathname !== toLocation.pathname) {
          setOpen(false);
          $ui.dedicatedModal = null;
        }
      }),
    [router.subscribe],
  );

  const closeModal = useCallback(
    (open: boolean) => {
      if (!open) {
        setOpen(false);
        router.history.back();
      }
    },
    [router.history.back],
  );

  const purgeModal = useCallback(() => {
    if (!uiSnap.dedicatedModal) {
      setModalContent(undefined);
    }
  }, [uiSnap.dedicatedModal]);

  return (
    modalContent && (
      <Dialog open={open} onOpenChange={closeModal}>
        <DialogContent className="max-w-4xl p-0" onAnimationEnd={purgeModal}>
          <div className="size-full max-h-svh overflow-auto grid gap-4 p-6">
            <DialogHeader>
              <DialogTitle>{modalContent.title()}</DialogTitle>
            </DialogHeader>

            <Pane content={modalContent} />
          </div>
        </DialogContent>
      </Dialog>
    )
  );
}

export function Layout(_: { children?: React.ReactNode }) {
  const uiSnap = useSnapshot($ui);

  return (
    <SidebarProvider>
      <SideMenu />
      <div className="size-full flex flex-col">
        <main className="relative size-full flex-1">
          <div className="absolute top-0 left-0 z-10 p-2">
            <SidebarTrigger className="size-8 cursor-pointer" />
          </div>
          <div className="size-full grid grid-flow-col auto-cols-fr">
            {uiSnap.tabs.map((tab) => (
              <Pane key={tab.id} content={tab} />
            ))}
          </div>
        </main>
      </div>

      <DedicatedModal />
      <Sandbox />
    </SidebarProvider>
  );
}
