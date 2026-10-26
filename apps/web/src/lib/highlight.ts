import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";

hljs.registerLanguage("javascript", javascript);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Highlighted HTML for a Code Mode script. hljs escapes its input; the fallback escapes by hand. */
export function highlightJs(code: string): string {
  try {
    return hljs.highlight(code, { language: "javascript", ignoreIllegals: true }).value;
  } catch {
    return escape(code);
  }
}
