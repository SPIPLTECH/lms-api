const URL_REGEX = /https?:\/\/[^\s"'<>)]+/g;

const classifyUrl = (url) => {
  const lower = url.toLowerCase();
  if (/youtube\.com|youtu\.be/.test(lower)) return "video";
  if (/vimeo\.com/.test(lower)) return "video";
  if (/\.(png|jpe?g|gif|svg|webp)(\?|#|$)/.test(lower)) return "image";
  if (/\.(mp4|webm|mov|avi|mkv)(\?|#|$)/.test(lower)) return "video";
  if (/\.(mp3|wav|ogg|m4a)(\?|#|$)/.test(lower)) return "audio";
  if (/\.pdf(\?|#|$)/.test(lower)) return "document";
  if (/\.(pptx?|docx?|xlsx?|key)(\?|#|$)/.test(lower)) return "document";
  return "link";
};

const getVideoProvider = (url) => {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/vimeo\.com/i.test(url)) return "vimeo";
  return "external";
};

/** Scans free text for bare URLs and classifies each by likely content type. */
const detectUrls = (text) => {
  if (!text) return [];
  const matches = text.match(URL_REGEX) || [];
  const unique = [...new Set(matches)];
  return unique.map((url) => ({ url, contentType: classifyUrl(url) }));
};

// Content types rich enough to deserve their own Composer block instead of
// staying a plain inline hyperlink.
const MEDIA_CONTENT_TYPES = new Set(["video", "image", "audio", "document"]);

// Matches a markdown link `[text](url)` (not preceded by `!`, which would
// make it a markdown *image* `![alt](url)` — already natively rendered
// inline by the markdown/slide renderer, so left alone) or else a bare URL.
const buildSplitRegex = () => new RegExp(`(?<!!)\\[([^\\]]*)\\]\\((${URL_REGEX.source})\\)|(${URL_REGEX.source})`, "g");

/**
 * Splits text into ordered segments at each URL occurrence (source order,
 * not deduped) so a caller can replace a URL with a typed block exactly
 * where it sat in the text instead of collecting URLs separately.
 *
 * A bare URL is always a split candidate. A URL that's the target of a
 * markdown link (`[text](url)`) is only split out when it points at
 * genuinely embeddable media (video/image/audio/document) — an ordinary
 * `[see the docs](https://...)` hyperlink to a web page is left inline as
 * normal prose rather than promoted to a block.
 */
const splitOnUrls = (text) => {
  if (!text) return [];

  const segments = [];
  const regex = buildSplitRegex();
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const isMarkdownLink = match[2] !== undefined;
    let url = isMarkdownLink ? match[2] : match[3];
    let consumedLength = match[0].length;

    // A bare-URL match landing right after "](" is the inside of a markdown
    // image (`![alt](url)`, excluded above by the lookbehind) or some other
    // `(url)` span already handled elsewhere — leave it embedded rather than
    // splitting mid-syntax.
    if (!isMarkdownLink && text.slice(0, match.index).endsWith("](")) continue;

    // A bare URL wrapped in markdown emphasis (`***url***`, `_url_`, ...)
    // has no whitespace between the URL and its closing `*`/`_` run, so the
    // greedy URL_REGEX swallows it into the "URL" — corrupting e.g. a
    // YouTube link with a trailing `***`. Strip it back off when the same
    // run precedes the match (its opening delimiter), leaving the markers
    // in the surrounding text instead of the URL.
    if (!isMarkdownLink) {
      const trailingMarker = url.match(/[*_]+$/)?.[0];
      if (trailingMarker && text.slice(match.index - trailingMarker.length, match.index) === trailingMarker) {
        url = url.slice(0, -trailingMarker.length);
        consumedLength -= trailingMarker.length;
      }
    }

    const contentType = classifyUrl(url);
    if (isMarkdownLink && !MEDIA_CONTENT_TYPES.has(contentType)) continue;

    const before = text.slice(lastIndex, match.index);
    if (before) segments.push({ type: "text", text: before });
    segments.push({ type: "url", url, contentType, linkText: isMarkdownLink ? match[1].trim() : undefined });
    lastIndex = match.index + consumedLength;
  }

  const rest = text.slice(lastIndex);
  if (rest || segments.length === 0) segments.push({ type: "text", text: rest });

  return segments;
};

module.exports = { detectUrls, classifyUrl, getVideoProvider, splitOnUrls };
