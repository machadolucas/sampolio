const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for interpolation into an HTML string. Required for every
 * user-controlled string (names, categories, labels, axis values) returned
 * from an ECharts `tooltip.formatter`: ECharts assigns that string to
 * `innerHTML`, so an unescaped `<img onerror=…>` in a co-member's name would
 * run as script. Canvas-rendered label/axis formatters do not need it.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
