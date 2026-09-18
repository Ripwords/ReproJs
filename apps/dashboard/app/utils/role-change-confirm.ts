import type { InstallRole, ProjectRole } from "@reprojs/shared"
import type { ConfirmOptions } from "~/composables/use-confirm"

/** What each project role can do, in one sentence, for confirm dialogs. */
const PROJECT_ROLE_SUMMARY: Record<ProjectRole, string> = {
  owner:
    "Owners can manage members, project settings, keys and integrations, and can delete the project.",
  developer:
    "Developers can triage reports, retry GitHub sync and create GitHub labels, but can't manage members or settings.",
  manager:
    "Managers can triage reports (status, priority, assignee, labels, GitHub links) but can't change settings or integrations.",
  viewer: "Viewers can read reports but can't change anything.",
}

/**
 * Copy for confirming an install role change on /settings/users. Install
 * admins act as owner of every project, so promotion and self-demotion get
 * copy that spells out the consequence.
 */
export function installRoleChangeConfirm(input: {
  email: string
  to: InstallRole
  isSelf: boolean
}): ConfirmOptions {
  if (input.to === "admin") {
    return {
      title: `Make ${input.email} an admin?`,
      description:
        "Admins are treated as the owner of every project on this install: they can read every report, change any project's settings and members, and manage users and integrations.",
      confirmLabel: "Make admin",
      confirmColor: "warning",
      icon: "i-heroicons-shield-check",
    }
  }
  if (input.isSelf) {
    return {
      title: "Remove your own admin access?",
      description:
        "You'll immediately lose access to the admin pages and to every project you aren't a member of. Only another admin can give it back.",
      confirmLabel: "Remove my admin access",
      confirmColor: "error",
      icon: "i-heroicons-exclamation-triangle",
    }
  }
  return {
    title: `Remove admin access from ${input.email}?`,
    description:
      "They'll keep access only to projects they're a member of, with their role on each project.",
    confirmLabel: "Change to member",
    confirmColor: "warning",
  }
}

/** Copy for confirming a project role change on the project Members page. */
export function projectRoleChangeConfirm(input: {
  email: string
  to: ProjectRole
  isSelf: boolean
  selfIsAdmin: boolean
}): ConfirmOptions {
  const summary = PROJECT_ROLE_SUMMARY[input.to]
  if (input.isSelf) {
    // Only owners (and install admins) can change roles, so changing your
    // own row is always a step down from owner.
    if (input.selfIsAdmin) {
      return {
        title: `Change your own role to ${input.to}?`,
        description: `${summary} As an install admin you keep owner access to this project regardless.`,
        confirmLabel: "Change role",
        confirmColor: "primary",
      }
    }
    return {
      title: `Change your own role to ${input.to}?`,
      description: `You'll no longer be able to manage members, settings or integrations for this project. Only another owner can give it back.`,
      confirmLabel: "Change my role",
      confirmColor: "error",
      icon: "i-heroicons-exclamation-triangle",
    }
  }
  if (input.to === "owner") {
    return {
      title: `Make ${input.email} an owner?`,
      description: summary,
      confirmLabel: "Make owner",
      confirmColor: "warning",
      icon: "i-heroicons-shield-check",
    }
  }
  return {
    title: `Change ${input.email} to ${input.to}?`,
    description: summary,
    confirmLabel: "Change role",
    confirmColor: "primary",
  }
}
