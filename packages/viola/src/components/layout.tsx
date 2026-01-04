import { useRouter } from '@tanstack/react-router';
import { invariant } from 'outvariant';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSnapshot } from 'valtio';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@v/ui/dialog';
import { SidebarProvider, SidebarTrigger } from '@v/ui/sidebar';
import { $ui } from '../stores/accessors';
import type { PaneContent } from '../stores/ui';
import { IframeSandbox } from './iframe-sandbox';
import { Pane, panes } from './pane';
import { PaneContext } from './panes/util';
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

  if (!modalContent) {
    return null;
  }

  const { type, ...props } = modalContent;
  const pane = panes[type];
  invariant(pane, 'Unknown pane: %s', type);

  type Props = PanePropertyMap[typeof type];
  const Title = pane.title as React.ComponentType<Props>;

  return (
    <PaneContext.Provider value={{ ...pane, props, hideTitle: true }}>
      <Dialog open={open} onOpenChange={closeModal}>
        <DialogContent className="max-w-4xl p-0" onAnimationEnd={purgeModal}>
          <div className="size-full max-h-svh overflow-auto grid gap-4 p-6">
            <DialogHeader>
              <DialogTitle>
                <Title {...props} />
              </DialogTitle>
            </DialogHeader>

            <Pane content={modalContent} />
          </div>
        </DialogContent>
      </Dialog>
    </PaneContext.Provider>
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
      <Suspense>
        <IframeSandbox />
      </Suspense>
    </SidebarProvider>
  );
}
