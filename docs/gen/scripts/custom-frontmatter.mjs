// @ts-check
import { MarkdownPageEvent } from "typedoc-plugin-markdown";

/** @param {import('typedoc-plugin-markdown').MarkdownApplication} app */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.BEGIN, page => {
    // Only add a title if one isn't already set (e.g. by @title)
    if (!page.frontmatter?.title && page.model?.name) {
      page.frontmatter = {
        title: page.model.name,
        ...page.frontmatter       // keep globals such as sidebar_position
      };
    }
  });

  // Remove `.mdx` extension from internal markdown links
  app.renderer.on(MarkdownPageEvent.END, page => {
    if (typeof page.contents === 'string') {
      // Replace occurrences like "(path.mdx" or "path.mdx#" but keep anchors and closing characters
      page.contents = page.contents.replace(/\.mdx(?=[)#])/g, "");

      const baseUrl = page.url.split('/').slice(0, -1).join('/');

      // Add a leading dot to internal links to avoid target="_blank"
      page.contents = page.contents.replace(/\]\(([^/)][^)#]*[^/])\)/g, (match, linkPath) => {
        return `](/api-reference/${baseUrl}/${linkPath})`;
      });
    }
  });
}
