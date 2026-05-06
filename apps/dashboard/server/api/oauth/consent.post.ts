import { z } from "zod"
import { defineEventHandler, readValidatedBody, createError } from "h3"
import { auth } from "../../lib/auth"
import { requireSession } from "../../lib/permissions"
import { env } from "../../lib/env"

const Body = z.object({
  /** Serialized query string from the OAuth consent redirect URL (signed by better-auth). */
  oauthQuery: z.string().min(1),
  /** true = user clicked Allow; false = user clicked Deny. */
  allow: z.boolean(),
})

/**
 * Forwards the user's Allow/Deny decision to better-auth's internal
 * /api/auth/oauth2/consent endpoint.
 *
 * better-auth's oauthProvider plugin registers this endpoint and expects:
 *   - accept: boolean  (allow/deny)
 *   - oauth_query: string  (the signed query string from the consent redirect URL)
 *
 * The endpoint verifies the signature on oauth_query, restores OAuth flow
 * state, records the consent grant, and returns { redirect_uri } pointing
 * to the client's redirect_uri with an authorization code.
 *
 * requireSession() here is defense-in-depth: if the session cookie is missing
 * between page render and form submit we 401 cleanly instead of letting
 * better-auth handle it (which would produce a less clear error for the user).
 */
export default defineEventHandler(async (event) => {
  await requireSession(event)
  const body = await readValidatedBody(event, Body.parse)

  const url = new URL(`${env.BETTER_AUTH_URL}/api/auth/oauth2/consent`)
  const res = await auth.handler(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        cookie: event.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        accept: body.allow,
        oauth_query: body.oauthQuery,
      }),
    }),
  )

  if (!res.ok) {
    throw createError({
      statusCode: res.status,
      statusMessage: `consent decision failed: ${await res.text()}`,
    })
  }

  const json = (await res.json()) as { redirect_uri: string }
  return { redirectUri: json.redirect_uri }
})
