export function isServer() {
  return typeof window !== 'object';
}

export function requireServer() {
  if (!isServer()) {
    throw new Error('This function can only be called on the server');
  }
}

export function htmlToText(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}
