export function apiErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object') {
    const err = e as { data?: { statusMessage?: string, message?: string } }
    return err.data?.statusMessage ?? err.data?.message ?? fallback
  }
  return fallback
}
