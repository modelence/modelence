import "modelence/client";

// `sendMagicLink` ships with Modelence's magic-link client API. Keep this
// declaration while auth-ui's development dependency remains on an older
// published Modelence version; consumers resolve the helper from their
// installed Modelence package at runtime.
declare module "modelence/client" {
  export function sendMagicLink(options: { email: string }): Promise<void>;
}
