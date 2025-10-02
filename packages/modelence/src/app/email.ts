import { getEmailConfig } from "@/app/emailConfig";
import { EmailPayload } from "@modelence/types";

export function sendEmail(payload: EmailPayload) {
  if (!getEmailConfig().provider) {
    throw new Error('Email provider is not configured, see https://docs.modelence.com/email-configuration for more details.');
  }
  return getEmailConfig().provider?.sendEmail(payload);
}
