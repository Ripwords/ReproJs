-- 0020_normalize_allowed_origins.sql
-- One-off: rewrite every projects.allowed_origins entry into the canonical
-- origin form a browser sends in the `Origin` header (what the dashboard now
-- stores on save):
--   * scheme and host lower-cased
--   * userinfo, path, query and fragment dropped
--   * default ports removed (https :443, http :80)
--   * duplicates collapsed
-- Entries that are not `scheme://host[:port]...` are left untouched so a
-- hand-edited row never silently disappears. Projects with an empty list are
-- not affected.
UPDATE "projects" p
SET "allowed_origins" = n."normalized"
FROM (
  SELECT
    "id",
    array_agg(DISTINCT "origin" ORDER BY "origin") AS "normalized"
  FROM (
    SELECT
      p2."id",
      CASE
        WHEN m IS NULL THEN o
        ELSE regexp_replace(
               regexp_replace(lower(m[1] || '://' || m[2]), '^(https://.*):443$', '\1'),
               '^(http://.*):80$', '\1')
      END AS "origin"
    FROM "projects" p2
    CROSS JOIN LATERAL unnest(p2."allowed_origins") AS o
    CROSS JOIN LATERAL (
      SELECT regexp_match(o, '^([A-Za-z][A-Za-z0-9+.-]*)://(?:[^@/?#]*@)?([^/?#]+)') AS m
    ) rx
  ) per_origin
  GROUP BY "id"
) n
WHERE p."id" = n."id"
  AND p."allowed_origins" IS DISTINCT FROM n."normalized";
