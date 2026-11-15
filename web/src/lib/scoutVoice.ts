import type { ChatMessage } from './chatClient'

/**
 * Which answer Scout's panel may say aloud, if any: the newest line of the conversation, when it is
 * an answer of Scout's that arrived after the panel was opened. Nothing while an answer is awaited,
 * nothing that was already there when the panel opened (so opening the panel never speaks, and an old
 * answer is never said again), and never a failure notice.
 *
 * `openedAt` is how many lines the conversation held when the panel opened.
 */
export function answerToSay(thread: ChatMessage[], openedAt: number, waiting: boolean): ChatMessage | null {
  if (waiting || thread.length <= openedAt) return null
  const newest = thread[thread.length - 1]
  return newest.role === 'assistant' && !newest.failed ? newest : null
}
