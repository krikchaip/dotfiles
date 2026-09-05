import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";
const POLL_MS = 100;
const root = resolve(import.meta.dir, "../..");
const extension = join(root, "index.ts");
const provider = join(import.meta.dir, "provider.ts");
const runDirectory = `/tmp/provider-payload-debug-e2e-${process.pid}`;
const socket = join(runDirectory, "tmux.sock");
const paneLog = join(runDirectory, "pi.ansi");
const pipeDone = join(runDirectory, "pi.ansi.done");
const statusFile = join(runDirectory, "pi.status");
const gateFile = join(runDirectory, "start.gate");
const launchFile = join(runDirectory, "launch.sh");
const home = join(runDirectory, "home");
const agentDir = join(home, ".pi", "agent");
const workDir = join(runDirectory, "cwd");
const debugDir = join(agentDir, "debug", "provider-payloads");
let providerServer: ReturnType<typeof Bun.serve> | undefined;
let responseSequence = 0;

function providerResponse(): Response {
	responseSequence += 1;
	const text = `Provider payload debug response ${responseSequence}.`;
	const chunk = (delta: Record<string, string>, finishReason: string | null) =>
		JSON.stringify({
			id: `response-${responseSequence}`,
			object: "chat.completion.chunk",
			created: 1_767_225_600,
			model: "fake",
			choices: [{ index: 0, delta, finish_reason: finishReason }],
		});
	const events = [
		chunk({ role: "assistant", content: text }, null),
		chunk({}, "stop"),
		"[DONE]",
	];
	return new Response(
		`${events.map((event) => `data: ${event}\n\n`).join("")}`,
		{
			headers: {
				"content-type": "text/event-stream",
				"x-e2e-response": String(responseSequence),
			},
			status: 200,
		},
	);
}

function quote(value: string): string {
	return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function execute(
	command: string[],
	allowFailure = false,
): Promise<string> {
	const child = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
	const [status, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (status !== 0 && !allowFailure) {
		throw new Error(
			`Command failed (${status}): ${command.join(" ")}\n${stderr || stdout}`,
		);
	}
	return stdout;
}

function filesNamed(directory: string, name: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? filesNamed(path, name)
			: entry.name === name
				? [path]
				: [];
	});
}

async function tmux(...args: string[]): Promise<string> {
	return execute(["tmux", "-S", socket, ...args]);
}

async function capture(pane: string): Promise<string> {
	return execute(
		["tmux", "-S", socket, "capture-pane", "-p", "-J", "-S", "-", "-t", pane],
		true,
	);
}

async function waitUntil(
	description: string,
	predicate: () => boolean | Promise<boolean>,
	timeoutMs = 12_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await Bun.sleep(POLL_MS);
	}
	throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForPane(
	pane: string,
	text: string,
	timeoutMs = 12_000,
): Promise<string> {
	let view = "";
	await waitUntil(
		`terminal text ${JSON.stringify(text)}`,
		async () => {
			view = await capture(pane);
			return view.includes(text);
		},
		timeoutMs,
	);
	return view;
}

async function send(pane: string, text: string): Promise<void> {
	await tmux("send-keys", "-l", "-t", pane, text);
	await tmux("send-keys", "-t", pane, "Enter");
}

async function sendCommand(pane: string, text: string): Promise<void> {
	await tmux("send-keys", "-l", "-t", pane, text);
	await tmux("send-keys", "-t", pane, "Escape", "Enter");
}

async function captureCount(expected: number): Promise<void> {
	await waitUntil(
		`${expected} captured payload summaries`,
		() => filesNamed(debugDir, "summary.json").length === expected,
	);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
	providerServer = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (
				request.method !== "POST" ||
				url.pathname !== "/v1/chat/completions"
			) {
				return new Response("Not found", { status: 404 });
			}
			return providerResponse();
		},
	});
	const providerUrl = new URL("/v1", providerServer.url)
		.toString()
		.replace(/\/$/, "");

	mkdirSync(agentDir, { recursive: true });
	mkdirSync(workDir, { recursive: true });
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ quietStartup: false, theme: "dark" }),
	);

	const pi = Bun.which("pi");
	assert(pi, "Pi is not on PATH.");
	const piExecutable = realpathSync(pi);
	const version = (await execute([piExecutable, "--version"])).trim();
	assert(
		version === EXPECTED_VERSION,
		`Expected Pi ${EXPECTED_VERSION}, got ${version}.`,
	);

	const args = [
		"--verbose",
		"--use-theme",
		"dark",
		"--no-session",
		"--no-context-files",
		"--no-prompt-templates",
		"--no-themes",
		"--no-skills",
		"--no-extensions",
		"--provider-payload-debug",
		"-e",
		provider,
		"-e",
		extension,
		"--model",
		"provider-payload-debug-e2e/fake",
	];
	const assignments = {
		COLORTERM: "truecolor",
		COLUMNS: "92",
		HOME: home,
		LINES: "32",
		PI_CODING_AGENT_DIR: agentDir,
		PI_OFFLINE: "1",
		PI_TELEMETRY: "0",
		PROVIDER_PAYLOAD_DEBUG_E2E_URL: providerUrl,
		TERM: "xterm-256color",
	};
	const environment = Object.entries(assignments)
		.map(([key, value]) => `${key}=${quote(value)}`)
		.join(" ");

	writeFileSync(
		launchFile,
		[
			"#!/bin/sh",
			"set +e",
			`while [ ! -e ${quote(gateFile)} ]; do sleep 0.01; done`,
			`printf '__PI_EXECUTABLE__=%s\\n' ${quote(piExecutable)}`,
			`version=$(${quote(piExecutable)} --version)`,
			`printf '__PI_VERSION__=%s\\n' "$version"`,
			`env ${environment} ${quote(piExecutable)} ${args.map(quote).join(" ")}`,
			"status=$?",
			`printf '%s\\n' "$status" > ${quote(statusFile)}`,
			'exit "$status"',
			"",
		].join("\n"),
	);
	chmodSync(launchFile, 0o700);

	const pane = (
		await execute([
			"tmux",
			"-S",
			socket,
			"-f",
			"/dev/null",
			"new-session",
			"-d",
			"-P",
			"-F",
			"#{pane_id}",
			"-s",
			"provider-payload-debug-e2e",
			"-x",
			"92",
			"-y",
			"32",
			"-c",
			workDir,
			launchFile,
		])
	).trim();
	await tmux(
		"pipe-pane",
		"-O",
		"-t",
		pane,
		`cat > ${quote(paneLog)}; : > ${quote(pipeDone)}`,
	);
	writeFileSync(gateFile, "go\n");

	await waitForPane(pane, "[Extensions]");
	await waitForPane(pane, "provider-payload-debug: on");
	await sendCommand(pane, "/provider-payload-debug off");
	await waitForPane(pane, "provider-payload-debug: off");

	await tmux("send-keys", "-l", "-t", pane, "/provider-payload-debug o");
	await waitForPane(pane, "Capture every provider request");
	await waitForPane(pane, "Stop provider payload capture");
	await tmux("send-keys", "-t", pane, "Escape");
	await tmux("send-keys", "-t", pane, "-N", "40", "BSpace");

	await sendCommand(pane, "/provider-payload-debug");
	await waitForPane(pane, "provider-payload-debug: off");

	await sendCommand(pane, "/provider-payload-debug once");
	await waitForPane(pane, "Next provider request will be captured");
	await send(pane, "first deterministic request");
	await waitForPane(pane, "Provider payload debug response 1.");
	await captureCount(1);

	await sendCommand(pane, "/provider-payload-debug");
	await waitForPane(pane, "provider-payload-debug: off");
	await send(pane, "request while capture is off");
	await waitForPane(pane, "Provider payload debug response 2.");
	await Bun.sleep(300);
	assert(
		filesNamed(debugDir, "summary.json").length === 1,
		"Capture-off request created a payload snapshot.",
	);

	await tmux("send-keys", "-t", pane, "Escape", "C-d");
	await waitForPane(pane, "provider-payload-debug: on");
	await send(pane, "request after shortcut toggle");
	await waitForPane(pane, "Provider payload debug response 3.");
	await captureCount(2);

	await sendCommand(pane, "/provider-payload-debug off");
	await waitForPane(pane, "provider-payload-debug: off");
	await send(pane, "/provider-payload-debug command-owned request");
	await waitForPane(pane, "capturing this prompt only");
	await waitForPane(pane, "Provider payload debug response 4.");
	await captureCount(3);

	const summaries = filesNamed(debugDir, "summary.json").map((path) =>
		JSON.parse(readFileSync(path, "utf8")),
	);
	assert(
		summaries.every((summary) => summary.totalPayloadBytes > 0),
		"A payload summary has no payload bytes.",
	);
	assert(
		summaries.every(
			(summary) => summary.model?.provider === "provider-payload-debug-e2e",
		),
		"A payload summary recorded the wrong provider.",
	);
	const payloadFiles = filesNamed(debugDir, "payload.json").sort();
	assert(
		payloadFiles.length === 3,
		"Payload file count differs from summary count.",
	);
	const capturedPrompts = payloadFiles.map((path) => {
		const payload = JSON.parse(readFileSync(path, "utf8"));
		const userMessage = payload.messages
			?.filter((message: { role?: string }) => message.role === "user")
			.at(-1);
		return userMessage?.content
			?.filter((part: { type?: string }) => part.type === "text")
			.map((part: { text?: string }) => part.text)
			.join("");
	});
	assert(
		JSON.stringify(capturedPrompts) ===
			JSON.stringify([
				"first deterministic request",
				"request after shortcut toggle",
				"command-owned request",
			]),
		`Captured the wrong prompt sequence: ${JSON.stringify(capturedPrompts)}.`,
	);
	await waitUntil(
		"three response metadata files",
		() => filesNamed(debugDir, "response.json").length === 3,
	);
	const responses = filesNamed(debugDir, "response.json").map((path) =>
		JSON.parse(readFileSync(path, "utf8")),
	);
	assert(
		responses.every((response) => response.status === 200),
		"A response metadata file recorded a non-200 status.",
	);
	assert(
		responses.every(
			(response) => response.headers?.["content-type"] === "text/event-stream",
		),
		"A response metadata file omitted the fixture content type.",
	);

	await tmux("send-keys", "-t", pane, "C-d");
	await waitUntil("Pi process exit", () => existsSync(statusFile), 5_000);
	await waitUntil("terminal pipe flush", () => existsSync(pipeDone), 5_000);
	const status = Number.parseInt(readFileSync(statusFile, "utf8"), 10);
	assert(status === 0, `Pi exited with status ${status}.`);

	const log = readFileSync(paneLog, "utf8");
	assert(
		log.includes(`__PI_EXECUTABLE__=${piExecutable}`),
		"Raw PTY log does not identify the child Pi executable.",
	);
	assert(
		log.includes(`__PI_VERSION__=${EXPECTED_VERSION}`),
		"Raw PTY log does not identify the child Pi version.",
	);
	assert(
		!/(Failed to load|Extension error|uncaughtException)/i.test(log),
		"Raw PTY log contains an extension/runtime failure.",
	);

	console.log(
		"PASS provider-payload-debug real-TUI E2E: startup flag, argument completion, command status, once mode, capture-off guard, Ctrl+Alt+D toggle, prompt mode, payload summaries, and response metadata",
	);
	console.log(`PI_VERSION=${EXPECTED_VERSION}`);
	console.log(`PI_PATH=${piExecutable}`);
}

try {
	await main();
} finally {
	await execute(["tmux", "-S", socket, "kill-server"], true).catch(
		() => undefined,
	);
	providerServer?.stop(true);
	if (process.env.KEEP_E2E_ARTIFACTS !== "1")
		rmSync(runDirectory, { force: true, recursive: true });
	else console.log(`ARTIFACTS=${runDirectory}`);
}
