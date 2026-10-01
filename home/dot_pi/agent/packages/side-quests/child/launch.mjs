import { readFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Restore Pi's native CLI inputs in this process, without tmux or exec argv limits.
const path = process.argv[2];
const { command, environment } = JSON.parse(readFileSync(path, "utf8"));
unlinkSync(path);
Object.assign(process.env, environment);
process.argv = [...command];
await import(pathToFileURL(command[1]).href);
