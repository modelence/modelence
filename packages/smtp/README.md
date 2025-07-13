# @modelence/aws-ses

SMTP Adapter for modelence

## Installation

```bash
npm i @modelence/smtp
```

## Overview

This package provides `sendEmail` function that utilizes SMTP protocol under the hood. The configuration can be set via Modelence Cloud or MODELENCE_EMAIL_SMTP_HOST, MODELENCE_EMAIL_SMTP_PORT, MODELENCE_EMAIL_SMTP_USER andMODELENCE_EMAIL_SMTP_PASS environment variable.

## Usage

```ts
import { sendEmail } from '@modelence/smtp';

sendEmail({
  to: 'test@example.com',
  from: 'test@example.com',
  subject: 'Test Email',
  html: '<h1>Test Email</h1>',
})
```
