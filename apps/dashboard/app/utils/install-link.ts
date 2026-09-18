export interface InstallLink {
  to: string
  label: string
}

/**
 * Where "install the SDK" calls to action should send the viewer.
 * `/settings/install` is admin-only (its middleware bounces everyone else to
 * `/`), so non-admins go to the project's Security tab instead: it shows the
 * embed snippet with this project's real key and every project member can open it.
 */
export function installLinkFor(isAdmin: boolean, projectId: string): InstallLink {
  if (isAdmin) return { to: "/settings/install", label: "View install instructions" }
  return { to: `/projects/${projectId}/settings?tab=security`, label: "View embed snippet" }
}
