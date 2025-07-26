import { EmailProvider } from "@modelence/types";

type EmailConfig = {
  provider?: EmailProvider;
  from?: string;
};

let emailConfig: EmailConfig = Object.freeze({});

export function setEmailConfig(newEmailConfig: EmailConfig) {
  emailConfig = Object.freeze(Object.assign({}, emailConfig, newEmailConfig));
}

export function getEmailConfig() {
  return emailConfig;
}
