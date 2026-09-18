# Operations

## Healthcheck

The dashboard exposes `GET /api/health`, returning `{ "status": "ok" }` on a successful DB ping and `503` otherwise with an error reason. Compose watches it every 15 seconds; an external uptime monitor (BetterStack, Uptime Kuma, PagerDuty) can poll it too.

```bash
curl https://feedback.example.com/api/health
# → {"status":"ok"}
```

## Logs

```bash
docker compose logs -f dashboard       # tail dashboard
docker compose logs -f                 # everything
docker compose logs migrator           # last migration run (one-shot)
```

Common log signals:

- `[seed-settings] app_settings singleton ensured` — dashboard booted successfully
- `link:` — magic-link URL when `MAIL_PROVIDER=console`
- `[github] enqueueSync failed on intake` — GitHub sync errored; doesn't block the report, but investigate
- `Daily report cap reached` — a project hit `daily_report_cap`; bump on the project's settings page

## Upgrades

```bash
docker compose pull
docker compose up -d
```

The migrator re-runs automatically before the dashboard restarts. A failing migration aborts the upgrade — the dashboard stays on the old image until you fix the issue.

**Reproducible deploys.** Pin `REPRO_VERSION=0.1.0` (or whichever tag) in `.env` instead of `latest`. Upgrades become a single-line change you can commit.

**Rolling back.** If a release breaks something, downgrade `REPRO_VERSION` in `.env` and `docker compose up -d`. The migrator won't un-run forward migrations, so this only works for non-schema-breaking releases. For schema-breaking releases, restore from a pre-upgrade Postgres dump.

## Backup

### Postgres

```bash
docker compose exec -T postgres pg_dump -U repro repro | gzip > repro-$(date +%F).sql.gz
```

Schedule via cron on the host. Keep 7–30 daily dumps offsite (S3 Glacier, Backblaze, off-host disk).

### Attachments

When `STORAGE_DRIVER=local`, the attachments live in the `repro_attachments_data` named volume:

```bash
docker run --rm -v repro_attachments_data:/data -v "$PWD:/out" alpine \
  tar czf /out/attachments-$(date +%F).tar.gz -C /data .
```

When `STORAGE_DRIVER=s3`, the bucket itself is your backup surface. Enable bucket versioning or object lock on the provider side.

### Config

The compose file + `.env` + (if using GitHub App) your `github-app.pem`. That's everything needed to reproduce the stack. Commit compose + a redacted `.env` to a private repo; keep `.pem` + real `.env` in your secrets store of choice.

## Restore

```bash
# Bring up just Postgres
docker compose up -d postgres

# Restore the dump
gunzip -c repro-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U repro repro

# Restore attachments volume (if local)
docker run --rm -v repro_attachments_data:/data -v "$PWD:/in" alpine \
  sh -c "cd /data && tar xzf /in/attachments-YYYY-MM-DD.tar.gz"

# Bring up the rest
docker compose up -d
```

The migrator re-applies automatically; if you're restoring on the same version, it's a no-op.

## Users and access

Install admins manage people under **Settings → Users** and **Settings → Access**.

**Access rules.** Two settings on **Settings → Access** decide who can sign in:

- **Allowed email domains.** When the list isn't empty, only emails on those domains can sign in or be invited, whether or not the sign-up gate is on. Someone who already has an account on another domain is refused at their next sign-in (their data stays, so clearing the list lets them back in). Leave the list empty to allow any domain.
- **Sign-up gate.** When on, a new person can only create an account if an admin invited them first. People who already have an account can still sign in.

Both apply to every sign-in method (magic link, GitHub, Google). An invite for an email outside the allowlist is refused when you send it, rather than failing later when the person tries to sign in.

**Invites.** An invited person shows as **invited** until they complete their first sign-in, then **active**. They must sign in with the invited address: signing in with GitHub or Google under a different primary email counts as a new, uninvited person.

**Disabling a user.** **Disable** on a user's row signs them out everywhere at once and blocks further sign-ins. Anyone still on a dashboard page is sent to the sign-in page with "Your account has been disabled" on their next navigation. **Reactivate** restores them: to **active** if they had signed in before, or back to **invited** if they never had.

**The last admin.** You can't disable or demote the last *active* install admin, so the install always has someone who can manage it. Disabled admins don't count. To hand over, promote the new admin first.

## Scaling

A single-container Repro comfortably handles small / medium teams — thousands of reports, tens of simultaneous admin users. Beyond that:

1. **Shared rate limits** — set `RATE_LIMIT_STORE=postgres` so rate limiters shard across dashboard replicas (defaults to per-worker memory). Requires the `rate_limit_buckets` table, which the migrator already creates.
2. **Multiple dashboard replicas** — behind the reverse proxy. Compose scaling:
   ```bash
   docker compose up -d --scale dashboard=3
   ```
   The migrator still runs once; replicas share it.
3. **Managed Postgres** — move off the Docker Postgres to RDS / Supabase / Neon / CrunchyData. Set `DATABASE_URL` yourself, drop the `postgres` service.
4. **S3 storage** — for multi-replica, you have to be on S3. Local disk is a single-host design.

## Host OS tuning

Not usually needed for small deployments, but worth a note:

- **Docker memory limit** — 512 MB is enough for the dashboard; 1 GB comfortable. Set via `deploy.resources.limits.memory`.
- **Postgres config** — the image defaults are fine up to ~10k reports. For millions of rows, tune `shared_buffers`, `work_mem`, `effective_cache_size` via a `postgresql.conf` bind-mount.
- **Log rotation** — `json-file` driver (Docker default) grows unbounded. Configure `log-opts` in `/etc/docker/daemon.json` with `max-size` + `max-file`.

## Sign-in problems

When sign-in fails, the sign-in page shows the reason. The common ones:

| Message on the sign-in page | Cause | Fix |
| --- | --- | --- |
| Sign-up is invite-only. Ask an admin to invite you first. | The sign-up gate is on and this email has no account or invite. Often the person was invited under a work address but signed in with GitHub or Google under a personal one. | Invite the address they actually sign in with, or ask them to use the magic link with the invited address. |
| Your email domain isn't allowed on this workspace. | The email's domain isn't in **Allowed email domains**. | Add the domain, or invite an address on an allowed domain. |
| Your account has been disabled, so you were signed out. | An admin disabled the account. | **Reactivate** it under **Settings → Users**. |
| Too many sign-in attempts from your network. | The auth rate limit (`AUTH_RATE_PER_IP_PER_15MIN`, 5 per 15 minutes by default) was hit. Everyone behind one office NAT or VPN shares it. | Wait 15 minutes. If it keeps happening, check the proxy sets `X-Forwarded-For` (see [Auth rate limits](./configuration#auth-rate-limits)) and raise the limit. |
| That sign-in link has already been used. | Magic links work once. A mail security scanner may have opened it first. | Request a fresh link. |
| That sign-in link expired. | Links last 5 minutes. | Request a fresh link. |

**Signed in, then straight back to the sign-in page with no message.** The browser dropped the session cookie. The usual cause is visiting the dashboard over plain `http://` while `BETTER_AUTH_URL` starts with `https://`: the cookie is then marked `Secure` (and named `__Secure-…`), and browsers discard it on an `http://` page. Always open the dashboard at exactly the `BETTER_AUTH_URL` address, through the TLS proxy. Opening `http://<server-ip>:3000` directly doesn't work once `BETTER_AUTH_URL` is https.

**"Invalid origin" (403) when requesting a magic link or starting GitHub/Google sign-in.** The page's origin doesn't match `BETTER_AUTH_URL`: a different hostname, `http` vs `https`, or a port. Use the canonical address, or add the other hostname to `BETTER_AUTH_TRUSTED_ORIGINS` (see [Configuration → Hostnames](./configuration#hostnames)).

**Some people can sign in and others can't.** Compare their emails against **Settings → Access**: the domain allowlist applies even with the sign-up gate off. Then check **Settings → Users** for a disabled account.

## Troubleshooting

**`POSTGRES_PASSWORD is required`** — compose refuses to start. Set it in `.env`, `docker compose up -d`.

**Magic-link email never arrives in console mode** — working as intended. `docker compose logs dashboard | grep link:` gives you the URL to paste.

**`S3 credentials missing` on first intake** — `STORAGE_DRIVER=s3` is set but the access-key vars are blank. Re-check `.env`, `docker compose up -d`.

**`drizzle-kit migrate` fails with "relation already exists"** — the database has an older schema applied via `db:push` rather than through migrations. Either start fresh (`docker compose down -v && docker compose up -d`) or reconcile `__drizzle_migrations` by hand.

**Dashboard never reaches healthy state** — `docker compose logs dashboard` usually surfaces a missing env var or DB connection issue. Healthchecks give up after 5 retries × 15s = ~75s.

**Attachments upload but fail to display in GitHub issues** — the dashboard generates signed URLs that GitHub's image renderer fetches. For `http://localhost:*`, GitHub can't reach you. Use a real hostname + proxy.

**Port 3000 in use** — set `PORT=3001` in `.env`, `docker compose up -d`. The container still listens on 3000 internally; only the host mapping changes.
