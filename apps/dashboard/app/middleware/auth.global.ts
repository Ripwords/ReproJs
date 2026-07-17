export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = ["/auth/sign-in", "/s/"]
  if (publicPaths.some((p) => to.path.startsWith(p))) return

  // useRequestFetch() forwards the incoming request's cookie during SSR.
  // authClient.getSession() uses $fetch without cookie forwarding, so it
  // returns null on every SSR render and wrongly triggers a redirect.
  let isAuthenticated = false
  try {
    const fetchWithCookies = useRequestFetch()
    const session = await fetchWithCookies<{ user?: unknown }>("/api/auth/get-session")
    isAuthenticated = !!session?.user
  } catch {
    // Session fetch failed — treat as unauthenticated.
  }

  if (!isAuthenticated) {
    return navigateTo(`/auth/sign-in?next=${encodeURIComponent(to.fullPath)}`)
  }
})
