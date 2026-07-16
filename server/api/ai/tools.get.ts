import { AI_TOOLS } from '#server/utils/ai'

export default defineEventHandler(() => ({
  tools: AI_TOOLS.map(({ function: tool }) => ({
    name: tool.name,
    description: tool.description
  }))
}))
