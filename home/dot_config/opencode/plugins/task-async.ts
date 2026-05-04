import { type Plugin, tool } from "@opencode-ai/plugin";
import { Effect } from "effect";

const activeTasks = new Map<string, string>(); // childSessionID → parentSessionID

export const TaskAsyncPlugin: Plugin = async ({ client }) => {
  return {
    tool: {
      task_async: tool({
        description:
          "Launch a new agent to handle complex, multistep tasks asynchronously",
        args: {
          description: tool.schema
            .string()
            .describe("A short (3-5 words) description of the task"),
          prompt: tool.schema
            .string()
            .describe("The task for the agent to perform"),
          subagent_type: tool.schema
            .string()
            .describe("The type of specialized agent to use for this task"),
          task_id: tool.schema
            .string()
            .optional()
            .describe(
              "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
            ),
        },
        async execute(args, context) {
          await Effect.runPromise(
            context.ask({
              permission: "task",
              patterns: [args.subagent_type],
              always: ["*"],
              metadata: {
                description: args.description,
                subagent_type: args.subagent_type,
              },
            }),
          );

          // Validate agent exists and resolve tool restrictions
          const agents = await client.app.agents();
          const agentDef = (agents.data ?? []).find(
            (a) => a.name === args.subagent_type,
          );
          if (!agentDef) {
            return `Error: Unknown agent type "${args.subagent_type}".`;
          }

          const toolRestrictions: Record<string, boolean> = {};

          if (!agentDef.tools?.["task"]) {
            toolRestrictions["task"] = false;
          }

          if (!agentDef.tools?.["task_async"]) {
            toolRestrictions["task_async"] = false;
          }

          // Resume existing session or create new one
          let sessionID: string;
          if (args.task_id) {
            sessionID = args.task_id;
          } else {
            const session = await client.session.create({
              body: {
                title: `${args.description} (@${args.subagent_type} subagent)`,
                parentID: context.sessionID,
              },
            });
            sessionID = session.data!.id;
          }

          activeTasks.set(sessionID, context.sessionID);

          // Fire-and-forget prompt
          client.session
            .promptAsync({
              path: { id: sessionID },
              body: {
                parts: [{ type: "text", text: args.prompt }],
                agent: args.subagent_type,
                ...(Object.keys(toolRestrictions).length > 0 && {
                  tools: toolRestrictions,
                }),
              },
            })
            .catch((err) => {
              client.app.log({
                body: {
                  service: "task-async",
                  level: "error",
                  message: `Failed to prompt async task ${sessionID}`,
                  extra: { error: String(err) },
                },
              });
            });

          return [
            `task_id: ${sessionID} (for resuming to continue this task if needed)`,
            "",
            "<task_result>",
            "Task started asynchronously in the background. You are unblocked.",
            "Use `task_read` with this task_id to check results once notified.",
            "</task_result>",
          ].join("\n");
        },
      }),
      task_cancel: tool({
        description:
          "Cancel running async tasks. Leave task_id empty to cancel all active subtasks in this session",
        args: {
          task_id: tool.schema
            .string()
            .optional()
            .describe("Task ID to cancel. Omit to cancel all active subtasks"),
        },
        async execute(args, context) {
          const targets: string[] = [];

          if (args.task_id) {
            if (activeTasks.has(args.task_id)) {
              targets.push(args.task_id);
            } else {
              throw new Error(
                `No active async task found with id "${args.task_id}"`,
              );
            }
          } else {
            for (const [childID, parentID] of activeTasks) {
              if (parentID === context.sessionID) {
                targets.push(childID);
              }
            }
            if (targets.length === 0) {
              throw new Error("No active async tasks to cancel.");
            }
          }

          const results = await Promise.allSettled(
            targets.map(async (id) => {
              await client.session.abort({ path: { id } });
              activeTasks.delete(id);
              return id;
            }),
          );

          return results
            .map((r) =>
              r.status === "fulfilled"
                ? `Cancelled: ${r.value}`
                : `Failed: ${String(r.reason)}`,
            )
            .join("\n");
        },
      }),
      task_read: tool({
        description: "Read the latest message from an async task's session",
        args: {
          task_id: tool.schema
            .string()
            .describe("The task_id (session ID) to read results from"),
        },
        async execute(args) {
          const messages = await client.session.messages({
            path: { id: args.task_id },
          });
          const lastAssistantMsg = (messages.data ?? []).findLast(
            (m) => m.info.role === "assistant",
          );

          if (!lastAssistantMsg) {
            throw new Error("No assistant response found for this task.");
          }

          const resultText = lastAssistantMsg.parts
            ?.filter(
              (p): p is Extract<typeof p, { type: "text" }> =>
                p.type === "text",
            )
            .map((p) => p.text)
            .join("\n");

          return resultText || "No text content found.";
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;

      const sessionID = event.properties.sessionID;
      const parentID = activeTasks.get(sessionID);
      if (!parentID) return;

      activeTasks.delete(sessionID);

      try {
        await client.session.promptAsync({
          path: { id: parentID },
          body: {
            parts: [
              {
                type: "text",
                text: `<task_exited task_id="${sessionID}">\nAsync task completed. Use \`task_read\` with this task_id to retrieve the result.\n</task_exited>`,
              },
            ],
          },
        });
      } catch (err) {
        client.app.log({
          body: {
            service: "task-async",
            level: "error",
            message: `Failed to notify parent for task ${sessionID}`,
            extra: { error: String(err) },
          },
        });
      }
    },
  };
};
