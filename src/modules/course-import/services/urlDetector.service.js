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

module.exports = { detectUrls, classifyUrl, getVideoProvider };
