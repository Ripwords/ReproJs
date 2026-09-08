import { safeNextPath, SIGN_IN_PATH } from "~~/shared/auth-redirect"

// Any absolute base works — only the path half is ever read back out.
const PARSE_BASE = "https://repro.invalid"

export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = [SIGN_IN_PATH, "/s/"]
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

  if (isAuthenticated) return

  // An auth failure that redirected to a signed-out page carries its reason
  // in `?error=`. Folding the whole fullPath into `next` buries that reason
  // inside an encoded query param the sign-in page never reads — the user
  // lands back on the login form with nothing explaining why. Lift the code
  // out and hand it to the sign-in page directly; `next` keeps only the
  // destination (with `error` stripped, so a later successful sign-in
  // doesn't land on a stale `?error=`).
  //
  // Magic-link and OAuth now pin errorCallbackURL to the sign-in page
  // themselves, but links already sitting in inboxes — and any future flow
  // that redirects with `?error=` — still route through here.
  const url = new URL(to.fullPath, PARSE_BASE)
  const errorCode = url.searchParams.get("error")
  url.searchParams.delete("error")

  const params = new URLSearchParams()
  if (errorCode) params.set("error", errorCode)
  const next = safeNextPath(`${url.pathname}${url.search}${url.hash}`, "")
  if (next) params.set("next", next)

  const search = params.toString()
  return navigateTo(search ? `${SIGN_IN_PATH}?${search}` : SIGN_IN_PATH)
})
