---
sidebar_position: 1
---

# Quick Start

Modelence applications are primarily relying on [Modelence Studio](https://studio.modelence.com), which serves as an admin dashboard for managing your applications. However, you can also start with an offline setup with limited functionality such as static hardcoded configs.

## Getting Started

Get started by **creating a new project**.

### Prerequisites

- [Node.js](https://nodejs.org/en/download/) version 18.0 or above
  - When installing Node.js, make sure to check all checkboxes related to dependencies
  - Node.js installation includes NPM (Node Package Manager) which is required
  - You can verify your installation by running:
    ```bash
    node --version
    npm --version
    ```

If you see version numbers displayed for both commands, you're ready to start building with Modelence!

## Creating a new project

You can create a new Modelence project using the `create-modelence-app` npx command.

```bash
npx create-modelence-app my-app
```

This command will create a new directory named `my-app` with the necessary files and folders for your project.

## Project structure

The project structure for a Modelence app is as follows:

```
my-app/
├── src/
│   ├── client/
│   │   ├── index.html
│   │   ├── index.css
│   │   ├── index.tsx
│   │   ├── routes.ts
│   ├── server/
│   │   ├── app.ts
│   ├── .env
```

- `src/client/index.html`: The main HTML template for your application. You usually don't need to edit this file.
- `src/client/index.css`: Global CSS styles, including Tailwind CSS configuration.
- `src/client/index.tsx`: Entry point for your React frontend where you initialize the client app.
- `src/client/routes.ts`: Define your client-side routes and their corresponding components.
- `src/server/app.ts`: Server entry point where you configure your backend modules and start the server.
- `.env`: Environment variables for your application (for example Modelence Studio tokens)

:::tip
All client-side code goes in the `src/client` directory, while server-side code belongs in `src/server`. Modelence uses a clear separation between client and server code to help maintain a clean architecture. You can also use any other directories at the same level as `src/client` and `src/server` for shared code between client and server.
:::

## Start your application

Install the dependencies:

```bash
cd my-app
npm install
```

Run the development server:

```bash
npm run dev
```

The `npm run dev` command builds your website locally and serves it through a Vite development server, ready for you to view at http://localhost:3000/ (or the port you specified in the `.env` file).
