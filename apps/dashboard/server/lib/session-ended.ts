import { randomBytes } from "node:crypto"
import { getSessionCookie } from "better-auth/cookies"
import { and, eq, gt } from "drizzle-orm"
import { db } from "../db"
import { session, user, verification } from "../db/schema"

type DB = typeof db
type DbTransaction = Parameters<DB["transaction"]>[0] extends (tx: infer T) => unknown ? T : never

/**
 * Why the server ended a browser's session. Uses the same code as the
 * sign-in page's `?error=` copy (shared/auth-redirect.ts).
 */
export type SessionEndedReason = "account_disabled"

// Markers go in better-auth's generic `verification` table. The prefix keeps
// them apart from magic-link tokens, whose identifier is the bare token.
const MARKER_PREFIX = "session-ended:"

/**
 * Delete every session of a user who is being disabled, and remember which
 * session tokens were ended and why.
 *
 * Deleting the rows is what signs the user out everywhere at once. But after
 * that, the browser's cookie matches no session, so the auth guard can only
 * send the user to a bare sign-in form. The marker lets the guard say why.
 * Each marker expires when its session would have expired.
 */
export async function endSessionsOfDisabledUser(tx: DbTransaction, userId: string): Promise<void> {
  const ended = await tx
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ token: session.token, expiresAt: session.expiresAt })
  if (ended.length === 0) return

  const now = new Date()
  await tx.insert(verification).values(
    ended.map((s) => ({
      id: randomBytes(16).toString("hex"),
      identifier: `${MARKER_PREFIX}${s.token}`,
      value: userId,
      expiresAt: s.expiresAt,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/**
 * Why the session cookie on this request no longer works, when the server
 * ended it on purpose. Returns null when there is no cookie or no marker, and
 * also after the user is re-enabled, because "your account is disabled" would
 * then be false.
 */
export async function sessionEndedReason(headers: Headers): Promise<SessionEndedReason | null> {
  // The cookie value is `<token>.<signature>`. A token is alphanumeric, so
  // the first dot ends it.
  const token = getSessionCookie(headers)?.split(".")[0]
  if (!token) return null

  const [row] = await db
    .select({ status: user.status })
    .from(verification)
    .innerJoin(user, eq(user.id, verification.value))
    .where(
      and(
        eq(verification.identifier, `${MARKER_PREFIX}${token}`),
        gt(verification.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row?.status === "disabled" ? "account_disabled" : null
}
