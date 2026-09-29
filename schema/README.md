# modelence.config.json schema

The JSON Schema of `modelence.config.json`, one directory per format version
(`v1/`, later `v2/`). This file is the source of truth: editors load it through
the file's `$schema` URL, and Studio validates every deploy against it.

- Edit the schema here. A non-breaking change (a new optional key, a clearer
  message) goes into the existing version; a breaking change adds the next
  version directory and leaves the old one as it is.
- `errorMessage` strings are shown by VS Code and reused by Studio in deploy
  errors, so write them as the user should read them.
- Studio reads the schema from the branch or commit in its
  `appSpecSchemaBranch` config (admin Configs page, default `main`), so a
  change here applies to deploys within minutes of reaching that branch. Set
  it to a commit SHA to hold validation still while the schema changes.
