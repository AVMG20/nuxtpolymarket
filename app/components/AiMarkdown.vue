<script setup lang="ts">
import { marked } from 'marked'

const props = defineProps<{
  markdown: string
}>()

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeHref(href: string) {
  const scheme = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase()
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return '#'
  return href
}

const renderer = new marked.Renderer()
renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens)
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : ''
  const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''
  return `<a href="${escapeHtml(safeHref(href))}"${safeTitle}${external}>${label}</a>`
}
renderer.image = ({ text }) => escapeHtml(text)

type Part
    = | { type: 'text', html: string }
        | { type: 'coin' | 'gem', value: number }
        | { type: 'stat', kind: 'profit' | 'loss', category: string, value: number }

const TOKEN_RE = /\[\[(coin|gem|profit|loss):([^\]]{1,100})\]\]/g

function renderMarkdown(markdown: string) {
  return marked.parse(escapeHtml(markdown), {
    async: false,
    breaks: true,
    gfm: true,
    renderer
  }) as string
}

function parseParts(markdown: string): Part[] {
  const parts: Part[] = []
  let last = 0

  for (const match of markdown.matchAll(TOKEN_RE)) {
    const [full = '', kind = '', payload = ''] = match
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', html: renderMarkdown(markdown.slice(last, index)) })

    if (kind === 'coin' || kind === 'gem') {
      const value = Number(payload)
      if (Number.isFinite(value)) parts.push({ type: kind, value })
      else parts.push({ type: 'text', html: renderMarkdown(full) })
    } else {
      const separator = payload.lastIndexOf(':')
      const category = separator > 0 ? payload.slice(0, separator) : ''
      const value = Number(payload.slice(separator + 1))
      if (category && Number.isFinite(value)) {
        parts.push({ type: 'stat', kind: kind === 'profit' ? 'profit' : 'loss', category, value: Math.abs(value) })
      } else {
        parts.push({ type: 'text', html: renderMarkdown(full) })
      }
    }

    last = index + full.length
  }

  if (last < markdown.length) parts.push({ type: 'text', html: renderMarkdown(markdown.slice(last)) })
  return parts
}

const parts = computed(() => parseParts(props.markdown))
</script>

<template>
  <div
    class="ai-markdown min-w-0 break-words leading-7 text-default [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-elevated [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_td]:border-b [&_td]:border-default [&_td]:p-2 [&_th]:border-b [&_th]:border-default [&_th]:p-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 *:first:mt-0 *:last:mb-0"
  >
    <template v-for="(part, index) in parts" :key="index">
      <!-- eslint-disable vue/no-v-html -- raw HTML is escaped before Markdown parsing and links are protocol-filtered -->
      <span v-if="part.type === 'text'" v-html="part.html" />
      <!-- eslint-enable vue/no-v-html -->
      <CoinBalance v-else-if="part.type === 'coin'" :value="part.value" class="inline-flex align-middle" />
      <GemBalance v-else-if="part.type === 'gem'" :value="part.value" class="inline-flex align-middle" />
      <span
        v-else
        class="inline-flex items-center gap-1 rounded bg-elevated px-1.5 py-0.5 align-middle text-xs font-medium"
        :class="part.kind === 'profit' ? 'text-success' : 'text-error'"
      >
        <UIcon class="size-3.5 shrink-0" :name="part.kind === 'profit' ? 'i-lucide-trending-up' : 'i-lucide-trending-down'" />
        {{ part.category }}
        <span>{{ part.kind === 'profit' ? '+' : '-' }}</span>
        <CoinBalance :value="part.value" class="inline-flex" />
      </span>
    </template>
  </div>
</template>
