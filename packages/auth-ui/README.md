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

### Basic Example
```tsx
import Link from 'next/link';
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

### With Post-Login Navigation

`LoginForm` does not perform any automatic navigation after a successful login. This is intentional to maintain framework independence. Use the `onSuccess` callback to handle post-login behavior:

```tsx
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LoginForm } from '@modelence/auth-ui';

function AuthPage() {
  const router = useRouter();

  return (
    <LoginForm 
      onSuccess={() => {
        router.push('/dashboard');
      }}
      renderSignupLink={({ className, children }) => (
        <Link href="/signup" className={className}>{children}</Link>
      )}
    />
  );
}
```

The `onSuccess` callback is invoked after email/password authentication succeeds. You can use it to:
- Navigate to a different page
- Show a success message
- Trigger analytics events
- Refresh user data

**Note:** Social authentication (Google, GitHub) handles redirects automatically via the OAuth flow and does not trigger the `onSuccess` callback.

## API Reference

### LoginForm Props

| Prop | Type | Description |
|------|------|-------------|
| `onSuccess` | `() => void` | Optional callback invoked after successful email/password login |
| `onSignup` | `() => void` | Optional callback when signup link is clicked |
| `onForgotPassword` | `() => void` | Optional callback when forgot password link is clicked |
| `renderSignupLink` | `LinkRenderer` | Optional custom renderer for the signup link |
| `renderForgotPasswordLink` | `LinkRenderer` | Optional custom renderer for the forgot password link |
| `className` | `string` | Custom className for the container |
| `cardClassName` | `string` | Custom className for the card |
| `buttonClassName` | `string` | Custom className for the login button |
| `buttonVariant` | `"default" \| "destructive" \| "outline" \| "secondary" \| "ghost" \| "link"` | Button style variant |
| `buttonSize` | `"default" \| "sm" \| "lg" \| "icon"` | Button size |
| `inputClassName` | `string` | Custom className for input fields |
| `labelClassName` | `string` | Custom className for labels |

## Customization

You can customize the appearance using className props:
```tsx
<LoginForm 
  className="my-custom-container"
  cardClassName="bg-gray-900 border-gray-700"
  buttonClassName="bg-green-600 hover:bg-green-700"
  inputClassName="bg-gray-800 border-gray-600 text-white"
  labelClassName="text-gray-300"
  buttonVariant="default"
  buttonSize="lg"
  renderSignupLink={({ className, children }) => (
    <Link href="/signup" className={className}>{children}</Link>
  )}
/>
```

## Framework Support

### Next.js (App Router)
```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LoginForm } from '@modelence/auth-ui';

export default function LoginPage() {
  const router = useRouter();

  return (
    <LoginForm 
      onSuccess={() => router.push('/dashboard')}
      renderSignupLink={({ className, children }) => (
        <Link href="/signup" className={className}>{children}</Link>
      )}
      renderForgotPasswordLink={({ className, children }) => (
        <Link href="/forgot-password" className={className}>{children}</Link>
      )}
    />
  );
}
```

### Next.js (Pages Router)
```tsx
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LoginForm } from '@modelence/auth-ui';

export default function LoginPage() {
  const router = useRouter();

  return (
    <LoginForm 
      onSuccess={() => router.push('/dashboard')}
      renderSignupLink={({ className, children }) => (
        <Link href="/signup" className={className}>{children}</Link>
      )}
    />
  );
}
```

### React Router
```tsx
import { Link, useNavigate } from 'react-router-dom';
import { LoginForm } from '@modelence/auth-ui';

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <LoginForm 
      onSuccess={() => navigate('/dashboard')}
      renderSignupLink={({ className, children }) => (
        <Link to="/signup" className={className}>{children}</Link>
      )}
    />
  );
}
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
