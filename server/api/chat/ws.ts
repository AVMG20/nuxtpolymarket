import type { Peer } from 'crossws'
import { and, eq, inArray } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { db } from '#server/database'
import { chatMentions, chatMessages, user } from '#server/database/schema'
import { sanitizeChatContent } from '#shared/utils/chat'

const TAG_RE = /\[\[tag:([^:\]]{1,64}):[^\]]{1,60}\]\]/g

interface ChatUser {
  id: string
}

const peers = new Map<Peer, ChatUser>()

export default defineWebSocketHandler({
  async upgrade(request) {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
  },

  async open(peer) {
    const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
    const session = await auth.api.getSession({ headers })
    if (!session?.user?.id) {
      peer.close(4401, 'Unauthorized')
      return
    }
    peers.set(peer, { id: session.user.id })
  },

  async message(peer, message) {
    const sender = peers.get(peer)
    if (!sender) return

    let data: { type?: string, id?: unknown, content?: unknown }
    try {
      data = JSON.parse(message.text())
    } catch {
      return
    }

    // delete own message
    if (data.type === 'delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const [deleted] = await db
        .delete(chatMessages)
        .where(and(eq(chatMessages.id, id), eq(chatMessages.userId, sender.id)))
        .returning({ id: chatMessages.id })
      if (!deleted) return
      const payload = JSON.stringify({ type: 'delete', id: deleted.id })
      for (const p of peers.keys()) {
        p.send(payload)
      }
      return
    }

    const content = sanitizeChatContent(String(data.content ?? ''))
    if (!content) return

    const [currentSender] = await db
      .select({ name: user.name, emblem: user.emblem })
      .from(user)
      .where(eq(user.id, sender.id))
      .limit(1)
    if (!currentSender) return

    const [row] = await db
      .insert(chatMessages)
      .values({ userId: sender.id, content })
      .returning()
    if (!row) return

    // record @mentions so tagged users keep a notification until they see it
    const taggedIds = [...new Set([...content.matchAll(TAG_RE)].map(m => m[1] ?? ''))]
      .filter(Boolean)
      .slice(0, 5)
    if (taggedIds.length) {
      const tagged = await db
        .select({ id: user.id })
        .from(user)
        .where(inArray(user.id, taggedIds))
      if (tagged.length) {
        await db
          .insert(chatMentions)
          .values(tagged.map(u => ({ messageId: row.id, userId: u.id })))
      }
    }

    const payload = JSON.stringify({
      type: 'message',
      id: row.id,
      userId: sender.id,
      name: currentSender.name,
      emblem: currentSender.emblem,
      content: row.content,
      createdAt: row.createdAt.toISOString()
    })
    for (const p of peers.keys()) {
      p.send(payload)
    }
  },

  close(peer) {
    peers.delete(peer)
  }
})
