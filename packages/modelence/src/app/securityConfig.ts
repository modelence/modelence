export type SecurityConfig = {
  frameAncestors?: string[];
};

let securityConfig: SecurityConfig = Object.freeze({});

export function setSecurityConfig(newSecurityConfig: SecurityConfig) {
  securityConfig = Object.freeze(Object.assign({}, securityConfig, newSecurityConfig));
}

export function getSecurityConfig() {
  return securityConfig;
}
