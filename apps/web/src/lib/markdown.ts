import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: true });

// GFM also strikes through single tildes, but the agent writes "~1.3" to mean "about".
const DOUBLE_TILDE_DEL = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?!~)/;
marked.use({
  tokenizer: {
    del(src) {
      const match = DOUBLE_TILDE_DEL.exec(src);
      if (!match) return undefined;
      const text = match[1] ?? "";
      return { type: "del", raw: match[0], text, tokens: this.lexer.inlineTokens(text) };
    },
  },
});

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
  return DOMPurify.sanitize(markdownToUnsafeHtml(source), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "align"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

/** Unsanitized markdown HTML; only renderMarkdown output may reach the DOM. */
export function markdownToUnsafeHtml(source: string): string {
  return marked.parse(escapeRawHtml(source), { async: false });
}

function escapeRawHtml(s: string): string {
  return s.replace(/</g, "&lt;");
}
