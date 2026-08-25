import { AppConfig, ConfigSchema, ConfigType } from './types';

type LocalConfigVariant = 'withRemoteServer' | 'withoutRemoteServer';

const localConfigMap = {
  withoutRemoteServer: {
    MONGODB_URI: '_system.mongodbUri',
    MONGODB_POOL_SIZE: '_system.mongodbPoolSize',
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
    MODELENCE_ENV_TYPE: '_system.env.type',
    MODELENCE_MULTI_INSTANCE: '_system.multiInstance',
    // deprecated
    MODELENCE_ENV: '_system.env',
    GOOGLE_AUTH_ENABLED: '_system.user.auth.google.enabled',
    GOOGLE_AUTH_CLIENT_ID: '_system.user.auth.google.clientId',
    GOOGLE_AUTH_CLIENT_SECRET: '_system.user.auth.google.clientSecret',
  },
  withRemoteServer: {
    MODELENCE_SITE_URL: '_system.site.url',
  },
} as const;

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

function getConfigsFromEnvMap(
  configMap: Record<string, string>,
  configSchema: ConfigSchema
): AppConfig[] {
  const configs: AppConfig[] = [];

  for (const [envVar, configKey] of Object.entries(configMap)) {
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

// Where an attached local dev server actually serves: the default for
// `_system.site.url`, and what Studio shows when it has to tell someone the
// environment is running on a developer's machine instead of in the cloud.
export function getLocalSiteUrl(): string {
  const port = process.env.MODELENCE_PORT || process.env.PORT || 3000;
  // Reads the env var directly on purpose: this is what *produces* the
  // `_system.site.url` config below, so getConfig would be circular.
  // eslint-disable-next-line no-restricted-syntax
  return process.env.MODELENCE_SITE_URL || `http://localhost:${port}`;
}

export function getLocalConfigs(
  configSchema: ConfigSchema,
  variant: LocalConfigVariant = 'withoutRemoteServer'
): AppConfig[] {
  const configMap = localConfigMap[variant];
  const configs = getConfigsFromEnvMap(configMap, configSchema);

  // Attached local dev (`modelence setup` writes the marker; Studio sandboxes
  // pre-set "sandbox"): default the site URL to this process instead of the
  // environment URL from the cloud config, so OAuth callbacks and email links
  // point at the server actually running. An explicit MODELENCE_SITE_URL wins.
  if (
    variant === 'withRemoteServer' &&
    process.env.MODELENCE_RUNTIME === 'local' &&
    !configs.some(({ key }) => key === '_system.site.url')
  ) {
    configs.push({
      key: '_system.site.url',
      type: 'string',
      value: getLocalSiteUrl(),
    });
  }

  return configs;
}
