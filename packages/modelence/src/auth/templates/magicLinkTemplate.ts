export function magicLinkTemplate({
  name,
  email,
  magicLinkUrl,
  code,
}: {
  name?: string;
  email: string;
  magicLinkUrl: string;
  code: string;
}) {
  return `
    <p>Hi${name ? ` ${name}` : ''},</p>
    <p>Click the link below to sign in as ${email}:</p>
    <p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p>
    <p>Or enter this one-time code in the app:</p>
    <p><strong style="font-size: 24px; letter-spacing: 4px;">${code}</strong></p>
    <p>The link and code can only be used once and will expire in 15 minutes.</p>
    <p>If you did not request this, please ignore this email.</p>
  `;
}
