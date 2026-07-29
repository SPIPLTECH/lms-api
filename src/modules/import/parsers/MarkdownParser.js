class MarkdownParser {
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
