import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../../db"
import { projects, projectMembers, user } from "../../db/schema"
import type { McpRequestContext } from "../context"

export const listProjectsTool = {
  name: "repro_list_projects",
  config: {
    description:
      "List Repro projects the current user is a member of. Returns id, name, and the user's role on each project.",
    inputSchema: z.object({}),
  },
  handler: async (_input: Record<string, never>, ctx: McpRequestContext) => {
    // Install admins see every project as `owner`. Members see only their
    // own memberships. Mirrors requireProjectRole's semantics.
    const [actor] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, ctx.userId))
      .limit(1)

    if (actor?.role === "admin") {
      const all = await db.select({ id: projects.id, name: projects.name }).from(projects)
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              all.map((p) => ({ ...p, role: "owner" as const })),
              null,
              2,
            ),
          },
        ],
      }
    }

    const memberships = await db
      .select({
        id: projects.id,
        name: projects.name,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projectMembers.userId, ctx.userId))

    return {
      content: [{ type: "text" as const, text: JSON.stringify(memberships, null, 2) }],
    }
  },
}
