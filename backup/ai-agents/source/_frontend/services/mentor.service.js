import Cookies from "js-cookie";
import api from "@/lib/axios";

/**
 * Creates a new MentorConversation
 */
export const createConversation = async (title) => {
  const response = await api.post("/mentor/conversations", { title });
  return response.data;
};

/**
 * Gets all MentorConversations for current user
 */
export const getConversations = async () => {
  const response = await api.get("/mentor/conversations");
  return response.data;
};

/**
 * Gets messages for a specific MentorConversation
 */
export const getMessages = async (conversationId) => {
  if (!conversationId) return { success: true, data: [] };
  const response = await api.get(`/mentor/conversations/${conversationId}/messages`);
  return response.data;
};

/**
 * Sends a non-streaming message
 */
export const sendMessage = async (conversationId, content, params = {}) => {
  const response = await api.post(`/mentor/conversations/${conversationId}/messages`, {
    content,
    ...params,
  });
  return response.data;
};

/**
 * Sends a streaming message via SSE fetch
 */
export const streamMentorMessage = async ({ conversationId, content, params = {}, onChunk, signal }) => {
  const token = Cookies.get("accessToken");
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

  const response = await fetch(`${baseUrl}/mentor/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      content,
      ...params,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `Mentor stream failed (${response.status})`;
    try {
      const errorJson = await response.json();
      message = errorJson?.message || message;
    } catch {
      // Non-JSON error
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLine = rawEvent
        .split("\n")
        .find((line) => line.startsWith("data:"));

      if (!dataLine) continue;

      let payload;
      try {
        payload = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }

      if (payload.type === "chunk") {
        onChunk?.(payload.content);
      } else if (payload.type === "done") {
        return payload.result;
      } else if (payload.type === "error") {
        throw new Error(payload.message || "Mentor AI generation failed.");
      }
    }
  }

  return { success: true };
};
