# Multi-Package Publishing Guide

This repository uses an automated GitHub Actions workflow to publish packages to NPM when releases are created. The workflow supports publishing multiple packages from the monorepo structure.

## Release Tag Format

To publish a package, create a GitHub release with a tag that follows this format:

```
<package-name>@<version>
```

### Examples

- To publish the main `modelence` package version 0.5.3:
  ```
  modelence@0.5.3
  ```

- To publish `@modelence/auth-ui` version 0.1.12:
  ```
  @modelence/auth-ui@0.1.12
  ```

## Requirements

- Each package must have a `build` script in its `package.json`
- Each package must have a `prepublishOnly` script that runs the build
- The `NPM_TOKEN` secret must be configured in GitHub repository settings
- The package version in `package.json` should match the version in the release tag

## Creating a Release

1. Update the version in the target package's `package.json`
2. Commit and push the changes
3. Go to GitHub Releases
4. Click "Create a new release"
5. Use the correct tag format: `<package-name>@<version>`
6. Fill in the release title and description
7. Click "Publish release"

The GitHub Action will automatically trigger and publish the package to NPM.
