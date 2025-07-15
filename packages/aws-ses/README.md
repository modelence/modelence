# @modelence/aws-ses

[AWS SES](https://aws.amazon.com/ses/) Adapter for Modelence

## Installation

```bash
npm i @modelence/aws-ses
```

## Overview

This package provides `sendEmail` function that utilizes *Amazon SES* under the hood. The configuration can be set via Modelence Cloud or the following environment variables:

- MODELENCE_EMAIL_AWS_SES_REGION
- MODELENCE_EMAIL_AWS_SES_ACCESS_KEY_ID
- MODELENCE_EMAIL_AWS_SES_SECRET_ACCESS_KEY

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
