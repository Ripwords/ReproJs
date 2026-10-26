import { Readable } from "node:stream"
import NodeClam from "clamscan"
import { env } from "./env"

interface ScanClient {
  scanStream: (stream: Readable) => Promise<{ isInfected: boolean | null; viruses: string[] }>
}

export interface ScanResult {
  clean: boolean
  reason?: string
  /** Wall-clock scan duration in milliseconds. 0 when scanning was disabled. */
  durationMs: number
  /** Human-readable engine identifier persisted with the row. */
  engine: string
}

const ENGINE = "ClamAV"

let _client: ScanClient | null = null
let _initInProgress: Promise<ScanClient> | null = null

async function buildClient(): Promise<ScanClient> {
  const clam = await new NodeClam().init({
    clamdscan: {
      host: env.CLAMAV_HOST,
      port: env.CLAMAV_PORT,
      timeout: env.CLAMAV_TIMEOUT_MS,
      // Sidecar-only — no fallback to a local CLI binary on the dashboard host.
      localFallback: false,
      bypassTest: false,
    },
    preference: "clamdscan",
    removeInfected: false,
    debugMode: false,
  })
  return clam as unknown as ScanClient
}

async function getClient(): Promise<ScanClient> {
  if (_client) return _client
  if (_initInProgress) return _initInProgress
  _initInProgress = buildClient()
    .then((c) => {
      _client = c
      return c
    })
    .finally(() => {
      _initInProgress = null
    })
  return _initInProgress
}

/**
 * Scan a buffer of bytes against the configured ClamAV sidecar. Returns
 * { clean: true } when scanning is disabled OR the file passed; throws when
 * the scanner is enabled but unreachable (fail-closed). Returns
 * { clean: false, reason } only on a confirmed signature hit.
 */
export async function scanBytes(bytes: Uint8Array): Promise<ScanResult> {
  if (!env.INTAKE_USER_FILE_SCAN_ENABLED) return { clean: true, durationMs: 0, engine: ENGINE }
  let client: ScanClient
  try {
    client = await getClient()
  } catch (err) {
    throw new Error(
      `[clamav] init failed against ${env.CLAMAV_HOST}:${env.CLAMAV_PORT}: ${(err as Error).message}`,
      { cause: err },
    )
  }
  const stream = Readable.from(Buffer.from(bytes))
  const start = Date.now()
  console.info(`[clamav] scan start size=${bytes.byteLength}`)
  try {
    const { isInfected, viruses } = await client.scanStream(stream)
    const duration = Date.now() - start
    // clamscan reports `null` when it could not get a verdict (stream cut,
    // clamd timeout, size limit) — that is a failed scan, not a clean file.
    // Falling through would let unscanned bytes in as "clean".
    if (isInfected === null) {
      throw new Error("scanner returned no verdict (isInfected=null)")
    }
    if (isInfected) {
      const reason = viruses?.[0] ?? "infected"
      console.warn(`[clamav] scan verdict=infected:${reason} duration=${duration}ms`)
      return { clean: false, reason, durationMs: duration, engine: ENGINE }
    }
    console.info(`[clamav] scan verdict=clean duration=${duration}ms`)
    return { clean: true, durationMs: duration, engine: ENGINE }
  } catch (err) {
    const duration = Date.now() - start
    console.error(`[clamav] scan error duration=${duration}ms`, err)
    // Reset the cached client so the next call re-inits — handles transient
    // socket drops cleanly when clamd restarts.
    _client = null
    throw new Error(`[clamav] scan failed: ${(err as Error).message}`, { cause: err })
  }
}

/**
 * Test seam: lets unit tests inject a fake client without going through the
 * NodeClam init path (which would require a real clamd socket).
 */
export function _setClientForTesting(client: ScanClient | null): void {
  _client = client
  _initInProgress = null
}
