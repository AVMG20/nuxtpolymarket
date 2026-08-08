import type { InternalApi } from 'nitropack/types'

/*
 * The typed-route union behind $fetch/useFetch has grown past TypeScript's
 * instantiation depth (TS2589): the conditional types that map a request
 * literal to its payload now blow up intermittently across the app. These
 * helpers keep full payload typing by indexing the generated route map
 * DIRECTLY — a cheap keyed lookup instead of the deep conditional walk —
 * while the runtime stays the exact same $fetch.
 */

type ApiPath = keyof InternalApi
type GetPayload<P extends ApiPath> = 'get' extends keyof InternalApi[P]
    ? InternalApi[P]['get']
    : never

/** $fetch without route-type inference; pass the payload type explicitly.
 *  During SSR the plain $fetch does not forward the request's cookies, so
 *  authenticated endpoints would 401 — grab the request-aware fetch when a
 *  Nuxt context is active (setup and useAsyncData handlers) and fall back
 *  to $fetch elsewhere (client event handlers). */
export const apiFetch = <T = unknown>(
    url: string,
    opts?: Record<string, unknown>
): Promise<T> => {
    let fetcher: unknown = $fetch
    try {
        fetcher = useRequestFetch()
    } catch {
        // outside a Nuxt context — the global $fetch is correct there
    }
    return (fetcher as (url: string, opts?: Record<string, unknown>) => Promise<T>)(url, opts)
}

/** useFetch('/api/x') replacement: typed by route-map index, keyed by path. */
export function useApiState<P extends ApiPath>(path: P, key?: string) {
    return useAsyncData<GetPayload<P>>(
        key ?? (path as string),
        () => apiFetch<GetPayload<P>>(path as string)
    )
}
