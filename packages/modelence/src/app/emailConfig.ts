import type { EmailProvider } from '../types';

export type EmailConfig = {
  provider?: EmailProvider;
  from?: string;
  verification?: {
    subject?: string;
    template?: (props: { name: string; email: string; verificationUrl: string }) => string;
    redirectUrl?: string;
  };
  passwordReset?: {
    subject?: string;
    template?: (props: { name: string; email: string; resetUrl: string }) => string;
    redirectUrl?: string;
  };
  magicLink?: {
    subject?: string;
    /**
     * Custom email template. Receives both credentials for the sign-in:
     * `magicLinkUrl` (the clickable link) and `code` (the typed one-time
     * code for `loginWithOneTimeCode`) — render either or both.
     */
    template?: (props: {
      name: string;
      email: string;
      magicLinkUrl: string;
      code: string;
    }) => string;
    /** SPA page the landing route redirects to; it must call `loginWithMagicLink()`. */
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
