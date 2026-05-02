import { type Plugin, tool } from "@opencode-ai/plugin";

export const SessionPlugin: Plugin = async ({ client, $ }) => {
  async function validateSession(id: string) {
    const valRes = await client.session.get({ path: { id } });

    if ((valRes.error as any)?.data?.message) {
      throw new Error((valRes.error as any).data.message);
    }

    if (valRes.error) {
      throw new Error("Session validation failed: Not Found");
    }
  }

  return {
    tool: {
      session_me: tool({
        description: "Get the current session ID",
        args: {},
        async execute(_, context) {
          return context.sessionID;
        },
      }),
      session_walk: tool({
        description:
          "Find the root ancestor session ID for a given session. If not provided, defaults to the current session ID",
        args: {
          sessionID: tool.schema
            .string()
            .optional()
            .describe("The starting session ID"),
        },
        async execute(args, context) {
          let currentId = args.sessionID || context.sessionID;
          await validateSession(currentId);

          while (true) {
            const res = await client.session.get({ path: { id: currentId } });

            if (!res.data?.parentID) {
              return currentId;
            }

            currentId = res.data.parentID;
          }
        },
      }),
      session_rename: tool({
        description:
          "Rename a given session. If session ID is not provided, defaults to the current session",
        args: {
          sessionID: tool.schema.string().optional().describe("The session ID"),
          title: tool.schema.string().describe("The new title"),
        },
        async execute(args, context) {
          const id = args.sessionID || context.sessionID;
          await validateSession(id);

          await client.session.update({
            path: { id },
            body: { title: args.title },
          });

          return `Renamed session ${id} to "${args.title}"`;
        },
      }),
      session_move: tool({
        description:
          "Move a session to a new directory. If session ID is not provided, defaults to the current session",
        args: {
          sessionID: tool.schema.string().optional().describe("The session ID"),
          directory: tool.schema
            .string()
            .describe("The absolute path to move the session to"),
        },
        async execute(args, context) {
          const id = args.sessionID || context.sessionID;
          await validateSession(id);

          const projectsRes = await client.project.list();
          const projects = projectsRes.data || [];

          const targetProject = projects
            .filter(
              (p: any) =>
                args.directory === p.worktree ||
                args.directory.startsWith(
                  p.worktree.endsWith("/") ? p.worktree : p.worktree + "/",
                ),
            )
            .sort((a: any, b: any) => b.worktree.length - a.worktree.length)[0];

          const projectId = targetProject ? targetProject.id : "global";

          const dbPath = `${process.env.HOME}/.local/share/opencode/opencode.db`;
          await $`sqlite3 ${dbPath} "UPDATE session SET project_id = '${projectId}', directory = '${args.directory}' WHERE id = '${id}';" `.text();

          return `Moved session ${id} to ${args.directory} (Project: ${projectId})`;
        },
      }),
    },
  };
};
