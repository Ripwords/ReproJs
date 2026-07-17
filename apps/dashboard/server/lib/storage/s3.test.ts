import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { _reloadEnvForTesting } from "../env"
import { S3Adapter } from "./s3"

// validateS3Endpoint is not exported; we exercise it through the S3Adapter
// constructor by setting S3_ENDPOINT and asserting that construction throws.
//
// The env module parses `process.env` once at import time, so each test must
// mutate `process.env` and then call `_reloadEnvForTesting()` to refresh the
// validated snapshot before instantiating `S3Adapter`.

const SAVED: Record<string, string | undefined> = {}
const ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_REGION",
  "S3_VIRTUAL_HOSTED",
] as const

beforeEach(() => {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k]
  // Provide valid credentials so the only failure mode under test is the endpoint validator.
  process.env.S3_ACCESS_KEY_ID = "test-access-key"
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-key"
  process.env.S3_BUCKET = "test-bucket"
  process.env.S3_REGION = "us-east-1"
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    const prev = SAVED[k]
    if (prev === undefined) delete process.env[k]
    else process.env[k] = prev
  }
  _reloadEnvForTesting()
})

function expectEndpointRejected(endpoint: string): void {
  process.env.S3_ENDPOINT = endpoint
  _reloadEnvForTesting()
  expect(() => new S3Adapter()).toThrow(/instance metadata|not a valid URL|protocol must be/)
}

function expectEndpointAccepted(endpoint: string): void {
  process.env.S3_ENDPOINT = endpoint
  _reloadEnvForTesting()
  expect(() => new S3Adapter()).not.toThrow()
}

describe("validateS3Endpoint SSRF blocklist", () => {
  describe("AWS EC2 IMDS — IPv4", () => {
    test("blocks 169.254.169.254", () => {
      expectEndpointRejected("http://169.254.169.254/")
    })

    test("blocks 169.254.169.254 on https", () => {
      expectEndpointRejected("https://169.254.169.254/latest/meta-data/")
    })
  })

  describe("AWS EC2 IMDS — IPv6-mapped IPv4 bypass", () => {
    test("blocks ::ffff:169.254.169.254 (dotted IPv4-mapped form)", () => {
      expectEndpointRejected("http://[::ffff:169.254.169.254]/")
    })

    test("blocks ::ffff:a9fe:a9fe (hex IPv4-mapped form)", () => {
      expectEndpointRejected("http://[::ffff:a9fe:a9fe]/")
    })
  })

  describe("AWS Nitro IPv6 IMDS", () => {
    test("blocks fd00:ec2::254", () => {
      expectEndpointRejected("http://[fd00:ec2::254]/")
    })
  })

  describe("AWS IMDS hostname aliases", () => {
    test("blocks instance-data", () => {
      expectEndpointRejected("http://instance-data/")
    })

    test("blocks instance-data.ec2.internal", () => {
      expectEndpointRejected("http://instance-data.ec2.internal/")
    })

    test("blocks instance-data. (FQDN with trailing dot)", () => {
      expectEndpointRejected("http://instance-data./")
    })
  })

  describe("GCP metadata", () => {
    test("blocks metadata.google.internal", () => {
      expectEndpointRejected("http://metadata.google.internal/")
    })

    test("blocks bare metadata", () => {
      expectEndpointRejected("http://metadata/")
    })

    test("blocks METADATA.GOOGLE.INTERNAL (case-insensitive)", () => {
      expectEndpointRejected("http://METADATA.GOOGLE.INTERNAL/")
    })
  })

  describe("link-local /16 range", () => {
    test("blocks arbitrary 169.254.x.x (e.g. 169.254.42.1)", () => {
      expectEndpointRejected("http://169.254.42.1/")
    })

    test("blocks 169.254.0.1", () => {
      expectEndpointRejected("http://169.254.0.1/")
    })

    test("blocks 169.254.255.255", () => {
      expectEndpointRejected("http://169.254.255.255/")
    })
  })

  describe("protocol allowlist", () => {
    test("rejects file://", () => {
      expectEndpointRejected("file:///etc/passwd")
    })

    test("rejects ftp://", () => {
      expectEndpointRejected("ftp://example.com/")
    })

    test("rejects garbage strings", () => {
      expectEndpointRejected("not-a-url")
    })
  })

  describe("valid endpoints are accepted", () => {
    test("accepts AWS S3 public endpoint", () => {
      expectEndpointAccepted("https://s3.us-east-1.amazonaws.com/")
    })

    test("accepts custom MinIO endpoint", () => {
      expectEndpointAccepted("http://minio.internal.example.com:9000/")
    })

    test("accepts 170.254.169.254 (outside link-local /16)", () => {
      // Sanity: the regex is anchored to 169.254. so adjacent ranges aren't caught.
      expectEndpointAccepted("https://170.254.169.254/")
    })
  })
})

function webStreamOfBytes(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })
}

/** Minimal S3Client stand-in; `send` is swapped per-test via the injection seam on S3Adapter. */
function fakeClient(
  sendImpl: (command: GetObjectCommand | HeadObjectCommand) => Promise<unknown>,
): S3Client {
  return { send: mock(sendImpl) } as unknown as S3Client
}

describe("S3Adapter#getStream", () => {
  test("range requested, backend 206 omits ContentRange: totalBytes comes from HeadObjectCommand, not the partial ContentLength", async () => {
    let headCalls = 0
    const client = fakeClient(async (command) => {
      if (command instanceof HeadObjectCommand) {
        headCalls++
        return { ContentLength: 100 }
      }
      // GetObjectCommand: 206 response WITHOUT ContentRange, ContentLength is the
      // partial (4-byte) size only — must not leak into totalBytes.
      return {
        Body: { transformToWebStream: () => webStreamOfBytes([1, 2, 3, 4]) },
        ContentLength: 4,
        ContentType: "video/webm",
      }
    })
    const adapter = new S3Adapter(client)

    const result = await adapter.getStream("videos/clip.webm", { start: 0, end: 3 })

    expect(result.totalBytes).toBe(100)
    expect(result.start).toBe(0)
    expect(result.end).toBe(3)
    expect(headCalls).toBe(1)
  })

  test("open-ended range with missing ContentRange: end is derived from the HEAD-corrected totalBytes", async () => {
    const client = fakeClient(async (command) => {
      if (command instanceof HeadObjectCommand) return { ContentLength: 100 }
      return {
        Body: { transformToWebStream: () => webStreamOfBytes([1, 2, 3, 4]) },
        ContentLength: 4,
        ContentType: "video/webm",
      }
    })
    const adapter = new S3Adapter(client)

    const result = await adapter.getStream("videos/clip.webm", { start: 96 })

    expect(result.totalBytes).toBe(100)
    expect(result.start).toBe(96)
    expect(result.end).toBe(99)
  })

  test("range requested, backend includes ContentRange: totalBytes parsed from it, no HEAD call", async () => {
    let headCalls = 0
    const client = fakeClient(async (command) => {
      if (command instanceof HeadObjectCommand) {
        headCalls++
        return { ContentLength: 4 }
      }
      return {
        Body: { transformToWebStream: () => webStreamOfBytes([1, 2, 3, 4]) },
        ContentLength: 4,
        ContentType: "video/webm",
        ContentRange: "bytes 0-3/50",
      }
    })
    const adapter = new S3Adapter(client)

    const result = await adapter.getStream("videos/clip.webm", { start: 0, end: 3 })

    expect(result.totalBytes).toBe(50)
    expect(result.start).toBe(0)
    expect(result.end).toBe(3)
    expect(headCalls).toBe(0)
  })
})
