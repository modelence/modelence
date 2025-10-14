declare module 'vite-plugin-eslint' {
  import type { Plugin } from 'vite';

  export interface ESLintOptions {
    cache?: boolean;
    cacheLocation?: string;
    include?: string | string[];
    exclude?: string | string[];
    formatter?: string;
    eslintPath?: string;
    lintOnStart?: boolean;
    emitWarning?: boolean;
    emitError?: boolean;
    failOnWarning?: boolean;
    failOnError?: boolean;
    fix?: boolean;
    cwd?: string;
    overrideConfigFile?: string;
  }

  export default function eslintPlugin(options?: ESLintOptions): Plugin;
}
