/**
 * What the request logger may print for a URL. The signed media token in
 * /playback/media/<token> works for anyone holding it while its lease is
 * active, so it is replaced before the line is written.
 */
const MEDIA_TOKEN_PATH = /(\/playback\/media\/)[^/?#]+/;

const redactLoggedUrl = (url) => (typeof url === "string" ? url.replace(MEDIA_TOKEN_PATH, "$1[redacted]") : url);

module.exports = { redactLoggedUrl };
