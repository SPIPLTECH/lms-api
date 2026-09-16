const { LIMITS } = require("../constants/aiAssistant.constants");

/**
 * Enforces the hard ceiling on retrieved context.
 *
 * Trimming is priority-ordered, not chronological: chunks are sorted
 * nearest-first (active content before course metadata) and dropped from the
 * BOTTOM, so when a course is large the student still gets the material they
 * are actually looking at. A single oversized chunk is truncated rather than
 * dropped, and marked, so the model can say the material is partial instead
 * of confidently answering from half a page.
 *
 * @returns {{chunks, totalChars, droppedCount, truncatedCount}}
 */
const applyContextBudget = (chunks = [], maxChars = LIMITS.MAX_CONTEXT_CHARS) => {
  const sorted = [...chunks].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  const kept = [];
  let total = 0;
  let dropped = 0;
  let truncated = 0;

  for (const chunk of sorted) {
    const remaining = maxChars - total;
    if (remaining <= 0) {
      dropped += 1;
      continue;
    }

    const text = chunk.text || "";
    const cap = Math.min(remaining, LIMITS.MAX_CHUNK_CHARS);

    if (text.length <= cap) {
      kept.push(chunk);
      total += text.length;
      continue;
    }

    // Only worth keeping a fragment if it can carry real meaning.
    if (cap < 200) {
      dropped += 1;
      continue;
    }

    kept.push({
      ...chunk,
      text: `${text.slice(0, cap)}\n[... this material is longer than shown; the excerpt above is partial ...]`,
      truncated: true,
    });
    total += cap;
    truncated += 1;
  }

  return { chunks: kept, totalChars: total, droppedCount: dropped, truncatedCount: truncated };
};

/**
 * Renders authorised chunks into the text block handed to the model.
 *
 * Every chunk is provenance-labelled with its source type and id. That is
 * what makes "answer only from this" checkable: the grounding is attributable,
 * and the retrieval ids are also what gets recorded in AiMessage.metadata for
 * debugging a bad answer later.
 */
const renderContextBlock = (chunks = []) => {
  if (!chunks.length) return "";
  return chunks
    .map((c) => `[${c.sourceType} ${c.sourceId}] ${c.title || ""}\n${c.text}`)
    .join("\n\n---\n\n");
};

module.exports = { applyContextBudget, renderContextBlock };
