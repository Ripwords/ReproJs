# Reverse proxy

The dashboard speaks plain HTTP on `:3000`. For anything reachable outside localhost you want a reverse proxy doing TLS termination. Don't try to do HTTPS inside the container.

## What the proxy needs to do

1. Terminate TLS (Let's Encrypt or your own certs)
2. Forward everything to `localhost:3000`
3. Set `X-Forwarded-For` to the connecting client's address, **replacing** any value the client sent. Both the sign-in limiter and the intake limiter key on the *first* address in that header, so a proxy that appends lets a client choose its own rate-limit key. Without the header at all, the sign-in limits are skipped (see [Auth rate limits](./configuration#auth-rate-limits)).
4. Allow large request bodies — intake payloads carry base64 screenshots and gzipped replay events, up to ~10 MB

And two things to change on the Repro side:

```ini
BETTER_AUTH_URL=https://feedback.example.com   # was http://localhost:3000
TRUST_XFF=true                                  # trust the X-Forwarded-For your proxy sets
```

Restart the stack (`docker compose up -d`) after editing `.env`.

::: warning TRUST_XFF=true only behind a trusted proxy
With `TRUST_XFF=true`, per-IP rate limits key off the header value. If the dashboard is reachable directly *without* a proxy, any client can spoof `X-Forwarded-For` and bypass limits. Only flip it on once the proxy is enforcing who gets to send that header.
:::

## Caddy — the easy path

Caddy handles cert issuance + renewal automatically. The whole Caddyfile:

```caddy
feedback.example.com {
    reverse_proxy localhost:3000
}
```

That's it. Caddy talks to Let's Encrypt, sets `X-Forwarded-For` by default (ignoring whatever the client sent, unless you configure `trusted_proxies`), and handles HTTP/2 + HTTP/3. Point your DNS at the host and Caddy takes care of the rest.

### Running Caddy

If you're on the same host as Repro, install Caddy natively and put the Caddyfile in `/etc/caddy/Caddyfile`. Or run Caddy itself in Docker, on the host network, alongside the Repro compose.

## Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name feedback.example.com;

    ssl_certificate     /etc/letsencrypt/live/feedback.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/feedback.example.com/privkey.pem;

    # Intake payloads are multipart with screenshots + replay — be generous
    client_max_body_size 10M;

    # Strict-Transport-Security lives HERE, at the TLS terminator, not in the app
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        # $remote_addr, not $proxy_add_x_forwarded_for: the dashboard reads the
        # FIRST entry, and appending would keep a client-supplied first entry.
        proxy_set_header   X-Forwarded-For   $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Keep connections warm for better-auth's short-polling
        proxy_buffering    off;
        proxy_read_timeout 60s;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name feedback.example.com;
    return 301 https://$server_name$request_uri;
}
```

Certs from certbot: `certbot --nginx -d feedback.example.com`.

## Traefik — if you're already running it

For Docker-centric setups where Traefik is doing ingress. Add labels to the `dashboard` service in your `compose.yaml`:

```yaml
services:
  dashboard:
    # ... (the rest from the bundled compose)
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.repro.rule=Host(`feedback.example.com`)"
      - "traefik.http.routers.repro.entrypoints=websecure"
      - "traefik.http.routers.repro.tls.certresolver=letsencrypt"
      - "traefik.http.services.repro.loadbalancer.server.port=3000"
    networks:
      - traefik_proxy
      - default

networks:
  traefik_proxy:
    external: true
```

And drop the `ports:` mapping — Traefik handles ingress.

## Cloudflare Tunnel

If you can't expose ports directly (NAT, home-lab, dynamic IP), Cloudflare Tunnel works well. Create a tunnel, route `feedback.example.com` → `http://localhost:3000`, let Cloudflare handle TLS.

You still want `TRUST_XFF=true` — Cloudflare sets `X-Forwarded-For` with the real client IP and `CF-Connecting-IP` (equivalent) on every request.

## Serving on more than one hostname

Sign-in rejects requests from any origin other than `BETTER_AUTH_URL`. If the proxy answers on a second hostname too, either redirect that hostname to the canonical one (simplest), or list it in `BETTER_AUTH_TRUSTED_ORIGINS` — see [Configuration → Hostnames](./configuration#hostnames).

## Verifying

After the proxy is up:

```bash
# TLS reachable
curl -I https://feedback.example.com

# Dashboard is healthy behind the proxy
curl https://feedback.example.com/api/health
# → {"status":"ok"}

# X-Forwarded-For is being passed through — rate limits will key correctly
docker compose logs dashboard | grep -i "rate" | tail
```

If `/api/health` returns 200 over HTTPS and the dashboard UI loads, you're good.

## Split-origin deployments

Running the UI and API on different hostnames (e.g. `app.example.com` + `api.example.com`) isn't supported out of the box. The UI sends session cookies with `credentials: include`, which browsers only allow when the API's origin matches the UI's origin — or when the API explicitly emits credentialed CORS headers (which Repro does not).

If you need split-origin, you'll have to add CORS middleware to the dashboard. Same-origin is strongly recommended.
