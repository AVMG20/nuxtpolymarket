import type { Peer } from 'crossws'
import { and, eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { db } from '#server/database'
import { chatMessages } from '#server/database/schema'
import { sanitizeChatContent } from '#shared/utils/chat'

interface ChatUser {
  id: string
  name: string
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
    peers.set(peer, { id: session.user.id, name: session.user.name })
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

    const [row] = await db
      .insert(chatMessages)
      .values({ userId: sender.id, content })
      .returning()
    if (!row) return

    const payload = JSON.stringify({
      type: 'message',
      id: row.id,
      userId: sender.id,
      name: sender.name,
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
