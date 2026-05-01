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
          "Find the root ancestor session ID for a given session. If not provided, it defaults to the current session ID",
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
    },
  };
};
