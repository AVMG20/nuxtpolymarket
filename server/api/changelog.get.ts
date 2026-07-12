import { marked } from 'marked'

interface ChangelogEntry {
    title: string
    description: string
    date: string
    html: string
}

function parseChangelogEntry(raw: string): ChangelogEntry {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
    if (!match) throw createError({ statusCode: 500, statusMessage: 'Invalid changelog entry format' })

    const [, frontmatter = '', body = ''] = match
    const data: Record<string, string> = {}
    for (const line of frontmatter.split('\n')) {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex === -1) continue
        const key = line.slice(0, separatorIndex).trim()
        data[key] = line.slice(separatorIndex + 1).trim()
    }

    return {
        title: data.title ?? '',
        description: data.description ?? '',
        date: data.date ?? '',
        html: marked.parse(body.trim(), { async: false })
    }
}

export default defineEventHandler(async () => {
    const storage = useStorage('assets:changelog')
    const keys = await storage.getKeys()

    const entries = await Promise.all(keys.map(async (key) => {
        const raw = await storage.getItem<string>(key)
        return parseChangelogEntry(raw ?? '')
    }))

    return entries.sort((a, b) => b.date.localeCompare(a.date))
})
