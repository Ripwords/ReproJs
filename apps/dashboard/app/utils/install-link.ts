export interface InstallLink {
  to: string
  label: string
}

/**
 * Where "install the SDK" calls to action should send the viewer.
 * `/settings/install` is admin-only (its middleware bounces everyone else to
 * `/`), so non-admins go to the project's Security tab instead. Both pages
 * now render the same snippet with this project's real key; the admin page
 * is preselected on it via `?project=`.
 */
export function installLinkFor(isAdmin: boolean, projectId: string): InstallLink {
  const id = encodeURIComponent(projectId)
  if (isAdmin) return { to: `/settings/install?project=${id}`, label: "View install instructions" }
  return { to: `/projects/${id}/settings?tab=security`, label: "View embed snippet" }
}
