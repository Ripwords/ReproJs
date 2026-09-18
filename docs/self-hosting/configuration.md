# Configuration

Every Repro setting is a single environment variable. The bundled `compose.yaml` reads them from `.env` in the same directory. This page is the exhaustive reference; grab [`.env.example`](https://github.com/Ripwords/ReproJs/blob/main/.env.example) for a well-commented template.

## Required

You need exactly four values to boot:

| Variable                 | Description                                                                                       | Generate with                |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| `POSTGRES_PASSWORD`      | Postgres password. Kept internal to the Docker network.                                           | `openssl rand -hex 32`       |
| `BETTER_AUTH_URL`        | Base URL your dashboard is served at. Must match the origin visitors use (session cookies).       | —                            |
| `BETTER_AUTH_SECRET`     | Session-cookie signing secret.                                                                    | `openssl rand -hex 32`       |
| `ATTACHMENT_URL_SECRET`  | Signs the attachment links embedded in GitHub issues and comments. See the warning below.         | `openssl rand -hex 32`       |

Without these four the stack refuses to start (compose refuses interpolation; the dashboard refuses to boot).

::: warning Rotating `ATTACHMENT_URL_SECRET` breaks existing image links
The dashboard signs the links to screenshots it embeds in GitHub issues and to images pasted into comments. These links don't expire in practice: issue screenshots are valid for about 100 years and comment images for one year. Changing `ATTACHMENT_URL_SECRET` invalidates every link signed so far. Each screenshot already embedded in a GitHub issue shows as a broken image, and so does every image pasted into a comment, in both the dashboard and GitHub. There's no way to re-sign old links, so rotate only if the secret has leaked.

A signed link needs no sign-in. Anyone who can see the GitHub issue can open its screenshot, and on a public repository that's everyone.
:::

## Hostnames

Sign-in only accepts requests whose origin is `BETTER_AUTH_URL`. If people reach the same install on more than one hostname, list the others here.

| Variable                       | Default | Description                                                                                                                                              |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_TRUSTED_ORIGINS`  | —       | Extra origins, comma-separated. Each entry needs its scheme; the dashboard refuses to boot otherwise. |

For example:

```bash
BETTER_AUTH_TRUSTED_ORIGINS=https://feedback.internal.example.com,https://*.example.com
```

This only relaxes the origin check. Session cookies still belong to the hostname that set them, so someone who signs in on one hostname is signed out on the other, and OAuth callbacks and emailed magic links always use `BETTER_AUTH_URL`. For most installs, one canonical hostname (with the others redirecting to it at the proxy) is simpler.

## Compose overrides

Optional knobs the bundled compose reads:

| Variable            | Default  | Description                                                                  |
| ------------------- | -------- | ---------------------------------------------------------------------------- |
| `REPRO_VERSION`     | `latest` | Pin the image tag. Recommended in prod so you control when you upgrade.      |
| `PORT`              | `3000`   | Host port the dashboard binds to. Container internal port is always 3000.    |
| `POSTGRES_USER`     | `repro`  | Postgres user name.                                                          |
| `POSTGRES_DB`       | `repro`  | Postgres database name.                                                      |

The compose file wires `DATABASE_URL` internally to the postgres service — don't set it yourself when using compose.

## Storage

See [Storage](./storage) for per-provider endpoints.

| Variable                    | Default                | Description                                                       |
| --------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `STORAGE_DRIVER`            | `local`                | `local` (Docker volume) or `s3` (any S3-compatible endpoint).     |
| `STORAGE_LOCAL_ROOT`        | `/data/attachments`    | Path inside the container. Compose mounts the volume here.        |
| `S3_BUCKET`                 | —                      | Bucket name (s3 only).                                            |
| `S3_REGION`                 | —                      | Region (s3 only). `auto` for R2; any string for MinIO.            |
| `S3_ACCESS_KEY_ID`          | —                      | Access key (s3 only).                                             |
| `S3_SECRET_ACCESS_KEY`      | —                      | Secret (s3 only).                                                 |
| `S3_ENDPOINT`               | —                      | Leave empty for AWS; per-provider URL otherwise.                  |
| `S3_VIRTUAL_HOSTED`         | `false`                | `true` for AWS S3 (virtual-hosted addressing); `false` elsewhere. |

## Email

Magic-link sign-in + invite delivery.

| Variable         | Default                                 | Description                                                                               |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `MAIL_PROVIDER`  | `console`                               | `console` (logs the link to stdout), `smtp` (real email), `ethereal` (nodemailer preview). |
| `SMTP_HOST`      | —                                       | SMTP server hostname (when `MAIL_PROVIDER=smtp`).                                         |
| `SMTP_PORT`      | `587`                                   | SMTP port.                                                                                |
| `SMTP_USER`      | —                                       | SMTP auth user.                                                                           |
| `SMTP_PASS`      | —                                       | SMTP auth password.                                                                       |
| `SMTP_FROM`      | `Repro <no-reply@localhost>`            | `From:` header on sent mail.                                                              |

`console` is the right default for the first boot — grab the magic-link URL from `docker compose logs dashboard | grep link:`, paste it into your browser, and press **Sign in** on the page that opens. Switch to `smtp` once you want real users to receive email.

## OAuth sign-in

Buttons are hidden on the sign-in page when the secrets are blank. Leave the fields empty to disable a provider.

| Variable                 | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `GITHUB_CLIENT_ID`       | GitHub OAuth App client id.                          |
| `GITHUB_CLIENT_SECRET`   | GitHub OAuth App client secret.                      |
| `GOOGLE_CLIENT_ID`       | Google OAuth client id.                              |
| `GOOGLE_CLIENT_SECRET`   | Google OAuth client secret.                          |

Callback URLs you'll need in the OAuth app configuration:

- `<BETTER_AUTH_URL>/api/auth/callback/github`
- `<BETTER_AUTH_URL>/api/auth/callback/google`

## GitHub Issues sync

Uses a GitHub App (not OAuth). See [Integrations → GitHub](./integrations#github-issues-sync) for the walkthrough.

| Variable                     | Default  | Description                                                               |
| ---------------------------- | -------- | ------------------------------------------------------------------------- |
| `GITHUB_APP_ID`              | —        | Numeric App ID from the App's settings page.                              |
| `GITHUB_APP_PRIVATE_KEY`     | —        | Literal PEM contents (newlines as `\n`) or an absolute path to a `.pem`.  |
| `GITHUB_APP_WEBHOOK_SECRET`  | —        | Whatever you pasted into the App's Webhook secret field.                  |
| `GITHUB_APP_SLUG`            | `repro`  | Slug from the App's public URL (e.g. `https://github.com/apps/<slug>`).   |
| `GITHUB_APP_CLIENT_ID`       | —        | Client ID from the App's settings page.                                   |
| `GITHUB_APP_CLIENT_SECRET`   | —        | A client secret generated on the App's settings page.                     |
| `GITHUB_WEBHOOK_MAX_BYTES`   | `1048576`| Currently ignored. Webhook bodies over 5 MB are always rejected.          |

These are only needed if you create the GitHub App by hand instead of with the in-app wizard. Set all five of `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`: if any is missing, the dashboard ignores them all and uses the wizard-created app, if there is one.

## Database connection + pool

`DATABASE_URL` is set by the compose file to the internal postgres service. If you're running the dashboard outside compose (pointing at a managed Postgres), set it yourself to `postgres://user:pass@host:5432/dbname`.

| Variable                      | Default  | Description                                                             |
| ----------------------------- | -------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`                | —        | Postgres connection string. Required if not using the bundled compose.  |
| `DB_POOL_MAX`                 | `10`     | Max concurrent connections per dashboard worker.                        |
| `DB_STATEMENT_TIMEOUT_MS`     | `30000`  | Kills any single query exceeding this many ms.                          |
| `DB_IDLE_TX_TIMEOUT_MS`       | `10000`  | Kills connections held open by a leaked `BEGIN`.                        |

## Intake limits

Tune the SDK intake path. Defaults are safe — only change if you have a specific reason.

| Variable                    | Default     | Description                                                                                   |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `INTAKE_RATE_PER_KEY`       | `60`        | Reports / minute / project.                                                                   |
| `INTAKE_RATE_PER_IP`        | `20`        | Reports / minute / IP.                                                                        |
| `INTAKE_RATE_PER_KEY_ANON`  | `10`        | Stricter bucket for anonymous submissions (no `reporter.userId`).                             |
| `INTAKE_MAX_BYTES`          | `5242880`   | Max total multipart payload (5 MB).                                                           |
| `INTAKE_REQUIRE_DWELL`      | `true`      | Reject submissions that omit `_dwellMs`. Set `false` during a rolling SDK upgrade only.       |
| `INTAKE_MIN_DWELL_MS`       | `1500`      | Minimum ms between widget-open and submit (anti-bot).                                         |
| `INTAKE_REPLAY_MAX_BYTES`   | `1048576`   | Max gzipped bytes per replay attachment.                                                      |
| `REPLAY_FEATURE_ENABLED`    | `true`      | Kill-switch for session replay across the whole install.                                      |
| `TRUST_XFF`                 | `false`     | Trust `X-Forwarded-For`. **Only set `true` when behind a trusted reverse proxy** — spoofable. |

## Auth rate limits

Protects `/api/auth/sign-in/*` (sending a magic link, starting an OAuth sign-in) and `/api/auth/magic-link/verify` from credential-stuffing / enumeration. Each path has its own allowance. Session checks, sign-out, and OAuth callbacks are not limited.

| Variable                        | Default                       | Description                                                                                   |
| ------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `AUTH_RATE_PER_IP_PER_15MIN`    | `5`                           | Max attempts per IP per path per 15-minute window.                                            |
| `AUTH_RATE_LIMIT_ENABLED`       | on in prod; off in dev/test   | Explicit override: `true` force-on, `false` force-off.                                        |
| `RATE_LIMIT_STORE`              | `memory`                      | `memory` (per-worker, fine for single replica) or `postgres` (shared across replicas). Applies to the intake and invite limits only; the auth limits are always kept in each worker's memory. |

The auth limiter finds the client IP differently from the intake limiter:

- It reads the **first** address in `X-Forwarded-For`, whether or not `TRUST_XFF` is set.
- If that header is missing, it can't tell clients apart and **skips the limit**, logging `Rate limiting skipped: could not determine client IP address` once.

So in production, run the dashboard behind a reverse proxy that **overwrites** `X-Forwarded-For` with the connecting client's address. See [Reverse proxy](./reverse-proxy#what-the-proxy-needs-to-do).

Everyone behind one office NAT or VPN shares one IP, and so one allowance. When a sign-in hits the limit, people see "Too many sign-in attempts from your network" on the sign-in page. If a whole office keeps hitting it, raise `AUTH_RATE_PER_IP_PER_15MIN` rather than turning the limit off.

## Invites

| Variable                   | Default | Description                                                                    |
| -------------------------- | ------- | ------------------------------------------------------------------------------ |
| `INVITE_RATE_PER_ADMIN`    | `5`     | Invite emails / minute / admin. Catches runaway loops before SMTP quota does.  |

## Runtime

| Variable      | Default       | Description                                  |
| ------------- | ------------- | -------------------------------------------- |
| `NODE_ENV`    | `production`  | Set by the image. Don't override in `.env`.  |
| `NITRO_HOST`  | `0.0.0.0`     | Bind address. Don't override.                |
| `NITRO_PORT`  | `3000`        | Container internal port.                     |

## Validating your config

Compose can dry-run interpolation without starting anything:

```bash
docker compose config
```

Anything missing or malformed surfaces immediately.
