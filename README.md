# Modelence

Full-stack JavaScript framework for interactive applications

# App setup

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
    "outDir": "./.modelence/",
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
