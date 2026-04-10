import DOMPurify from "isomorphic-dompurify";

export function renderMarkdown(md: string): string {
  if (!md) return "";

  const raw = md
    .split("\n\n")
    .map((block) => {
      block = block.trim();
      if (!block) return "";

      if (block.startsWith("### ")) return `<h3>${escape(block.slice(4))}</h3>`;
      if (block.startsWith("## ")) return `<h2>${escape(block.slice(3))}</h2>`;
      if (block.startsWith("# ")) return `<h1>${escape(block.slice(2))}</h1>`;

      const lines = block.split("\n");
      if (lines.every((l) => /^[-*]\s/.test(l))) {
        const items = lines.map((l) => `<li>${inlineFormat(l.replace(/^[-*]\s/, ""))}</li>`).join("");
        return `<ul>${items}</ul>`;
      }

      return `<p>${lines.map((l) => inlineFormat(l)).join("<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return DOMPurify.sanitize(raw);
}

function inlineFormat(text: string): string {
  let result = escape(text);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");
  return result;
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
