# @modelence/next

Next.js integration for the Modelence framework.

## Installation
Make sure you have both Modelence and the Modelence Next.js adapter installed.
```sh
npm install --save modelence @modelence/next
```

## Usage

Create a `src/server/app.ts` file with the following contents:

```tsx
import { startApp } from 'modelence/server';
import { nextServer } from '@modelence/next';

startApp({
  server: nextServer
});
```

Create a `modelence.config.ts` file with the following contents:
```ts
const modelenceConfig = {
  serverDir: './src/server',
  serverEntry: 'app.ts',
  postBuildCommand: 'npm run build:next'
};

export default modelenceConfig;
```

Adjust your `package.json`
- Add `"type": "module"` to the `package.json` file
- Change the dev script from `next dev` to `modelence dev`
- Change the build script from `next build` to `modelence build`
- Add a new script called `build:next` (to match the `postBuildCommand` you used in modelence config) and set the value to `next build`

Add the following lines to `.gitignore` to ignore Modelence build dir and env files:
- `.modelence`
- `.modelence.env`
- `.modelence.*.env`

## Optimizing for Production Deployments

To enable optimized production deployments with Next.js standalone mode, update your `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone mode for optimized production deployments
  // This creates a minimal deployment with only required dependencies
  output: 'standalone',

  // Disable production source maps to reduce bundle size (optional)
  productionBrowserSourceMaps: false,

  // Enable compression for better performance (optional)
  compress: true,
};

export default nextConfig;
```

### Benefits of Standalone Mode

When you enable `output: 'standalone'` in your Next.js config:

- ✅ **Smaller bundle size**: Only necessary dependencies are included
- ✅ **Faster deployments**: Less data to upload and extract
- ✅ **Optimized cold starts**: Minimal overhead when starting the server
- ✅ **Automatic dependency tracing**: Next.js traces exactly which files are needed

The Modelence deploy command automatically detects standalone builds and bundles them efficiently.
