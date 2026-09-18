import nodemailer, { type Transporter } from "nodemailer"
import { env } from "./env"

type MailProvider = "console" | "ethereal" | "smtp"

interface MailConfig {
  provider: MailProvider
  from: string
  smtp?: {
    host: string
    port: number
    user: string
    pass: string
  }
}

let transporter: Transporter | null = null
let resolvedFrom = ""
let resolvedProvider: MailProvider = "console"

async function getTransporter(): Promise<Transporter | null> {
  if (transporter) return transporter

  const cfg = loadConfig()
  resolvedFrom = cfg.from
  resolvedProvider = cfg.provider

  if (cfg.provider === "console") {
    // No transporter needed — we print to stdout in sendMail.
    return null
  }

  if (cfg.provider === "smtp") {
    if (!cfg.smtp) throw new Error("SMTP provider requires SMTP_* env vars")
    transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.port === 465,
      auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
    })
    return transporter
  }

  // ethereal
  try {
    const account = await nodemailer.createTestAccount()
    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    })
    console.info(`[email] Ethereal account created: ${account.user}`)
    return transporter
  } catch (err) {
    console.warn(`[email] Ethereal unavailable, falling back to console provider:`, err)
    resolvedProvider = "console"
    return null
  }
}

function loadConfig(): MailConfig {
  // Default: `console` for dev (prints verification URL to stdout — no external
  // network, no rate-limit friction). Set MAIL_PROVIDER=smtp for real email.
  const provider: MailProvider = env.MAIL_PROVIDER
  const from = env.SMTP_FROM
  if (provider === "smtp") {
    return {
      provider,
      from,
      smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    }
  }
  return { provider, from }
}

export interface SendMailOpts {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendMail(opts: SendMailOpts): Promise<void> {
  const t = await getTransporter()

  // `console` provider: extract and print the first URL in the email. Keeps
  // dev flow unblocked without SMTP; no leak to external services.
  if (resolvedProvider === "console") {
    const text = opts.text ?? stripHtml(opts.html)
    const firstUrl = firstLinkIn(opts.html)
    console.info(
      `[email:console] to=${opts.to} subject="${opts.subject}"${firstUrl ? `\n  link: ${firstUrl}` : `\n  body: ${text.slice(0, 400)}`}`,
    )
    return
  }

  if (!t) throw new Error("Mail transporter not available")

  const info = await t.sendMail({
    from: resolvedFrom,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? stripHtml(opts.html),
  })

  const preview = nodemailer.getTestMessageUrl(info)
  if (preview) {
    console.info(`[email] preview: ${preview}`)
  } else if ("message" in info && typeof info.message === "string") {
    console.info(`[email] jsonTransport captured:\n${info.message}`)
  }
}

/**
 * The first URL in an email body, unescaped the way a browser reads an href.
 * Templates write `&` as `&amp;`; printed raw, a pasted link keeps only its
 * first query parameter.
 */
export function firstLinkIn(html: string): string | null {
  const match = /https?:\/\/[^\s"'<>]+/.exec(html)?.[0]
  return match ? match.replaceAll("&amp;", "&") : null
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
