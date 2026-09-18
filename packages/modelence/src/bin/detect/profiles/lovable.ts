import { withNote, type Profile } from '../types';

/*
  Projects exported from Lovable: a Vite + React site, often with Supabase.
  The conventions already build and serve it; what Lovable's environment
  provided is the Supabase connection, which the site reads at build time
  from VITE_* variables. Naming them here beats a blank page after deploy.
*/

export const lovableProfile: Profile = {
  name: 'lovable',
  matches: (facts) => 'lovable-tagger' in facts.dependencies,
  apply: (facts, draft) => {
    if (!('@supabase/supabase-js' in facts.dependencies)) {
      return draft;
    }
    return withNote(
      draft,
      'Lovable project using Supabase: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the environment variables (they are inlined at build time).'
    );
  },
};
