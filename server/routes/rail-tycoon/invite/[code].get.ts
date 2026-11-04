/**
 * Rail Tycoon invite link: /rail-tycoon/invite/<code>.
 *
 * A Nitro route, so it answers before the SPA and its auth middleware. It only
 * parks the code in the rt-invite cookie and sends the player to the game; the
 * page sends the join and the hub validates the code. No database work here, so
 * reloading the link cannot join twice. The cookie is readable by the page (not
 * httpOnly) and survives the login redirect for a day.
 */
import { isRtInviteCode } from '#shared/utils/rail-tycoon/limits'

export default defineEventHandler((event) => {
    const code = getRouterParam(event, 'code') ?? ''
    if (!isRtInviteCode(code)) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    setCookie(event, 'rt-invite', code, {
        path: '/',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24,
        httpOnly: false
    })
    return sendRedirect(event, '/rail-tycoon', 302)
})
