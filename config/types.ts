type ConfigType = 'text' | 'number' | 'string' | 'boolean' | 'secret';

export type ConfigKey = string;

type ConfigParams = {
  type: ConfigType;
  default: DefaultType<ConfigType>;
  isPublic: boolean;
};

export type AppConfig = {
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
