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
}
