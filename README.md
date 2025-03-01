<div align="center">
  <a href="https://nextjs.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/modelence.png">
      <img alt="Modelence logo" src="assets/modelence.png" height="128">
    </picture>
  </a>
  <h1>Modelence</h1>

![Build Status](https://github.com/modelence/modelence/actions/workflows/build.yml/badge.svg)
<a href="https://www.npmjs.com/package/modelence"><img alt="NPM version" src="https://img.shields.io/npm/v/modelence.svg"></a>

</div>

Full-stack JavaScript framework for interactive web applications

## Dev Setup
Run `npm install` first to install packages.

Use `npm run dev` to keep rebuilding the package on every change for linking in local dev mode.

## App setup

- Create the following folder structure in your Node project:

```
src/
src/client/index.html
src/client/index.css
src/client/index.tsx
src/client/routes.ts
src/server/app.ts
```

- Install dependencies:

```
npm install --save modelence
npm install --save react react-dom react-router-dom
npm install --save-dev @types/react @types/react-dom
npm install --save-dev tsx nodemon
npm install --save-dev tailwindcss postcss autoprefixer
```

- Add the following scripts to your `package.json`:

```
"scripts": {
  "dev": "nodemon --exec tsx src/server/app.ts"
}
```

- Create a `tsconfig.json` file in the root of your project with the following content:
```json
{
  "compilerOptions": {
    "outDir": "./.modelence/build/",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "sourceMap": true,
    "noImplicitAny": true,
    "module": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "target": "ES2020",
    "lib": [
      "ES2020",
      "DOM",
      "WebWorker"
    ],
    "jsx": "react-jsx",
    "allowJs": true,
    "moduleResolution": "bundler",
    "strict": false,
    "noEmit": true,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [
      {
        "name": "next"
      }
    ]
  },
  "include": [
    "**/*.ts",
    "**/*.d.ts",
    "**/*.tsx"
  ],
  "exclude": [
    "node_modules"
  ]
}
```

Create a `tailwind.config.js` file in the root of your project with the following content:
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/client/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  darkMode: 'class',
}
```

Create a `postcss.config.js` file in the root of your project with the following content:
```js
/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    tailwindcss: {},
  },
};
```

## Documentation

[Documentation](https://docs.modelence.com) | [API Reference](https://docs.modelence.com/api-reference)

(For open-source contributors: To generate docs when developing locally, run `npm run docs`.)
