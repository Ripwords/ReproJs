# Integrations

All optional. Repro works fine without any of them.

## GitHub Issues sync

A GitHub App (not OAuth) that lets the dashboard:

- Create an issue from a report with one click, or automatically on intake
- Mirror status two ways: close a Repro ticket → close the issue; close the issue → resolve the ticket

### Creating the GitHub App (recommended: in-app manifest wizard)

Repro generates the entire GitHub App for you — no manual form-filling. Each self-hosted instance creates its own app tied to its own domain, so your credentials never pass through any third-party server.

**Prerequisites**

- `ENCRYPTION_KEY` is set in your `.env` (generate with `openssl rand -base64 32`). Required because the app's private key, webhook secret, and client secret are stored encrypted at rest in the `github_app` table.
- You're signed in to the dashboard as an **admin** (not a project-scoped role).

**Steps**

1. Open **Settings → GitHub** in the dashboard sidebar.
2. Optionally type a GitHub **organization** slug (e.g. `acme`). Leave empty to create the app on your personal GitHub account.
3. Click **Create GitHub App**. You'll be redirected to GitHub.
4. Review the app details on GitHub's page and click **Create GitHub App for…**. GitHub creates the app and redirects back to Repro with a one-time code.
5. Repro exchanges the code, stores the credentials encrypted, and redirects you to the GitHub settings page with a success banner.

That's it — no env vars to set.

#### Enable webhooks (one manual step)

GitHub refuses to create an app whose webhook URL isn't publicly reachable, so Repro creates the app with webhooks **disabled**. Two-way sync (GitHub issue closed → Repro ticket closed) needs webhooks enabled. Enable them after the app is created:

1. On the success page, click **your GitHub App settings page** (or open `https://github.com/settings/apps/<slug>` directly).
2. Scroll to the **Webhook** section.
3. Set the **Webhook URL** to `<BETTER_AUTH_URL>/api/integrations/github/webhook` (for example, `https://feedback.example.com/api/integrations/github/webhook`).
4. Check **Active** and click **Save changes**.

The webhook secret was generated and stored during setup — leave that field alone.

> **Local dev note.** If `BETTER_AUTH_URL` is `http://localhost:3000`, the manifest wizard fills `example.com` as a placeholder webhook URL so GitHub's reachability check passes. Once you deploy to a real domain, update both the URL and the **Active** checkbox on GitHub.

### Creating the GitHub App (legacy: env vars)

Skip this section if you used the manifest wizard above.

For deployments that prefer static configuration (Infrastructure-as-Code, secrets managers, etc.), you can create the app manually and wire it via env vars. The credential resolver prefers env vars over the in-app setup when both are present.

1. Open [github.com/settings/apps](https://github.com/settings/apps) (or your org's App settings)
2. Click **New GitHub App**
3. Fill in:
   - **GitHub App name**: `Repro` (or whatever — the slug becomes public)
   - **Homepage URL**: your `BETTER_AUTH_URL` (e.g. `https://feedback.example.com`)
   - **Callback URL** (User authorization): `<BETTER_AUTH_URL>/api/auth/callback/github` — this is where GitHub returns after "Sign in with GitHub". It must match better-auth's social-callback path.
   - **Setup URL** (App installation): `<BETTER_AUTH_URL>/api/integrations/github/install-callback` (and tick **Redirect on update**)
   - **Webhook URL**: `<BETTER_AUTH_URL>/api/integrations/github/webhook`
   - **Webhook secret**: run `openssl rand -hex 32`, paste here AND save it for `.env`
4. **Repository permissions**:
   - **Issues**: Read + write
   - **Metadata**: Read-only (required — GitHub auto-checks)
5. **Account permissions**:
   - **Email addresses**: Read-only — required so better-auth's GitHub provider can read the signing-in user's email on first sign-in; without it you'll see `email_not_found` errors.
6. **Subscribe to events**: `Issues` only. `Installation` and `Installation repositories` are auto-delivered — if you check them, GitHub rejects the form with "Default events unsupported".
7. **Where can this GitHub App be installed**: **Any account**. If you pick "Only on this account", non-owner teammates will 404 when they click "Sign in with GitHub" — GitHub hides private apps from non-owners on the authorize URL. The app stays unlisted (Marketplace is a separate opt-in).
8. Click **Create GitHub App**
9. On the new App's settings page, scroll to **Private keys** → **Generate a private key** → a `.pem` file downloads
10. Note the **App ID** and **Client ID** at the top of the settings page, then click **Generate a new client secret** and copy it

Wire it up:

```ini
GITHUB_APP_ID=12345
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=<same secret you pasted into step 3>
GITHUB_APP_SLUG=<slug from https://github.com/apps/<slug>>
GITHUB_APP_CLIENT_ID=<Client ID from step 10>
GITHUB_APP_CLIENT_SECRET=<client secret from step 10>
```

Set all five of `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`. If any one is missing, the dashboard ignores all of them and uses the app created by the in-app wizard instead, or reports GitHub as not configured if there isn't one. **Settings → GitHub** shows which source is in use (**Env vars** or **In-app setup**).

The `GITHUB_APP_PRIVATE_KEY` accepts either:

- **Literal PEM contents** with newlines as `\n` (paste the whole file, replacing real newlines with `\n`)
- **An absolute path** to a `.pem` file — the dashboard will `readFile` it at startup

For container deploys, mount the `.pem` as a Docker secret or bind-mount it read-only:

```yaml
# compose.yaml override
services:
  dashboard:
    volumes:
      - ./github-app.pem:/secrets/github-app.pem:ro
```

Then `GITHUB_APP_PRIVATE_KEY=/secrets/github-app.pem`.

### Installing the App on a repo

Once the app is set up (either path), a project owner opens the project in the dashboard → **Integrations**, and clicks **Install on GitHub** on the **GitHub Issues** card. GitHub asks which account and repositories to install the app on. When you click **Install** (or **Save**), GitHub redirects back to the dashboard's setup URL (`/api/integrations/github/install-callback`), which records the installation on the project and returns you to the **Integrations** page. This redirect, not a webhook, is what links the installation, so it works before webhooks are enabled.

Then pick the **Repository** on the same card. Issues can't be created until a repository is chosen.

If the app is later uninstalled or loses access, the card shows **Disconnected** and the button becomes **Reconnect on GitHub**.

#### Sync settings

The **GitHub Issues** card has two switches, which only a project owner can change:

- **Push edits to GitHub**: when on, changes to a linked report's status, priority, and labels in the dashboard update the GitHub issue.
- **Automatically create a GitHub issue for every new report**: when on, each report submitted through the SDK becomes a linked GitHub issue as soon as it arrives. When off, create issues one at a time with **Create issue** on a report. This switch is unavailable until a repository is picked.

Both are **on** for a project connected with **Install on GitHub**. A project whose connection row was created some other way (for example, by an upgrade from an older version) starts with both off. **Default labels** and **Default assignees** on the same card are applied to every issue the dashboard creates. Click **Save defaults** to keep changes to the switches and defaults.

Who can change the project's GitHub connection:

- **Owner** (and install admins): install, pick the repository, save default labels / assignees and the sync toggles, disconnect.
- **Developer** and above: **Retry failed** (re-queues every failed sync job), and create new labels on the repo from a report's **Labels** picker.
- **Manager** and above: retry a single failed report, and apply existing labels.
- **Viewer**: read-only.

Everyone on the project can see the panel. Controls your role can't use are shown disabled with a note saying which role they need.

### Troubleshooting

**Issues appear in Repro but never in GitHub** — check `docker compose logs dashboard | grep -i "github"`. Usually an invalid private key (key was not generated for this App) or a wrong `GITHUB_APP_ID`.

**Webhook signature mismatch** — the `GITHUB_APP_WEBHOOK_SECRET` in `.env` must match exactly what you pasted into GitHub's **Webhook secret** field.

**Attachments don't render in issue bodies** — the screenshot in an issue body is a signed link back to your dashboard, which GitHub's image proxy fetches. If your `BETTER_AUTH_URL` is `http://localhost:3000`, GitHub's servers can't reach it. Use a real hostname + proxy. Images also break if `ATTACHMENT_URL_SECRET` has changed since the issue was created; see [Configuration → Required secrets](./configuration#required).

### Rotating the webhook secret

Rotate the webhook secret from the GitHub App's settings page. After GitHub issues the new secret:

1. **If you set it via env (`GITHUB_APP_WEBHOOK_SECRET`):** update the env var and restart the dashboard. Any webhooks that land during the restart fail signature verification; GitHub retries with exponential backoff — they succeed once the new secret is live. Write-locks' 30s TTL tolerates the gap cleanly.

2. **If you set it via the manifest wizard:** the dashboard has no control for changing the stored secret. You have two options:
   - **Keep the same app (recommended):** set a new secret on the GitHub App's settings page, then switch to env vars by setting all five `GITHUB_APP_*` credentials described in [Creating the GitHub App (legacy: env vars)](#creating-the-github-app-legacy-env-vars), including a newly generated private key and client secret. Env vars take precedence over the stored credentials, and existing project installations keep working because the app is the same.
   - **Start over with a new app:** on **Settings → GitHub**, click **Disconnect**, then **Create GitHub App** again. Disconnecting deletes the stored credentials, every project's GitHub connection, and any pending sync jobs, so each project owner must click **Install on GitHub** again. The old app stays on GitHub until you delete it from the app's **Advanced** settings.

The webhook endpoint requires HTTPS — GitHub will refuse to deliver over plain HTTP. We intentionally do **not** enforce IP allowlisting: self-hosters behind reverse proxies / CDNs routinely see rewritten source IPs, and the enforcement breaks more deployments than it defends.

Defence in depth: every webhook request passes four checks in order — body size cap (5 MB), HMAC-SHA256 signature, `X-GitHub-Delivery` replay dedupe, and installation-id allowlist. Random traffic hitting `/api/integrations/github/webhook` gets 401 at step 2; replays get 202-noop at step 3; stolen-secret attacks against unknown installations get 202-noop at step 4.

## OAuth sign-in

GitHub and Google OAuth via `better-auth`. Leave the secrets blank to hide the buttons.

### GitHub OAuth App

If you already installed a GitHub App via the manifest wizard above, skip creating a separate OAuth App — the GitHub App's own `client_id` / `client_secret` can power "Sign in with GitHub". Open **Settings → GitHub** in the dashboard, scroll to the **GitHub sign-in credentials** card, reveal the secret, and paste both values into `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Restart the dashboard and the "Sign in with GitHub" button appears.

Otherwise, create a standalone OAuth App:

1. [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**
2. **Application name**: Repro (or whatever)
3. **Homepage URL**: your `BETTER_AUTH_URL`
4. **Authorization callback URL**: `<BETTER_AUTH_URL>/api/auth/callback/github`
5. Create, grab the **Client ID** and generate a **Client secret**

```ini
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Restart the stack — the "Sign in with GitHub" button shows up.

### Google OAuth

1. [console.cloud.google.com](https://console.cloud.google.com/) → APIs & Services → Credentials
2. **Create Credentials** → OAuth 2.0 Client ID → Web application
3. **Authorized redirect URIs**: `<BETTER_AUTH_URL>/api/auth/callback/google`
4. Copy the **Client ID** + **Client secret**

```ini
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Note: Google also requires a published OAuth consent screen before external users can sign in. In dev mode, only emails you add as test users can sign in.

## Email (SMTP)

Any SMTP provider — SES, Postmark, Resend, SendGrid, Gmail, self-run Postfix.

```ini
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxxxxxxxxxxxx
SMTP_FROM="Repro <noreply@example.com>"
```

Verify a test magic-link email arrives: sign out → sign in → enter your email → check the inbox.

### Common pitfalls

- **DMARC / SPF on your domain** — if you're sending `From: noreply@example.com`, your sending domain needs SPF + DKIM set up or the mail lands in spam. Most providers have a setup checklist.
- **Port 465 vs 587** — 587 with STARTTLS is the modern default. 465 (implicit TLS) also works for most nodemailer setups.
- **Gmail SMTP** — you'll need an App Password, not your account password. And their rate limits are strict enough that a small team might hit them on bulk invites.

## Storage integrations

See [Storage](./storage) for S3-compatible endpoints (AWS, R2, B2, Hetzner, MinIO, Garage).
