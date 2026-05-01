import { type Plugin, tool } from "@opencode-ai/plugin";

export const SessionPlugin: Plugin = async () => {
  return {
    tool: {
      session_me: tool({
        description: "Get the current session ID",
        args: {},
        async execute(args, context) {
          return context.sessionID;
        },
      }),
    },
  };
};
