// Nitro identifies an HTTP error structurally: an Error named 'HTTPError'
// carrying a status. Building that shape here keeps game logic usable from the
// browser bundle, which cannot import the server-only `nitro/h3`.
interface HttpErrorInput {
    statusCode?: number
    status?: number
    message?: string
    statusMessage?: string
    statusText?: string
    data?: unknown
}

export function createError(input: HttpErrorInput) {
    const status = input.status ?? input.statusCode ?? 500
    const text = input.statusText ?? input.statusMessage
    const error = new Error(input.message ?? text ?? 'Error')
    error.name = 'HTTPError'
    return Object.assign(error, {
        status,
        statusCode: status,
        statusText: text,
        statusMessage: text,
        data: input.data
    })
}
