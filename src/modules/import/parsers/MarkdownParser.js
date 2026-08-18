class MarkdownParser {
  // Splits a markdown document into a title (first H1) and a list of
  // { heading, content } sections, one per H2. Text before the first H2
  // (besides the title) becomes a heading-less section.
  static parse(mdContent) {
    const lines = mdContent.split(/\r?\n/);
    let title = "";
    let titleFound = false;
    const blocks = [];
    let current = null;

    const flush = () => {
      if (current && (current.heading !== null || current.contentLines.some((l) => l.trim()))) {
        blocks.push({
          heading: current.heading,
          content: current.contentLines.join("\n").trim(),
        });
      }
    };

    for (const line of lines) {
      const h1Match = !titleFound && line.match(/^#\s+(.+)$/);
      const h2Match = line.match(/^##\s+(.+)$/);

      if (h1Match) {
        title = h1Match[1].trim();
        titleFound = true;
        continue;
      }

      if (h2Match) {
        flush();
        current = { heading: h2Match[1].trim(), contentLines: [] };
        continue;
      }

      if (!current) {
        current = { heading: null, contentLines: [] };
      }
      current.contentLines.push(line);
    }
    flush();

    return { title, blocks };
  }

  static parseFrontmatter(mdContent) {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = mdContent.match(frontmatterRegex);

    if (!match) {
      return {
        metadata: {},
        body: mdContent.trim(),
      };
    }

    const yamlStr = match[1];
    const body = match[2].trim();
    const metadata = {};

    yamlStr.split("\n").forEach((line) => {
      const parts = line.split(":");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(":").trim().replace(/^["']|["']$/g, "");
        metadata[key] = value;
      }
    });

    return { metadata, body };
  }
}

module.exports = MarkdownParser;
