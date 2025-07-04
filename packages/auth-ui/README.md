# @modelence/auth-ui

Authentication UI components for Modelence.

## Installation

```sh
npm install @modelence/auth-ui
```

## Setup

Add this package to your `tailwind.config.js` content paths:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    ...,
    "./node_modules/@modelence/auth-ui/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

That's it! The components use standard Tailwind classes and will work with your existing Tailwind setup.

## Usage

```tsx
import { LoginForm } from '@modelence/auth-ui';

function AuthPage() {
  return (
    <LoginForm 
      renderSignupLink={({ className, children }) => (
        <Link href="/signup" className={className}>{children}</Link>
      )}
    />
  );
}
```

## Customization

You can customize the appearance using className props:

```tsx
<LoginForm 
  className="my-custom-container"
  cardClassName="bg-gray-900 border-gray-700"
  buttonClassName="bg-green-600 hover:bg-green-700"
  inputClassName="bg-gray-800 border-gray-600 text-white"
  labelClassName="text-gray-300"
  renderSignupLink={({ className, children }) => (
    <Link href="/signup" className={className}>{children}</Link>
  )}
/>
```

## Framework Support

This library is framework-agnostic but includes special support for navigation:

### Next.js

```tsx
import Link from 'next/link';
import { LoginForm } from '@modelence/auth-ui';

<LoginForm 
  renderSignupLink={({ className, children }) => (
    <Link href="/signup" className={className}>{children}</Link>
  )}
/>
```

### React Router

```tsx
import { Link } from 'react-router-dom';
import { LoginForm } from '@modelence/auth-ui';

<LoginForm 
  renderSignupLink={({ className, children }) => (
    <Link to="/signup" className={className}>{children}</Link>
  )}
/>
```

## Development

To build the package:

```sh
npm run build
```

To watch for changes during development:

```sh
npm run dev
```
