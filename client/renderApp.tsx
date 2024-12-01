import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from 'modelence/client';

export function renderApp({ loadingElement, routesElement }: { loadingElement: React.ReactNode, routesElement: React.ReactNode }) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProvider loadingElement={loadingElement}>
        <BrowserRouter>
          {routesElement}
        </BrowserRouter>
      </AppProvider>
    </React.StrictMode>
  )  
}

export { Routes, Route } from 'react-router-dom';