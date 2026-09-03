const { GoogleGenAI } = require("@google/genai");

const getApiKey = () => process.env.GEMINI_API_KEY;
const getModelName = () => process.env.GEMINI_MODEL || "gemini-3.6-flash";

/**
 * Executes a structured AI generation request via Google Gemini API (@google/genai)
 */
const generate = async ({ systemPrompt, prompt, context } = {}) => {
  const apiKey = getApiKey();
  if (!apiKey || !apiKey.trim()) {
    const err = new Error("AI service is not configured. Missing GEMINI_API_KEY.");
    err.statusCode = 401;
    throw err;
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const model = getModelName();

  let fullPrompt = prompt || "";
  if (context && typeof context === "object" && Object.keys(context).length > 0) {
    fullPrompt += `\n\nContext:\n${JSON.stringify(context, null, 2)}`;
  }

  try {
    const startTime = Date.now();
    console.log(`[Gemini Provider] Sending generation request to model: ${model}`);

    const response = await ai.models.generateContent({
      model,
      contents: fullPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const duration = Date.now() - startTime;
    console.log(`[Gemini Provider] Gemini response received in ${duration} ms`);

    return {
      response: response.text,
      usage: response.usageMetadata || {},
      model,
    };
  } catch (err) {
    console.error("[Gemini Provider] Gemini API Error:", err.message || err);

    let message = "AI generation failed. Please try again.";
    let statusCode = 502;

    const errMsg = (err.message || "").toLowerCase();
    const errStatus = err.status || err.statusCode;

    if (errStatus === 401 || errStatus === 403 || errMsg.includes("api key") || errMsg.includes("unauthorized")) {
      message = "AI authorization failed. Check server GEMINI_API_KEY.";
      statusCode = 502;
    } else if (errStatus === 429 || errMsg.includes("quota") || errMsg.includes("rate limit") || errMsg.includes("resource_exhausted")) {
      message = "AI usage limit reached. Please try again later.";
      statusCode = 429;
    } else if (errMsg.includes("timeout") || errMsg.includes("deadline")) {
      message = "AI request timed out. Please try again.";
      statusCode = 504;
    }

    const apiErr = new Error(message);
    apiErr.statusCode = statusCode;
    apiErr.originalError = err;
    throw apiErr;
  }
};

module.exports = { generate, getApiKey, getModelName };
