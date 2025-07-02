import { ConfigSchema } from "@/config/types";

const systemConfigSchema: ConfigSchema = {
  '_system.auth.google.enabled': {
    type: 'boolean',
    isPublic: true,
    default: false,
  },
  '_system.auth.google.clientId': {
    type: 'string',
    isPublic: false,
    default: '',
  },
  '_system.auth.google.clientSecret': {
    type: 'secret',
    isPublic: false,
    default: '',
  },
}

export default systemConfigSchema;
