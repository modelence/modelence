import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from '../client';
import { setErrorHandler, ErrorHandler } from './errorHandler';

export function renderApp({ loadingElement, routesElement, favicon, errorHandler }: {
  loadingElement: React.ReactNode,
  routesElement: React.ReactNode,
  favicon?: string,
  errorHandler?: ErrorHandler
}) {
  if (errorHandler) {
    setErrorHandler(errorHandler);
  }

  window.addEventListener('unload', () => {
    // The presence of any 'unload' event handler, even empty,
    // prevents bfcache in most browsers
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProvider loadingElement={loadingElement}>
        {routesElement}
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
