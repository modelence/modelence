import React from 'react';

import { AppProvider as OriginalAppProvider } from './client/AppProvider';

export { getConfig } from './config/client';

export const AppProvider = 'useClient' in React
  // @ts-ignore: React.useClient only exists in Next.js
  ? React.useClient(OriginalAppProvider)
  : OriginalAppProvider;

export { renderApp } from './client/renderApp';
export { useLoader, callMethod } from './client/method';
export { useSession } from './client/session';
export { signupWithPassword, loginWithPassword, logout } from './auth/client';
