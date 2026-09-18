import type { ProjectFacts } from './facts';
import { withNote, withWeb, type Detector, type NamedDetector } from './types';

// Framework behavior is independent of which site builder generated the app.
// A client-only site (Vite, Lovable, CRA…): something to build, nothing to
// start. The runtime serves the build output itself.
export const staticSiteFromBuildOutput: Detector = (facts, draft) => {
  if (draft.spec.web?.start || draft.spec.runtime === 'modelence' || !draft.spec.build?.command) {
    return draft;
  }
  if (facts.viteOutputAmbiguous) {
    return withNote(
      draft,
      'Could not determine Vite build.outDir safely; set web.static in modelence.json to the actual output directory.'
    );
  }
  const dir = staticOutputDirectory(facts);
  if (!dir) {
    return draft;
  }
  const mounted = withWeb(draft, { static: [{ path: '/', dir }] });
  return withNote(
    mounted,
    `No start script found; the site is served from ${dir}/ with single-page app fallback.`
  );
};

function staticOutputDirectory(facts: ProjectFacts): string | undefined {
  if (facts.dependencies.vite || facts.hasViteConfig) {
    return facts.viteOutDir ?? 'dist';
  }
  if (facts.dependencies['react-scripts']) {
    return 'build';
  }
  if (facts.dependencies['@angular/cli'] || facts.dependencies.astro) {
    return 'dist';
  }
  // A root index.html with a build script is the Vite/Parcel convention.
  if (facts.hasIndexHtml) {
    return 'dist';
  }
  return undefined;
}

export const FRAMEWORKS: NamedDetector[] = [
  { name: 'framework build output', apply: staticSiteFromBuildOutput },
];
