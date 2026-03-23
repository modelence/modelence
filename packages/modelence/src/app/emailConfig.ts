import type { EmailProvider } from '../types';

export type EmailConfig = {
  provider?: EmailProvider;
  from?: string;
  verification?: {
    subject?: string;
    template?: (props: { name: string; email: string; verificationUrl: string }) => string;
    redirectUrl?: string;
    /**
     * Path to a client-side page that handles email verification (e.g. `/verify-email`).
     * When set, the email link goes to this page with `?token=<token>` and the page should
     * call `verifyEmail({ token })` to verify the email and automatically sign the user in.
     * When not set, verification is handled server-side via the built-in API route.
     */
    clientPageUrl?: string;
  };
  passwordReset?: {
    subject?: string;
    template?: (props: { name: string; email: string; resetUrl: string }) => string;
    redirectUrl?: string;
  };
  // @deprecated use verification.redirectUrl instead
  emailVerifiedRedirectUrl?: string;
};

let emailConfig: EmailConfig = Object.freeze({});

export function setEmailConfig(newEmailConfig: EmailConfig) {
  emailConfig = Object.freeze(Object.assign({}, emailConfig, newEmailConfig));
}

export function getEmailConfig() {
  return emailConfig;
}
