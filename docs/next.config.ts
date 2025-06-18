import type { NextConfig } from "next";
import nextra from 'nextra';

const withNextra = nextra({
  mdxOptions: {
    // Add any MDX options here
  }
});

const nextConfig: NextConfig = withNextra({
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
});

export default nextConfig;
