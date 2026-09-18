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
  // wins over it; a start script that runs anything else is left alone. What
  // is inspected is the command behind web.start, which may come from a
  // Procfile or a workspace member rather than the root `start` script.
  const devServer = draft.spec.web?.start ? developmentServer(draft.startScript) : undefined;
  if (draft.spec.web?.start && !devServer) {
    return draft;
  }
  // A dev server is dropped even when the output directory turns out to be
  // undiscoverable, so an unusable process is never what gets deployed.
  const base = devServer ? withoutStart(draft) : draft;
  // A dev server started in a workspace member builds into that member's
  // directory, so the whole question is scoped to it.
  const owner = devServer ? draft.startMember : undefined;
  const unknownOutput = undiscoverableOutput(owner ?? facts);
  if (unknownOutput) {
    return withNote(
      base,
      devServer ? `${devServerPrefix(devServer)} ${unknownOutput}` : capitalize(unknownOutput)
    );
  }
  const ownDir = staticOutputDirectory(owner ?? facts);
  const dir = ownDir && owner ? `${owner.dir}/${ownDir}` : ownDir;
  if (!dir) {
    // Still without the dev server: deploying one is worse than deploying
    // nothing, and the fallback note then asks for a web.start.
    return base;
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
function undiscoverableOutput(facts: OutputFacts): string | undefined {
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

// The dev-server command the chosen start command runs, when that is all it
// does. Matched conservatively: a command that chains or wraps other work may
// be starting a real process, so it is left to the conventions.
function developmentServer(startScript: string | undefined): string | undefined {
  const start = startScript?.trim();
  if (!start || /[&|;><]/.test(start)) {
    return undefined;
  }
  const command = start.replace(/^(?:npx|pnpm exec|yarn exec|bunx)\s+/, '');
  const patterns: [RegExp, string][] = [
    [/^react-scripts\s+start\b/, '`react-scripts start`'],
    [/^ng\s+serve\b/, '`ng serve`'],
    // Bare `vite`, or `vite dev`/`vite serve`, each with any flags after it.
    // `vite preview` serves a production build, so it is not matched.
    [/^vite(?:\s+(?:dev|serve))?(?:\s+-|$)/, '`vite`'],
    [/^astro\s+dev\b/, '`astro dev`'],
    [/^parcel\s+(?!build\b)/, '`parcel`'],
  ];
  return patterns.find(([pattern]) => pattern.test(command))?.[1];
}

function staticOutputDirectory(facts: OutputFacts): string | undefined {
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

// The fields that decide a build output directory. A workspace member carries
// the same ones, so the questions below are asked of whichever package owns
// the build — except for index.html, which is only read at the root.
type OutputFacts = Pick<
  ProjectFacts,
  'dependencies' | 'hasViteConfig' | 'viteOutDir' | 'viteOutputAmbiguous'
> &
  Partial<Pick<ProjectFacts, 'hasIndexHtml'>>;

export const FRAMEWORKS: NamedDetector[] = [
  { name: 'framework build output', apply: staticSiteFromBuildOutput },
];

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
