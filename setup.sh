#!/bin/bash

# Modelence Monorepo Setup Script

echo "🚀 Setting up Modelence monorepo..."

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install it first:"
    echo "npm install -g pnpm"
    exit 1
fi

echo "✅ pnpm found"

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version check passed"

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Build all packages
echo "🔨 Building all packages..."
pnpm build

# Run type checking
echo "🔍 Running type checks..."
pnpm type-check

echo "🎉 Monorepo setup complete!"
echo ""
echo "Available commands:"
echo "  pnpm build         - Build all packages"
echo "  pnpm dev           - Start development mode"
echo "  pnpm type-check    - Run type checking"
echo "  pnpm changeset     - Add a changeset"
echo "  pnpm release       - Build and publish packages"
echo ""
echo "See MONOREPO.md for more information."
