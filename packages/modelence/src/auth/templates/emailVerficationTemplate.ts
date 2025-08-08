export function emailVerificationTemplate({ name, email, verificationUrl }: { name?: string; email: string; verificationUrl: string }) {
  return `
    <p>Hi${name ? ` ${name}` : ''},</p>
    <p>Please verify your email address ${email} by clicking the link below:</p>
    <p><a href="${verificationUrl}">${verificationUrl}</a></p>
    <p>If you did not request this, please ignore this email.</p>
  `;
}
