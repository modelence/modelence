import type { EmailPayload, EmailProvider } from '../types';
import { callCloudApi } from './backendApi';

interface ManagedEmailSendResponse {
  messageId: string;
  isOverage: boolean;
  acceptedRecipients: string[];
}

interface ManagedEmailErrorBody {
  error?: { code?: string; message?: string };
}

// Studio's /api/email/send only accepts a curated subset of fields. The
// sender domain is enforced server-side (locked to a Modelence-owned
// subdomain in v1), so we drop the address half of `from` and forward only
// the friendly name. cc/bcc/attachments/headers are not yet supported by the
// relay — surfaced as a clear error before the network call.
function extractFromName(from: string | undefined): string | undefined {
  if (!from) return undefined;
  const match = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return match?.[1]?.trim();
}

function normalizeAddressList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

function buildRequestBody(payload: EmailPayload) {
  return {
    to: Array.isArray(payload.to) ? payload.to : [payload.to],
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    fromName: extractFromName(payload.from),
    replyTo: normalizeAddressList(payload.replyTo),
  };
}

function describeManagedEmailError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error('Managed email send failed');
  }
  const body = (error as Error & { responseBody?: ManagedEmailErrorBody }).responseBody;
  const code = body?.error?.code;
  const message = body?.error?.message;
  if (code && message) {
    return new Error(`Managed email rejected (${code}): ${message}`);
  }
  return error;
}

export const managedEmailProvider: EmailProvider = {
  async sendEmail(payload: EmailPayload): Promise<void> {
    if (payload.cc || payload.bcc || payload.attachments || payload.headers) {
      throw new Error(
        'Modelence managed email does not support cc, bcc, attachments, or custom headers in v1. ' +
          'Configure your own provider (Resend, SES, SMTP) to use these features. ' +
          'See https://docs.modelence.com/email/managed.'
      );
    }

    try {
      await callCloudApi<ManagedEmailSendResponse>(
        '/api/email/send',
        'POST',
        buildRequestBody(payload)
      );
    } catch (error) {
      throw describeManagedEmailError(error);
    }
  },
};
