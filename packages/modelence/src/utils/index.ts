export function isServer() {
  return typeof window !== 'object';
}

export function requireServer() {
  if (!isServer()) {
    throw new Error('This function can only be called on the server');
  }
}

// Matches an <a> element with a quoted href; groups: quote, href, inner HTML.
const anchorPattern = /<a\s(?:[^>]*?\s)?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

export function htmlToText(html: string) {
  return html
    .replace(anchorPattern, (anchor, _quote, href: string, label: string) => {
      // Keep absolute link targets, or a plain-text email loses the link a button points to.
      if (!/^https?:\/\//i.test(href)) {
        return anchor;
      }
      const labelText = label.replace(/<[^>]*>/g, '').trim();
      return labelText === href ? anchor : `${label} (${href})`;
    })
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
