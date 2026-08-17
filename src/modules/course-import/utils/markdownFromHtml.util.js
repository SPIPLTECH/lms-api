/**
 * Converts a single HTML block-level element (heading/paragraph/list/table/
 * blockquote/pre) into Markdown, so extracted rich text can be folded into
 * the Composer's existing "text" block (rendered via marked+DOMPurify)
 * without needing dedicated heading/list/table block types.
 */

const inlineToMarkdown = (node, $) => {
  if (!node) return "";
  if (node.type === "text") return node.data || "";
  if (node.type !== "tag") return "";

  const $node = $(node);
  const tag = (node.tagName || node.name || "").toLowerCase();
  const inner = () => $node.contents().map((i, c) => inlineToMarkdown(c, $)).get().join("");

  switch (tag) {
    case "strong":
    case "b":
      return `**${inner()}**`;
    case "em":
    case "i":
      return `_${inner()}_`;
    case "u":
      return `<u>${inner()}</u>`;
    case "code":
      return `\`${$node.text()}\``;
    case "br":
      return "  \n";
    case "a": {
      const href = $node.attr("href") || "";
      const text = inner().trim();
      return `[${text || href}](${href})`;
    }
    default:
      return inner();
  }
};

const inline = ($node, $) => $node.contents().map((i, c) => inlineToMarkdown(c, $)).get().join("").trim();

const tableToMarkdown = ($table, $) => {
  const rows = [];
  $table.find("tr").each((i, tr) => {
    const cells = $(tr).find("th,td").map((j, cell) => inline($(cell), $)).get();
    if (cells.length) rows.push(cells);
  });

  if (!rows.length) return "";

  const [header, ...body] = rows;
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];

  return lines.join("\n");
};

const HEADING_LEVELS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

const elementToMarkdown = ($el, $) => {
  const node = $el.get(0);
  if (!node) return "";
  const tag = (node.tagName || node.name || "").toLowerCase();

  if (HEADING_LEVELS[tag]) {
    return `${"#".repeat(HEADING_LEVELS[tag])} ${inline($el, $)}`;
  }

  switch (tag) {
    case "p":
      return inline($el, $);
    case "blockquote":
      return `> ${inline($el, $)}`;
    case "pre": {
      const codeEl = $el.find("code").first();
      const codeText = (codeEl.length ? codeEl.text() : $el.text()) || "";
      const langClass = codeEl.attr("class") || "";
      const lang = langClass.replace("language-", "").trim();
      return `\`\`\`${lang}\n${codeText}\n\`\`\``;
    }
    case "ul":
      return $el.children("li").map((i, li) => `- ${inline($(li), $)}`).get().join("\n");
    case "ol":
      return $el.children("li").map((i, li) => `${i + 1}. ${inline($(li), $)}`).get().join("\n");
    case "table":
      return tableToMarkdown($el, $);
    default:
      return inline($el, $);
  }
};

module.exports = { elementToMarkdown, inline };
