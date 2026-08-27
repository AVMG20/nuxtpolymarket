/* eslint-disable @typescript-eslint/no-invalid-void-type --
 * `void` is nitro's own sentinel for "caller supplied no explicit type
 * argument"; these overloads have to spell the rule the same way it does.
 */
/* eslint-disable @typescript-eslint/no-unused-vars --
 * Augmenting a generic interface requires repeating its type parameter list
 * verbatim, including parameters these overloads do not reference.
 */
import type { FetchOptions } from 'ofetch'
import type { InternalApi } from 'nitropack/types'
import type { MaybeRefOrGetter } from 'vue'
import type { AsyncData, AsyncDataOptions, KeysOf, MultiWatchSources, PickFrom } from '#app/composables/asyncData'
import type { NuxtError } from '#app/composables/error'

/*
 * The useFetch half of the TS2589 fix — see shared/types/nitro-fetch.d.ts for
 * the $fetch half and the full explanation of why nitro's route typing blows
 * the instantiation budget.
 *
 * useFetch is the more expensive of the two: MatchedRoutes appears not just in
 * its result type (via FetchResult -> TypedInternalResponse) but in the
 * CONSTRAINT and DEFAULT of nearly every one of its type parameters, through
 * AvailableRouterMethod. So the fast path cannot reuse nitro's UseFetchOptions
 * either — naming it would drag AvailableRouterMethod back in.
 *
 * `declare const useFetch: UseFetch` — an interface, so the same overload trick
 * works, and useLazyFetch shares the interface so both are covered at once.
 *
 * This lives under app/ rather than shared/ because #app does not resolve in
 * the server tsconfig project.
 */

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

type FlatGet<P extends keyof InternalApi> =
    'get' extends keyof InternalApi[P] ? InternalApi[P]['get']
        : 'default' extends keyof InternalApi[P] ? InternalApi[P]['default']
            : unknown

/* Rebuilt rather than reused: nitro's own options type is generic over the
 * router method, which is exactly the expensive part being avoided. */
type FlatUseFetchOptions<ResT, DataT, PickKeys extends KeysOf<DataT>, DefaultT> =
    Omit<AsyncDataOptions<ResT, DataT, PickKeys, DefaultT>, 'watch'>
    & Omit<FetchOptions, 'method' | 'cache'>
    & {
        key?: MaybeRefOrGetter<string>
        watch?: MultiWatchSources | false
        method?: HttpMethod | Uppercase<HttpMethod>
        cache?: FetchOptions['cache'] | false
    }

declare module '#app/composables/fetch' {
    interface UseFetch<FDataT = unknown, FPickKeys extends KeysOf<FDataT> = never[], FDefaultT = undefined> {
        /* Parameter order mirrors nitro's own signature — ResT first, then
         * ErrorT — so that useFetch<Payload>('/api/x') binds the explicit
         * argument to the result type rather than to the path, and falls
         * back to the route lookup only when none is supplied. */
        <
            ResT = void,
            ErrorT = NuxtError<unknown>,
            P extends Extract<keyof InternalApi, string> = Extract<keyof InternalApi, string>,
            _ResT = ResT extends void ? FlatGet<P> : ResT,
            DataT = _ResT,
            PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
            DefaultT = undefined
        >(
            request: P,
            opts?: FlatUseFetchOptions<_ResT, DataT, PickKeys, DefaultT>
        ): AsyncData<PickFrom<DataT, PickKeys> | DefaultT, ErrorT | undefined>
        /* Paired variant with DefaultT = DataT, as nitro also carries. An
         * explicit type argument switches off inference for every remaining
         * parameter, so a call that passes `default: () => ...` alongside
         * useFetch<Payload> cannot infer DefaultT and needs this overload. */
        <
            ResT = void,
            ErrorT = NuxtError<unknown>,
            P extends Extract<keyof InternalApi, string> = Extract<keyof InternalApi, string>,
            _ResT = ResT extends void ? FlatGet<P> : ResT,
            DataT = _ResT,
            PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
            DefaultT = DataT
        >(
            request: P,
            opts?: FlatUseFetchOptions<_ResT, DataT, PickKeys, DefaultT>
        ): AsyncData<PickFrom<DataT, PickKeys> | DefaultT, ErrorT | undefined>
    }
}

export {}
