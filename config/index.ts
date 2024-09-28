type ConfigType = 'text' | 'number' | 'string' | 'boolean' | 'secret';

type ConfigKey = string;

type ConfigParams = {
  type: ConfigType;
  default: DefaultType<ConfigType>;
  isPublic: boolean;
};

type AppConfig = {
  key: ConfigKey;
  value: string;
  type: ConfigType;
}

export type ConfigSchema = {
  [key: string]: ConfigParams;
};

type DefaultType<T> = T extends 'number' ? number :
                      T extends 'string' ? string :
                      T extends 'boolean' ? boolean :
                      never;

let config: Record<ConfigKey, AppConfig> = {};

export function loadConfigs(configs: AppConfig[]) {
  configs.forEach(({ key, type, value }) => {
    config[key] = {
      key,
      type,
      value
    };
  });

  console.log('loadConfig', config);
}
