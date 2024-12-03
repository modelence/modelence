import React from 'react';

import { AppProvider as OriginalAppProvider } from './client/AppProvider';

export { getConfig } from './config/client';

export const AppProvider = 'useClient' in React
  // @ts-ignore: React.useClient only exists in Next.js
  ? React.useClient(OriginalAppProvider)
  : OriginalAppProvider;

export { useNavigate } from 'react-router-dom';
export { renderApp, Routes, Route } from './client/renderApp';
export { useLoader } from './client/method';
export { useSession } from './client/session';
export { signupWithPassword } from './auth/client/signup';
