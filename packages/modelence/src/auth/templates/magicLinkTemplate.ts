export function magicLinkTemplate({
  name,
  email,
  magicLinkUrl,
}: {
  name?: string;
  email: string;
  magicLinkUrl: string;
}) {
  return `
    <p>Hi${name ? ` ${name}` : ''},</p>
    <p>Click the link below to sign in as ${email}:</p>
    <p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p>
    <p>This link can only be used once and will expire in 15 minutes.</p>
    <p>If you did not request this, please ignore this email.</p>
  `;
}
