import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import { ThemeProvider } from '@v/ui/theme-provider';
import './libs/polyfills';
import { routeTree } from './routeTree.gen';
import { restoreSession } from './stores/actions/session';
import './main.css';

// Kick off auth restoration as soon as the app boots so the sidebar's
// signed-in state is populated by the time the first route renders.
restoreSession();

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('app');
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <ThemeProvider defaultTheme="light">
        <RouterProvider router={router} />
      </ThemeProvider>
    </StrictMode>,
  );
}
