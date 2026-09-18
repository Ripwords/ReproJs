import type { AuthProvidersDTO } from "@reprojs/shared"

/**
 * Which OAuth providers are configured on this deployment.
 *
 * Exposed to the client at request time (not build time) so the sign-in page
 * can show/hide buttons based on the currently-running server's env — rather
 * than whatever was set when the Docker image was built. See `auth.ts` for
 * where these env vars actually enable the social providers.
 */
export type AuthProviderStatus = AuthProvidersDTO

type ProviderEnv = {
  GITHUB_CLIENT_ID: string
  GOOGLE_CLIENT_ID: string
}

export function getAuthProviderStatus(env: ProviderEnv): AuthProviderStatus {
  return {
    github: env.GITHUB_CLIENT_ID.trim() !== "",
    google: env.GOOGLE_CLIENT_ID.trim() !== "",
  }
}
