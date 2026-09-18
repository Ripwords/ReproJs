# Storage

Every report brings attachments — the annotated screenshot, the logs bundle, the gzipped session replay. Repro writes them through a pluggable `StorageAdapter` interface. Pick one at deploy time:

- **Local disk** — a Docker volume. Zero config. Great for a single host.
- **S3-compatible** — any provider. Great for multi-host, managed durability, or when you outgrow a single disk.

## Local disk (default)

```ini
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=/data/attachments
```

The bundled `compose.yaml` mounts the `attachments_data` named Docker volume at `/data/attachments` inside the dashboard container. No further setup.

**When local disk is the right call:**

- Single host / single dashboard replica
- Homelabs, small teams, low volume
- Expected attachment storage <5–10 GB

**Backup with file-level tooling:**

```bash
docker run --rm -v repro_attachments_data:/data -v "$PWD:/out" alpine \
  tar czf /out/attachments-$(date +%F).tar.gz -C /data .
```

**Restore:**

```bash
docker run --rm -v repro_attachments_data:/data -v "$PWD:/in" alpine \
  sh -c "cd /data && tar xzf /in/attachments-YYYY-MM-DD.tar.gz"
```

## S3 (any S3-compatible provider)

```ini
STORAGE_DRIVER=s3
S3_BUCKET=repro-attachments
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# plus S3_ENDPOINT / S3_REGION / S3_VIRTUAL_HOSTED — see below
```

Create the bucket, mint an access key scoped to read + write on just that bucket, paste the creds in. No CORS rules needed — the dashboard is the only client that reads or writes the bucket.

### AWS S3

```ini
S3_BUCKET=my-repro-attachments
S3_REGION=us-east-1
S3_VIRTUAL_HOSTED=true
# S3_ENDPOINT intentionally blank — defaults to AWS
```

### Cloudflare R2 (recommended — $0 egress, free tier)

```ini
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=repro-attachments
S3_ACCESS_KEY_ID=<from R2 token creation>
S3_SECRET_ACCESS_KEY=<from R2 token creation>
```

Get creds from Cloudflare dashboard → R2 → Manage R2 API Tokens.

### Backblaze B2

```ini
S3_ENDPOINT=https://s3.<region>.backblazeb2.com
S3_REGION=<region>            # e.g. us-west-002
S3_BUCKET=repro-attachments
S3_ACCESS_KEY_ID=<B2 application key ID>
S3_SECRET_ACCESS_KEY=<B2 application key>
```

### Hetzner Object Storage

```ini
S3_ENDPOINT=https://<region>.your-objectstorage.com
S3_REGION=<region>            # e.g. nbg1
S3_BUCKET=repro-attachments
S3_ACCESS_KEY_ID=<Hetzner Object Storage creds>
S3_SECRET_ACCESS_KEY=<Hetzner Object Storage creds>
```

### Self-run MinIO / Garage / SeaweedFS

```ini
S3_ENDPOINT=http://<host>:<port>
S3_REGION=<anything>           # most self-hosted stores ignore region
S3_BUCKET=repro-attachments
S3_ACCESS_KEY_ID=<from your MinIO root or service account>
S3_SECRET_ACCESS_KEY=<from your MinIO root or service account>
```

Point `S3_ENDPOINT` at the service's address (internal IP + port if it's on the same Docker network, public URL otherwise).

## Picking between local and S3

| Factor                 | Local disk                       | S3                                                 |
| ---------------------- | -------------------------------- | -------------------------------------------------- |
| Setup effort           | Zero                             | Create bucket + access key                         |
| Ops cost               | Host disk + your backup tool     | Provider fees (usually small)                      |
| Durability             | Tied to the Docker volume        | 11 9s (AWS / R2 / B2) once replicated              |
| Scales horizontally    | No (single-host mount)           | Yes (multiple dashboard replicas)                  |
| Dashboard replicas     | 1                                | Many                                               |
| Total data ceiling     | Host disk size                   | Bucket-unbounded                                   |

## Switching between drivers

**Not supported without a migration.** The two backends never share state. If you need to switch:

1. Back up the existing attachments (tarball for local, bucket copy for S3)
2. Stop the stack (`docker compose down`)
3. Change `STORAGE_DRIVER` in `.env`
4. Set up the new backend (attach the new volume, create the new bucket)
5. Manually re-upload the historical attachments into the new backend using whatever tool matches it (`rclone`, `aws s3 cp`, etc.)
6. `docker compose up -d`

The `StorageAdapter` interface is three methods (`put`, `get`, `delete`) so a one-off migration script is trivial if you don't want to do it by hand — see `apps/dashboard/server/lib/storage/` for the existing implementations.

## Attachment lifecycle

- Screenshots are stored as `<report_id>/screenshot.png` (content-type: `image/png`)
- Logs bundle as `<report_id>/logs.json`
- Session replay as `<report_id>/replay.json.gz` (gzipped)
- In the dashboard, attachments load through your signed-in session. The screenshot embedded in a GitHub issue body is a signed link (`ATTACHMENT_URL_SECRET` signs it) that stays valid for about 100 years, because GitHub re-fetches issue images long after the issue is created. Anyone who can see the issue can open that link without signing in, which on a public repository means everyone. Images pasted into comments use signed links valid for one year. Rotating `ATTACHMENT_URL_SECRET` breaks all of these links; see [Configuration → Required](./configuration#required).

There's no automatic retention policy yet — attachments live until you delete their report (cascades). Bucket-level lifecycle rules on the S3 side are a reasonable stopgap if you need aging.
