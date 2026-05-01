import { type Plugin, tool } from "@opencode-ai/plugin";

export const SessionPlugin: Plugin = async ({ client }) => {
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

          await client.session.update({
            path: { id },
            body: { title: args.title },
          });

          return `Renamed session ${id} to "${args.title}"`;
        },
      }),
    },
  };
};
