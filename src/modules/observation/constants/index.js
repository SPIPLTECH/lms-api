const { EVENT_TYPES, EVENT_CATEGORIES } = require("./eventTypes.constants");
const { EVENT_TYPE_TO_CATEGORY, resolveCategory } = require("./eventCategoryMap.constants");

const MAX_PAYLOAD_BYTES = 16 * 1024; // 16KB — generous for event payloads, cheap to enforce
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

module.exports = {
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_TYPE_TO_CATEGORY,
  resolveCategory,
  MAX_PAYLOAD_BYTES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
