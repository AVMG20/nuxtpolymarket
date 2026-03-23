export default defineNuxtRouteMiddleware(async (to, from) => {
    const { loggedIn, fetchSession } = useAuth()
    await fetchSession()

    const publicRoutes = ["/login", "/register"]

    if (!loggedIn.value && !publicRoutes.includes(to.path)) {
        return navigateTo("/login")
    }
})