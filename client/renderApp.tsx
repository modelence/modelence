import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from 'modelence/client';

export function renderApp({ loadingElement, routesElement, favicon }: {
  loadingElement: React.ReactNode,
  routesElement: React.ReactNode,
  favicon?: string
}) {
  window.addEventListener('unload', () => {
    // The presence of any 'unload' event handler, even empty,
    // prevents bfcache in most browsers
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProvider loadingElement={loadingElement}>
        <BrowserRouter>
          {routesElement}
        </BrowserRouter>
      </AppProvider>
    </React.StrictMode>
  );

  if (favicon) {
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) {
      const newLink = document.createElement('link');
      newLink.rel = 'icon';
      newLink.href = favicon;
      document.head.appendChild(newLink);
    } else {
      link.href = favicon;
    }
  }
}

export { Routes, Route } from 'react-router-dom';