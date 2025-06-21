// @ts-check
import { MarkdownPageEvent } from "typedoc-plugin-markdown";

/** @param {import('typedoc-plugin-markdown').MarkdownApplication} app */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.BEGIN, page => {    
    // Extract custom title from JSDoc @sidebarTitle tag
    let customSidebarTitle = null;
    
    if (page.model && 'signatures' in page.model && Array.isArray(page.model.signatures)) {
      for (const signature of page.model.signatures) {
        if ('comment' in signature && signature.comment && 'blockTags' in signature.comment) {
          const blockTags = signature.comment.blockTags;
          if (Array.isArray(blockTags)) {
            const sidebarTitleTag = blockTags.find(tag => tag.tag === '@sidebarTitle');
            if (sidebarTitleTag && 'content' in sidebarTitleTag && Array.isArray(sidebarTitleTag.content)) {
              customSidebarTitle = sidebarTitleTag.content.map(item => item.text || '').join(' ').trim();
              // Prevent this tag from being rendered in the content
              sidebarTitleTag.skipRendering = true;
              break;
            }
          }
        }
      }
    }
    
    const frontmatter = {
      ...page.frontmatter,
      sidebarTitle: customSidebarTitle || undefined,
      title: page.frontmatter?.title || page.model?.name
    };
    
    page.frontmatter = frontmatter;
  });

  // Remove `.mdx` extension from internal markdown links
  app.renderer.on(MarkdownPageEvent.END, page => {
    if (typeof page.contents === 'string') {
      // Replace occurrences like "(path.mdx" or "path.mdx#" but keep anchors and closing characters
      page.contents = page.contents.replace(/\.mdx(?=[)#])/g, "");

      const baseUrl = ['api-reference', ...page.url.split('/').slice(0, -1).filter(Boolean)].join('/');

      // Add a leading dot to internal links to avoid target="_blank"
      page.contents = page.contents.replace(/\]\(([^/)][^)#]*[^/])\)/g, (match, linkPath) => {
        return `](/${baseUrl}/${linkPath})`;
      });
    }
  });
}
