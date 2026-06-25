/**
 * Escape a JSON payload for safe embedding inside a `<script>` tag:
 * `</script>`, HTML chars, and U+2028/U+2029 (illegal in JS source).
 * Single-pass replace avoids order-dependent double-escape pitfalls.
 */
export function escapeJsonForScript(json: string): string {
  return json.replace(
    /[<>&\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}
