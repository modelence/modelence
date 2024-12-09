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
npm install --save-dev tsx nodemon
```

- Add the following scripts to your `package.json`:

```
"scripts": {
  "dev": "nodemon --exec tsx src/server/app.ts"
}
```
