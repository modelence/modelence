# @modelence/aws-ses

AWS SES Adapter for modelence

## Installation

```bash
npm i @modelence/aws-ses
```

## Overview

This package provides `sendEmail` function that utilizes resend under the hood. The configuration can be set via Modelence Cloud or MODELENCE_EMAIL_SES_REGION, MODELENCE_EMAIL_SES_ACCESS_KEY_ID and MODELENCE_EMAIL_SES_SECRET_ACCESS_KEY environment variable.

## Usage

```ts
import { sendEmail } from '@modelence/aws-ses';

sendEmail({
  to: 'test@example.com',
  from: 'test@example.com',
  subject: 'Test Email',
  html: '<h1>Test Email</h1>',
})
```
