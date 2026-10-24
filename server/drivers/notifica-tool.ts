export const NOTIFICA_TOOL = {
  name: "perguntar_usuario",
  description: "Ask the user a question through this bot's private Notifica integration, or send a notice/result with expectsReply=false. Bound automatically to the calling bot and its original conversation; no key or bot/session IDs are accepted. A question is saved durably, then sent in the background. End your turn after asking; the normal agent session resumes with the user's reply. Never poll or assume approval on a timeout. One pending question per conversation; subsequent messages wait in order. Retry an event only with the SAME eventId and identical content. Configure this bot in Settings → Voice & alerts → Notifica first.",
  inputSchema: { type: "object", additionalProperties: false, properties: {
    eventId: { type: "string", description: "Unique stable ID for this message (letters, digits, _, -, ., :, max 128). Reuse only when retrying the exact same message." },
    title: { type: "string", maxLength: 200 },
    message: { type: "string", maxLength: 20_000 },
    expectsReply: { type: "boolean", default: true, description: "true asks a question and waits; false sends a notice or result." },
    suggestions: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } },
  }, required: ["eventId", "title", "message"] },
} as const;
