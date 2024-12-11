type ConfigType = 'text' | 'string' | 'number' | 'boolean' | 'secret';

export type ConfigKey = string;

type ConfigParams = {
  type: ConfigType;
  default: ValueType<ConfigType>;
  isPublic: boolean;
};

export type AppConfig = {
  key: ConfigKey;
  value: ValueType<ConfigType>;
  type: ConfigType;
}

export type ConfigSchema = {
  [key: string]: ConfigParams;
};

export type Configs = Record<ConfigKey, AppConfig>;

type ValueType<T> = T extends 'number' ? number :
  T extends 'string' ? string :
  T extends 'text' ? string :
  T extends 'boolean' ? boolean :
  T extends 'secret' ? string :
  never;
