import { authClient } from '~/utils/auth-client'

export default defineNuxtRouteMiddleware(async (to, from) => {
  const { data: session } = await authClient.useSession(useFetch);
  if (!session.value) {
    if (to.path === "/") {
      return navigateTo("/login");
    }
  }
});
