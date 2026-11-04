import { rtInvitePath } from '#shared/utils/rail-tycoon/limits'

const COPIED_MS = 2000

/** The full invite link for a world's code, on this site. */
export function rtInviteLink(code: string): string {
  return `${location.origin}${rtInvitePath(code)}`
}

/**
 * Copies a world's invite link. `copied` holds the key of the link copied in the last two seconds
 * (the world id, so a list marks the right row); a clipboard that refuses shows the link in a toast.
 */
export function useRtCopyInvite() {
  const toast = useToast()
  const copied = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function copy(code: string, key: string) {
    const link = rtInviteLink(code)
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      toast.add({ title: 'Couldn\'t copy the invite link', description: link, color: 'error' })
      return
    }
    copied.value = key
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = null
      timer = null
    }, COPIED_MS)
  }

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })
  return { copied, copy }
}
