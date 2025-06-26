#!/bin/bash

# Use this script to release a new development version of the package without publishing to modelence@latest.

npm version prerelease --preid=dev
npm publish --tag dev
