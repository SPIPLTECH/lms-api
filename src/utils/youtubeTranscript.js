const axios = require("axios");

const YOUTUBE_ID_PATTERN =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const INNERTUBE_USER_AGENT =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";

const INNERTUBE_API_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

/**
 * Extracts YouTube video ID from various YouTube URL formats.
 */
const extractVideoId = (url) => {
  if (!url) return null;
  const match = url.match(YOUTUBE_ID_PATTERN);
  return match ? match[1] : null;
};

/**
 * Decodes standard and numerical HTML entities in text.
 */
const decodeHtmlEntities = (text) => {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Parses raw transcript XML body into normalized segment objects.
 * Supports both srv3 format (<p t="ms" d="ms">) and classic format (<text start="s" dur="s">).
 */
const parseTranscriptXml = (xml) => {
  const segments = [];

  // Try srv3 format first: <p t="startMs" d="durMs"><s>text</s></p> or <p t="startMs" d="durMs">text</p>
  const srv3Regex = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let match;

  while ((match = srv3Regex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = match[2] ? parseInt(match[2], 10) : 0;
    const innerContent = match[3];

    let text = "";
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;

    while ((sMatch = sRegex.exec(innerContent)) !== null) {
      text += sMatch[1];
    }

    if (!text) {
      text = innerContent.replace(/<[^>]+>/g, "");
    }

    text = decodeHtmlEntities(text);

    if (text) {
      segments.push({
        start: startMs / 1000,
        duration: durMs / 1000,
        text,
      });
    }
  }

  if (segments.length > 0) return segments;

  // Fallback to classic format: <text start="startSec" dur="durSec">text</text>
  const classicRegex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;

  while ((match = classicRegex.exec(xml)) !== null) {
    const start = parseFloat(match[1]);
    const duration = match[2] ? parseFloat(match[2]) : 0;
    const text = decodeHtmlEntities(match[3]);

    if (text) {
      segments.push({
        start: isNaN(start) ? 0 : start,
        duration: isNaN(duration) ? 0 : duration,
        text,
      });
    }
  }

  return segments;
};

/**
 * Fetches caption tracks via InnerTube Player API with Android Client context.
 */
const fetchTracksViaInnerTube = async (videoId) => {
  try {
    const response = await axios.post(
      INNERTUBE_API_URL,
      {
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
          },
        },
        videoId,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": INNERTUBE_USER_AGENT,
        },
        timeout: 7000,
      }
    );

    const data = response.data;
    const playabilityStatus = data?.playabilityStatus?.status;

    if (playabilityStatus === "LOGIN_REQUIRED") {
      const error = new Error(
        "This video is private and its transcript cannot be retrieved."
      );
      error.statusCode = 404;
      throw error;
    }

    if (playabilityStatus === "UNPLAYABLE" || playabilityStatus === "ERROR") {
      const error = new Error(
        "This video has been deleted or is unavailable."
      );
      error.statusCode = 404;
      throw error;
    }

    const captionTracks =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    return { captionTracks: Array.isArray(captionTracks) ? captionTracks : [] };
  } catch (err) {
    if (err.statusCode) throw err;
    return { captionTracks: [] };
  }
};

/**
 * Fallback: Fetches caption tracks by scraping YouTube watch page inline player response.
 */
const fetchTracksViaWatchPage = async (videoId, lang) => {
  try {
    const response = await axios.get(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          ...(lang && { "Accept-Language": lang }),
        },
        timeout: 7000,
      }
    );

    const html = response.data;

    if (html.includes('class="g-recaptcha"')) {
      const error = new Error(
        "YouTube rate limit reached. Please try again later."
      );
      error.statusCode = 429;
      throw error;
    }

    const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (!match) return [];

    const playerResponse = JSON.parse(match[1]);
    const playabilityStatus = playerResponse?.playabilityStatus?.status;

    if (playabilityStatus === "LOGIN_REQUIRED") {
      const error = new Error(
        "This video is private and its transcript cannot be retrieved."
      );
      error.statusCode = 404;
      throw error;
    }

    if (playabilityStatus === "UNPLAYABLE" || playabilityStatus === "ERROR") {
      const error = new Error(
        "This video has been deleted or is unavailable."
      );
      error.statusCode = 404;
      throw error;
    }

    const captionTracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    return Array.isArray(captionTracks) ? captionTracks : [];
  } catch (err) {
    if (err.statusCode) throw err;
    return [];
  }
};

/**
 * Downloads and parses transcript content from a selected caption track URL.
 */
const downloadTranscriptTrack = async (baseUrl, lang) => {
  // Try direct baseUrl first, then try with &fmt=srv3 format fallback
  const urlsToTry = [baseUrl, `${baseUrl}&fmt=srv3`];

  for (const url of urlsToTry) {
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          ...(lang && { "Accept-Language": lang }),
        },
        timeout: 7000,
      });

      if (response.data && typeof response.data === "string" && response.data.length > 0) {
        const segments = parseTranscriptXml(response.data);
        if (segments.length > 0) {
          return segments;
        }
      }
    } catch {
      // Continue to next URL attempt
    }
  }

  return [];
};

/**
 * Fetches transcript segments for a given video ID and language.
 *
 * @param {string} videoId - 11-character YouTube video ID
 * @param {string} lang - Preferred language code (default 'en')
 * @returns {Promise<Array<{start: number, duration: number, text: string}>>}
 */
const fetchTranscript = async (videoId, lang = "en") => {
  if (!videoId || typeof videoId !== "string") {
    const error = new Error("Invalid YouTube video ID.");
    error.statusCode = 400;
    throw error;
  }

  // Tier 1: Fetch via InnerTube Android Client context
  let { captionTracks } = await fetchTracksViaInnerTube(videoId);

  // Tier 2: Fallback to YouTube Watch Page scraping if InnerTube yielded no tracks
  if (!captionTracks || captionTracks.length === 0) {
    captionTracks = await fetchTracksViaWatchPage(videoId, lang);
  }

  if (!captionTracks || captionTracks.length === 0) {
    console.error(`[youtubeTranscript] videoId=${videoId} lang=${lang} reason="No caption tracks found"`);
    const error = new Error("Transcripts are disabled for this video.");
    error.statusCode = 404;
    throw error;
  }

  // Select target track: match requested language code or fallback to first track
  const track =
    captionTracks.find(
      (t) =>
        t.languageCode === lang ||
        (t.languageCode && t.languageCode.startsWith(lang))
    ) || captionTracks[0];

  const baseUrl = track.baseUrl || track.base_url;

  if (!baseUrl) {
    const error = new Error("No valid caption track URL found.");
    error.statusCode = 404;
    throw error;
  }

  console.log(
    `[youtubeTranscript] videoId=${videoId} lang=${lang} selectedTrackLang=${track.languageCode || lang} trackUrlFound=true`
  );

  const segments = await downloadTranscriptTrack(baseUrl, lang);

  console.log(
    `[youtubeTranscript] videoId=${videoId} segmentCount=${segments.length}`
  );

  if (segments.length === 0) {
    console.error(`[youtubeTranscript] videoId=${videoId} lang=${lang} reason="Zero usable segments parsed"`);
    const error = new Error("No transcript is available for this video.");
    error.statusCode = 404;
    throw error;
  }

  return segments;
};

module.exports = {
  extractVideoId,
  fetchTranscript,
};
