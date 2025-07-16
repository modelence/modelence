# @modelence/resend

[Resend](https://resend.com/) Adapter for Modelence

## Installation

```bash
npm i @modelence/resend
```

## Overview

This package provides `sendEmail` function that utilizes *Resend* under the hood. The configuration can be set via Modelence Cloud or MODELENCE_EMAIL_RESEND_API_KEY environment variable.

## Simple usage

```ts
import { sendEmail } from '@modelence/resend';

sendEmail({
  to: 'test@example.com',
  from: 'test@example.com',
  subject: 'Test Email',
  html: '<h1>Test Email</h1>',
})
```

## Advanced example

```tsx
import { sendEmail } from '@modelence/resend';

sendEmail({
  to: 'test@example.com',
  from: 'test@example.com',
  subject: 'Test Email',
  html: '<h1>Test Email</h1>',
  cc: 'test@example.com',
  bcc: 'test@example.com',
  attachments: [
    {
      name: "file.svg",
      content: "data:image/svg+xml;base64,...",
      contentType: "image/svg+xml"
    },
  ]
});
```