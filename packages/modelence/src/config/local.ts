import { AppConfig, ConfigSchema, ConfigType } from './types';

const localConfigMap = {
  MONGODB_URI: '_system.mongodbUri',
  MODELENCE_AUTH_GOOGLE_ENABLED: '_system.user.auth.google.enabled',
  MODELENCE_AUTH_GOOGLE_CLIENT_ID: '_system.user.auth.google.clientId',
  MODELENCE_AUTH_GOOGLE_CLIENT_SECRET: '_system.user.auth.google.clientSecret',
  MODELENCE_AUTH_GITHUB_ENABLED: '_system.user.auth.github.enabled',
  MODELENCE_AUTH_GITHUB_CLIENT_ID: '_system.user.auth.github.clientId',
  MODELENCE_AUTH_GITHUB_CLIENT_SECRET: '_system.user.auth.github.clientSecret',
  MODELENCE_AUTH_GITHUB_CLIENT_SCOPES: '_system.user.auth.github.scopes',
  MODELENCE_EMAIL_RESEND_API_KEY: '_system.email.resend.apiKey',
  MODELENCE_EMAIL_AWS_SES_REGION: '_system.email.awsSes.region',
  MODELENCE_EMAIL_AWS_SES_ACCESS_KEY_ID: '_system.email.awsSes.accessKeyId',
  MODELENCE_EMAIL_AWS_SES_SECRET_ACCESS_KEY: '_system.email.awsSes.secretAccessKey',
  MODELENCE_EMAIL_SMTP_HOST: '_system.email.smtp.host',
  MODELENCE_EMAIL_SMTP_PORT: '_system.email.smtp.port',
  MODELENCE_EMAIL_SMTP_USER: '_system.email.smtp.user',
  MODELENCE_EMAIL_SMTP_PASS: '_system.email.smtp.pass',
  MODELENCE_SITE_URL: '_system.site.url',
  MODELENCE_ENV: '_system.env',
  // deprecated
  GOOGLE_AUTH_ENABLED: '_system.user.auth.google.enabled',
  GOOGLE_AUTH_CLIENT_ID: '_system.user.auth.google.clientId',
  GOOGLE_AUTH_CLIENT_SECRET: '_system.user.auth.google.clientSecret',
};

function formatLocalConfigValue(value: string, type: ConfigType): string | number | boolean {
  if (type === 'number') {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      throw new Error(`Invalid number value for config: ${value}`);
    }
    return numValue;
  }
  if (type === 'boolean') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
    throw new Error(`Invalid boolean value for config: ${value}`);
  }
  return value;
}

export function getLocalConfigs(configSchema: ConfigSchema): AppConfig[] {
  const configs: AppConfig[] = [];

  for (const [envVar, configKey] of Object.entries(localConfigMap)) {
    const value = process.env[envVar];
    const configSchemaEntry = configSchema[configKey];
    if (value) {
      const type = configSchemaEntry?.type ?? 'string';
      configs.push({
        key: configKey,
        type: type,
        value: formatLocalConfigValue(value, type),
      });
    }
  }

  return configs;
}
