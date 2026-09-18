import { defineEventHandler } from "h3"
import { sessionEndedReason } from "../../lib/session-ended"

/**
 * Tells a signed-out browser why its session ended, so the auth guard can
 * show the reason on the sign-in page. Answers only about the session cookie
 * the request carries, so it reveals nothing to anyone who does not hold that
 * cookie.
 */
export default defineEventHandler(async (event) => ({
  reason: await sessionEndedReason(event.headers),
}))
