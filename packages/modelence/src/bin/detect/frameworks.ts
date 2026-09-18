import type { ProjectFacts } from './facts';
import { withNote, withWeb, type Detector, type Draft, type NamedDetector } from './types';

// Framework behavior is independent of which site builder generated the app.
// A client-only site (Vite, Lovable, CRA…): something to build, nothing to
// start. The runtime serves the build output itself.
export const staticSiteFromBuildOutput: Detector = (facts, draft) => {
  if (draft.spec.runtime === 'modelence' || !draft.spec.build?.command) {
    return draft;
  }
  // Scaffolds like Create React App and Angular ship a `start` script that
  // runs a development server, which an earlier detector took for the app's
  // process. A dev server is not something to deploy, so the build output
  // wins over it; a start script that runs anything else is left alone.
  const devServer = draft.spec.web?.start ? developmentServer(facts) : undefined;
  if (draft.spec.web?.start && !devServer) {
    return draft;
  }
  // A dev server is dropped even when the output directory turns out to be
  // undiscoverable, so an unusable process is never what gets deployed.
  const base = devServer ? withoutStart(draft) : draft;
  const unknownOutput = undiscoverableOutput(facts);
  if (unknownOutput) {
    return withNote(
      base,
      devServer ? `${devServerPrefix(devServer)} ${unknownOutput}` : capitalize(unknownOutput)
    );
  }
  const dir = staticOutputDirectory(facts);
  if (!dir) {
    return draft;
  }
  const mounted = withWeb(base, { static: [{ path: '/', dir }] });
  return withNote(
    mounted,
    devServer
      ? `${devServerPrefix(devServer)} the site is served from ${dir}/ with single-page app ` +
          'fallback instead. Set web.start in modelence.json to deploy a server process instead.'
      : `No start script found; the site is served from ${dir}/ with single-page app fallback.`
  );
};

function devServerPrefix(devServer: string): string {
  return `The \`start\` script runs ${devServer}, a development server, which is not deployed;`;
}

// Drops a start script without leaving the key set to undefined, which would
// survive serialization into modelence.json.
function withoutStart(draft: Draft): Draft {
  const { start: _dropped, ...web } = draft.spec.web ?? {};
  const { web: _removed, ...rest } = draft.spec;
  return {
    ...draft,
    spec: Object.keys(web).length === 0 ? rest : { ...rest, web },
  };
}

// Frameworks whose build output directory cannot be read from the files
// detection looks at, so it is asked for rather than guessed.
function undiscoverableOutput(facts: ProjectFacts): string | undefined {
  if (facts.viteOutputAmbiguous) {
    return (
      'could not determine Vite build.outDir safely; set web.static in modelence.json to the ' +
      'actual output directory.'
    );
  }
  // Angular writes to dist/<project>/browser, and the project name lives in
  // angular.json rather than package.json.
  if (facts.dependencies['@angular/cli']) {
    return (
      'this looks like an Angular app, whose build output directory is set in angular.json; ' +
      'set web.static in modelence.json to it (usually dist/<project>/browser).'
    );
  }
  return undefined;
}

// The dev-server command a `start` script runs, when that is all it does.
// Matched conservatively: a script that chains or wraps other work may be
// starting a real process, so it is left to the conventions.
function developmentServer(facts: ProjectFacts): string | undefined {
  const start = facts.scripts.start?.trim();
  if (!start || /[&|;><]/.test(start)) {
    return undefined;
  }
  const command = start.replace(/^(?:npx|pnpm exec|yarn exec|bunx)\s+/, '');
  const patterns: [RegExp, string][] = [
    [/^react-scripts\s+start\b/, '`react-scripts start`'],
    [/^ng\s+serve\b/, '`ng serve`'],
    [/^vite(?:\s+(?:dev|serve))?$/, '`vite`'],
    [/^astro\s+dev\b/, '`astro dev`'],
    [/^parcel\s+(?!build\b)/, '`parcel`'],
  ];
  return patterns.find(([pattern]) => pattern.test(command))?.[1];
}

function staticOutputDirectory(facts: ProjectFacts): string | undefined {
  if (facts.dependencies.vite || facts.hasViteConfig) {
    return facts.viteOutDir ?? 'dist';
  }
  if (facts.dependencies['react-scripts']) {
    return 'build';
  }
  if (facts.dependencies.astro) {
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

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
