import { EmailProvider } from "@modelence/types";

export type EmailConfig = {
  provider?: EmailProvider;
  from?: string;
  verification?: {
    subject?: string;
    template?: (props: {
      name: string;
      email: string;
      verificationUrl: string;
    }) => string;
    redirectUrl?: string;
  };
  // deprecated
  emailVerifiedRedirectUrl?: string;
};

let emailConfig: EmailConfig = Object.freeze({});

export function setEmailConfig(newEmailConfig: EmailConfig) {
  emailConfig = Object.freeze(Object.assign({}, emailConfig, newEmailConfig));
}

export function getEmailConfig() {
  return emailConfig;
}
