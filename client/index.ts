import React from 'react';
import { AppProvider as OriginalAppProvider } from './AppProvider';

export const AppProvider = 'useClient' in React
  // @ts-ignore: React.useClient only exists in Next.js
  ? React.useClient(OriginalAppProvider)
  : OriginalAppProvider;

export { useLoader } from './loader';
export { useSession } from './session';
