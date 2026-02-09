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

## 🚀 Showcase

See what you can build in just a few hours with Modelence's batteries-included approach:

<div align="center">
  <table>
    <tr>
      <td align="center">
        <a href="https://finchat.modelence.app/" target="_blank">
          <img src="/assets/finchat-preview.png" alt="FinChat" style="object-fit: cover; border-radius: 12px; box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15); transition: transform 0.2s ease, box-shadow 0.2s ease;" />
        </a>
        <br />
        <strong>FinChat</strong>
        <br />
        <small>AI-powered financial chat assistant</small>
      </td>
      <td align="center">
        <a href="https://smartrepos.modelence.app/" target="_blank">
          <img src="/assets/smartrepos-preview.png" alt="SmartRepos" style="object-fit: cover; border-radius: 12px; box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15); transition: transform 0.2s ease, box-shadow 0.2s ease;" />
        </a>
        <br />
        <strong>SmartRepos</strong>
        <br />
        <small>Intelligent repository management</small>
      </td>
      <td align="center">
        <a href="https://typesonic.modelence.app/" target="_blank">
          <img src="/assets/typesonic-preview.png" alt="TypeSonic" style="object-fit: cover; border-radius: 12px; box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15); transition: transform 0.2s ease, box-shadow 0.2s ease;" />
        </a>
        <br />
        <strong>TypeSonic</strong>
        <br />
        <small>Compete on typing speed</small>
      </td>
    </tr>
  </table>
</div>

## Getting Started
Modelence is an all-in-one TypeScript framework for startups shipping production apps, with the mission to eliminate all boilerplate for standard features that modern web applications need, like authentication, database setup, cron jobs, AI observability, email and more.

> **Prerequisites:** Modelence requires [Node.js 20.20](https://nodejs.org/en/download) or higher.


### Quick Start

#### 1. Create a new project
```bash
npx create-modelence-app@latest my-app
```

#### 2. Install dependencies
```bash
cd my-app
npm install
```

#### 3. Start the development server
```bash
npm run dev
```

Your app will be available at [http://localhost:3000](http://localhost:3000)


For a more detailed guide, check out the [Todo App tutorial](https://docs.modelence.com/tutorial).

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