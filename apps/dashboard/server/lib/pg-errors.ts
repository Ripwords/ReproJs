/**
 * True when `err` is a Postgres unique-constraint violation (SQLSTATE 23505),
 * whether it arrives as the raw `pg` DatabaseError or wrapped by drizzle in a
 * DrizzleQueryError whose `cause` is the driver error.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { code?: unknown; cause?: unknown }
  if (e.code === "23505") return true
  const cause = e.cause as { code?: unknown } | undefined
  return !!cause && typeof cause === "object" && cause.code === "23505"
}
