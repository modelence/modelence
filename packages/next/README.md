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
