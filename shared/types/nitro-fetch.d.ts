/* eslint-disable @typescript-eslint/no-invalid-void-type --
 * `void` is nitro's own sentinel for "caller supplied no explicit type
 * argument"; these overloads have to spell the rule the same way it does.
 */
/* eslint-disable @typescript-eslint/no-unused-vars --
 * Augmenting a generic interface requires repeating its type parameter list
 * verbatim, including parameters these overloads do not reference.
 */
import type { FetchOptions } from 'ofetch'
import type { InternalApi, NitroFetchRequest } from 'nitropack/types'

/*
 * Nitro types $fetch by running MatchedRoutes over the WHOLE union of API
 * routes at every call site: CalcMatchScore walks each route key segment by
 * segment building tuple arithmetic, then MaxTuple compares those scores by
 * unary counting. That is O(routes x segments) per call, and it runs a second
 * time for the options parameter via NitroFetchOptions -> AvailableRouterMethod.
 * Past ~190 routes it exhausts TypeScript's instantiation budget and calls
 * start failing with TS2589.
 *
 * The budget is effectively global: because TypeScript caches instantiations,
 * whichever file resolves MatchedRoutes first pays for it and the rest reuse
 * the result. So the file that reports the error moves as unrelated code
 * changes, which is why this looked intermittent.
 *
 * All of that machinery exists to resolve pattern routes ('/api/x/:id',
 * '/api/x/**'). A request that is already an exact key of InternalApi needs
 * none of it — a direct index does the same job in constant time. $Fetch is
 * an interface, so we add that fast path as an overload. Members declared on
 * an interface take precedence over ones inherited from a base type, so this
 * is tried first; anything that is not a literal route key (template strings,
 * external URLs) misses the constraint and falls through to nitro's original
 * resolution, unchanged.
 *
 * See app/types/use-fetch.d.ts for the matching useFetch/useLazyFetch half.
 */

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

/* The method is constrained to a union of literals rather than inherited as
 * FetchOptions['method'] (string). Against a literal union the contextual type
 * stops `{ method: 'POST' }` widening to string, which would make the payload
 * lookup miss and quietly resolve to unknown. It is read off O rather than
 * being its own type parameter because passing any explicit type argument
 * ($fetch<void>(...)) stops inference for the remaining parameters. */
type FlatOptions = Omit<FetchOptions, 'method'> & { method?: HttpMethod | Uppercase<HttpMethod> }

type FlatMethod<O> = O extends { method: infer M extends string } ? Lowercase<M> : 'get'

type FlatPayload<P extends keyof InternalApi, M extends string> =
    M extends keyof InternalApi[P] ? InternalApi[P][M]
        : 'default' extends keyof InternalApi[P] ? InternalApi[P]['default']
            : unknown

/** Mirrors nitro's own rule: an explicitly supplied T wins over the route lookup. */
type FlatResult<T, P extends keyof InternalApi, O> =
    T extends string | boolean | number | null | void | object
        ? T
        : FlatPayload<P, FlatMethod<O>>

declare module 'nitropack/types' {
    interface $Fetch<DefaultT = unknown, DefaultR extends NitroFetchRequest = NitroFetchRequest> {
        <
            T = DefaultT,
            P extends Extract<keyof InternalApi, string> = Extract<keyof InternalApi, string>
        >(
            request: P
        ): Promise<FlatResult<T, P, { method?: 'get' }>>
        <
            T = DefaultT,
            P extends Extract<keyof InternalApi, string> = Extract<keyof InternalApi, string>,
            O extends FlatOptions = FlatOptions
        >(
            request: P,
            opts: O
        ): Promise<FlatResult<T, P, O>>
        /* Dynamic paths built from template literals are not literal route
         * keys, so no keyed lookup is possible and nitro would fall back to
         * MatchedRoutes. Return the explicitly supplied T instead. Declared
         * after the keyed overloads so exact keys still prefer those. Every
         * such call here either names its payload type or discards the
         * result; one that does neither now yields unknown, which fails
         * loudly at the use site rather than silently. */
        <T = DefaultT>(request: string, opts?: FlatOptions): Promise<T>
    }
}

export {}
