# @modelence/aws-ses

[SMTP](https://www.smtp.com/) Adapter for Modelence

## Installation

```bash
npm i @modelence/smtp
```

## Overview

This package provides `sendEmail` function that utilizes *SMTP protocol* under the hood. The configuration can be set via Modelence Cloud or the following environment variables:

- MODELENCE_EMAIL_SMTP_HOST
- MODELENCE_EMAIL_SMTP_PORT
- MODELENCE_EMAIL_SMTP_USER
- MODELENCE_EMAIL_SMTP_PASS


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
