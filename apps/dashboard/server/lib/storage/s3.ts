import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { env } from "../env"
import type { StorageAdapter, StorageStream } from "./index"

function resolveCredentials(): { accessKeyId: string; secretAccessKey: string } {
  const envId = env.S3_ACCESS_KEY_ID
  const envSecret = env.S3_SECRET_ACCESS_KEY
  if (envId && envSecret) return { accessKeyId: envId, secretAccessKey: envSecret }
  throw new Error("S3 credentials missing. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.")
}

const BLOCKED_HOSTS = new Set([
  // AWS EC2 IMDS (IPv4)
  "169.254.169.254",
  // AWS EC2 IMDS — IPv6-mapped IPv4 forms that reach the same endpoint on dual-stack hosts
  "::ffff:169.254.169.254",
  "::ffff:a9fe:a9fe",
  // AWS Nitro IPv6 IMDS
  "fd00:ec2::254",
  // AWS documented IMDS hostname aliases (with search-domain set)
  "instance-data",
  "instance-data.ec2.internal",
  // GCP metadata
  "metadata.google.internal",
  "metadata",
  // Azure / Alibaba / DigitalOcean / Hetzner all use 169.254.169.254 — covered above
])

/**
 * Normalizes a hostname for blocklist comparison and checks it against known
 * cloud-metadata endpoints and the full link-local /16 range.
 */
function isBlockedMetadataHost(hostname: string): boolean {
  const h = hostname
    .toLowerCase()
    .replace(/\.$/, "") // strip trailing dot (FQDN)
    .replace(/^\[|\]$/g, "") // defensive: strip IPv6 brackets if somehow present
  if (BLOCKED_HOSTS.has(h)) return true
  // Full AWS/Azure/Alibaba/DO/Hetzner link-local /16 — covers arbitrary probes
  // like 169.254.42.1 that an attacker could use to reach internal services.
  if (h.startsWith("169.254.")) return true
  return false
}

/**
 * Validates S3_ENDPOINT to prevent SSRF via cloud instance-metadata services.
 * Enforces http/https protocol and blocks known metadata IP/hostnames.
 */
function validateS3Endpoint(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`S3_ENDPOINT is not a valid URL: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`S3_ENDPOINT protocol must be http/https, got ${url.protocol}`)
  }
  // Block AWS / GCP / Azure / etc. instance metadata services regardless of DNS tricks,
  // IPv6-mapped bypasses, or alternate link-local probes.
  const host = url.hostname
  if (isBlockedMetadataHost(host)) {
    throw new Error(`S3_ENDPOINT points at instance metadata (${host}); refusing.`)
  }
  return url.toString().replace(/\/$/, "") // drop trailing slash for consistency
}

export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client
  private readonly bucket: string

  // `client` param is a test-only injection seam so getStream's Head-fallback logic
  // can be exercised against a mocked S3Client instead of a live endpoint.
  constructor(client?: S3Client) {
    this.bucket = env.S3_BUCKET
    if (client) {
      this.client = client
      return
    }
    const endpoint = env.S3_ENDPOINT ? validateS3Endpoint(env.S3_ENDPOINT) : undefined
    this.client = new S3Client({
      ...(endpoint ? { endpoint } : {}),
      region: env.S3_REGION,
      forcePathStyle: !env.S3_VIRTUAL_HOSTED,
      credentials: resolveCredentials(),
    })
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    )
    return { key }
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!res.Body) throw new Error(`S3 get: empty body for ${key}`)
    const bytes = new Uint8Array(await res.Body.transformToByteArray())
    const contentType = res.ContentType ?? "application/octet-stream"
    return { bytes, contentType }
  }

  async getStream(key: string, range?: { start: number; end?: number }): Promise<StorageStream> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
      }),
    )
    if (!res.Body) throw new Error(`S3 get: empty body for ${key}`)
    const contentType = res.ContentType ?? "application/octet-stream"
    const stream = res.Body.transformToWebStream()

    if (range) {
      const match = res.ContentRange ? /\/(\d+)$/.exec(res.ContentRange) : null
      let totalBytes: number
      if (match) {
        totalBytes = Number(match[1])
      } else {
        // Some S3-compatibles (e.g. certain MinIO/Garage configs) omit ContentRange on
        // 206 responses. res.ContentLength there is only the partial byte count, which
        // would violate StorageStream.totalBytes' "full object size" contract and corrupt
        // downstream Content-Range headers. Fetch the true size via HEAD instead.
        const head = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        )
        totalBytes = head.ContentLength ?? 0
      }
      return {
        stream,
        contentType,
        totalBytes,
        start: range.start,
        end: range.end ?? totalBytes - 1,
      }
    }

    const totalBytes = res.ContentLength ?? 0
    return { stream, contentType, totalBytes, start: 0, end: totalBytes - 1 }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
