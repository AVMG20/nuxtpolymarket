export const CHAT_MAX_LENGTH = 500
export const CHAT_HISTORY_LIMIT = 20

// Normalizes line endings, collapses newline spam (3+ in a row -> 1)
// and enforces the max length. Used on both client and server.
export function sanitizeChatContent(content: string) {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n')
    .trim()
    .slice(0, CHAT_MAX_LENGTH)
}
