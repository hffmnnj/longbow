import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: true });

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "del", "code", "pre", "blockquote", "ul", "ol", "li", "a",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td", "span",
];

let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/** Agent markdown to sanitized HTML. Raw HTML in the source is escaped; images are not allowed. */
export function renderMarkdown(source: string): string {
  ensureHook();
  const html = marked.parse(escapeRawHtml(source), { async: false });
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "align"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

function escapeRawHtml(s: string): string {
  return s.replace(/</g, "&lt;");
}
