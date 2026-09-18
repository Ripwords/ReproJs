import { defineEventHandler, sendRedirect, toWebRequest } from "h3"
import { toNodeHandler } from "better-auth/node"
import { auth } from "../../lib/auth"
import { SIGN_IN_PATH } from "../../../shared/auth-redirect"

const nodeHandler = toNodeHandler(auth)

// The one auth URL a person opens straight from their inbox. When the rate
// limiter refuses it, better-auth answers with a JSON 429 body, which the
// browser renders as raw text. Send the person to the sign-in page with a
// reason instead.
const MAGIC_LINK_VERIFY_PATH = "/api/auth/magic-link/verify"

export default defineEventHandler(async (event) => {
  if (event.method === "GET" && event.path.split("?")[0] === MAGIC_LINK_VERIFY_PATH) {
    const response = await auth.handler(toWebRequest(event))
    if (response.status === 429) {
      return sendRedirect(event, `${SIGN_IN_PATH}?error=rate_limited`, 302)
    }
    return response
  }
  // better-auth/node gives us a standard Node.js (req, res) handler
  await nodeHandler(event.node.req, event.node.res)
})
