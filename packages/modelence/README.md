<div align="center">
  <a href="https://modelence.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="/packages/modelence/static/modelence.png" />
      <img alt="Modelence logo" src="/packages/modelence/static/modelence.png" height="128" />
    </picture>
  </a>
  <h1>
    Modelence<br />
  <img alt="Y Combinator S25" src="https://img.shields.io/badge/Combinator-S25-orange?logo=ycombinator&labelColor=white" />
  </h1>
  
  [Website](https://modelence.com) | [Documentation](https://docs.modelence.com) | [API Reference](https://docs.modelence.com/api-reference) | [Modelence Cloud](https://cloud.modelence.com)

  ![Build Status](https://github.com/modelence/modelence/actions/workflows/build.yml/badge.svg)
  <a href="https://www.npmjs.com/package/modelence"><img alt="NPM version" src="https://img.shields.io/npm/v/modelence.svg" /></a>
  [![Discord](https://img.shields.io/discord/1386659657535455253?label=Discord&logo=discord&logoColor=white&labelColor=5865F2&cacheSeconds=30)](https://discord.gg/ghxu5PDnkZ)
</div>

Modelence is a full-stack framework for building and running production web applications, with built-in authentication, database setup, scheduled jobs, monitoring and more.

## Example Projects

Visit https://cloud.modelence.com/showcase to see examples of what users have built with Modelence.

## Getting Started

The fastest way to create an application is through the App Builder:
1. Go to https://cloud.modelence.com
1. Describe the app you want to build
1. Submit your prompt - the App Builder will generate and deploy your app

That’s it. No setup, no CLI, no configuration required.

For a more detailed guide, check out the [Quick Start](https://docs.modelence.com/quickstart) section in our documentation.

---

### Local Development (Modelence Framework)

If you want to contribute to Modelence itself (not just use it in an application), follow the steps below.

#### 1. Clone the repository
```bash
git clone https://github.com/modelence/modelence.git
cd modelence
```

#### 2. Install dependencies for the core package
```bash
cd packages/modelence
npm install
```

#### 3. Build the package
```bash
npm run build
```

This generates the `dist/` directory required for local usage.

#### 4. (Optional) Watch for changes during development
```bash
npm run dev
```

This runs the build in watch mode and rebuilds on file changes.

> **Note**
>
> If you encounter dependency or build errors while developing Modelence locally, a clean install may help:
>
> ```bash
> rm -rf node_modules package-lock.json
> npm install
> npm run build
> ```
>
> This resets the local dependency state and mirrors the workflow often recommended when resolving local development issues.
> The regenerated `package-lock.json` is only for local development and should not be committed as part of a PR unless explicitly requested.

### Using the local build in a test app

To test your local Modelence changes inside a real application:
```bash
npx create-modelence-app@latest my-app
cd my-app
```

Update `package.json` to point to your local Modelence package:
```json
{
  "dependencies": {
    "modelence": "../modelence/packages/modelence"
  }
}
```

Then reinstall dependencies and start the app:
```bash
npm install
npm run dev
```

Your application will now use your local Modelence build.

---

### Examples

For more examples on how to use Modelence, check out https://github.com/modelence/examples