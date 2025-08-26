import { User } from "@/auth/types";

export type AuthOption = {
  onSuccess?: (user: User) => void;
  onError?: (error: Error) => void;
}

export type AuthConfig = {
  login?: AuthOption;
  signup?: AuthOption;
};

let authConfig: AuthConfig = Object.freeze({});

export function setAuthConfig(newAuthConfig: AuthConfig) {
  authConfig = Object.freeze(Object.assign({}, authConfig, newAuthConfig));
}

export function getAuthConfig() {
  return authConfig;
}
