const llmConfig = {
  baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  model: process.env.OLLAMA_MODEL || "qwen3.5:4b",
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 60000,
  thinkTimeoutMs: Number(process.env.OLLAMA_THINK_TIMEOUT_MS) || 180000,
  maxOutputTokens: Number(process.env.OLLAMA_MAX_OUTPUT_TOKENS) || 1024,
};

module.exports = llmConfig;
