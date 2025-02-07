import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '#ui/theme-provider';
import { Preview } from './components/Preview';
import { routeTree } from './routeTree.gen';

/*
import '#ui/index.css';

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});
*/

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
      <ThemeProvider defaultTheme="system">
        {/*<RouterProvider router={router} />*/}
        <Preview />
      </ThemeProvider>
    </StrictMode>,
  );
}
