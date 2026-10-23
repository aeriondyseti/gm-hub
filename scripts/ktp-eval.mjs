#!/usr/bin/env node
// ktp-eval — run arbitrary JavaScript inside Foundry VTT via ktp-hub.
//
// Pipes code to the `foundry` peer's `eval` command (see
// ../../ktp-foundry-bridge/scripts/bridge.js). The code runs as a function
// body with `game, canvas, ui, ChatMessage, Roll` in scope; use `return` to
// send a value back. The bridge stringifies the return value, so you get
// `String(result)` on stdout — fine for ids/names/JSON, lossy for objects
// (JSON.stringify it yourself in the snippet if you need structure).
//
// Usage:
//   ktp-eval 'return game.world.id'              # inline body
//   ktp-eval -e 'game.users.size'                # expression (auto return)
//   ktp-eval -f snippet.js                       # from a file
//   echo 'return canvas.scene?.name' | ktp-eval  # from stdin
//
// Options:
//   -e, --expr            wrap input as `return (INPUT)` — for one expression
//   -f, --file <path>     read code from a file
//   -p, --peer <name>     target peer (default: foundry)
//   -h, --hub <url>       hub base URL (default: http://localhost:3001 or $KTP_HUB)
//   -t, --timeout <ms>    request timeout (default: 15000)
//   -j, --json            print the full peer-event reply as JSON
//       --help
//
// Exit codes: 0 ok · 1 usage/connection error · 2 peer not connected · 3 eval threw.

import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const opts = {
    expr: false,
    file: null,
    peer: "foundry",
    hub: process.env.KTP_HUB || "http://localhost:3001",
    timeout: 15000,
    json: false,
    help: false,
    code: null,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-e": case "--expr": opts.expr = true; break;
      case "-f": case "--file": opts.file = argv[++i]; break;
      case "-p": case "--peer": opts.peer = argv[++i]; break;
      case "-h": case "--hub": opts.hub = argv[++i]; break;
      case "-t": case "--timeout": opts.timeout = Number(argv[++i]); break;
      case "-j": case "--json": opts.json = true; break;
      case "--help": opts.help = true; break;
      default: rest.push(a);
    }
  }
  if (rest.length) opts.code = rest.join(" ");
  return opts;
}

const HELP = readFileSync(new URL(import.meta.url)).toString()
  .split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n");

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }

  let code = opts.code;
  if (opts.file) code = readFileSync(opts.file, "utf8");
  if (code == null) code = (await readStdin()).trim();
  if (!code) { console.error("ktp-eval: no code given (arg, -f, or stdin)\n"); console.error(HELP); return 1; }
  if (opts.expr) code = `return (${code});`;

  const url = `${opts.hub.replace(/\/$/, "")}/api/peers/${encodeURIComponent(opts.peer)}/command`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "eval", code }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") { console.error(`ktp-eval: timed out after ${opts.timeout}ms`); return 1; }
    console.error(`ktp-eval: cannot reach hub at ${opts.hub} — is it running? (bun run server.js)`);
    console.error(`  ${e.message}`);
    return 1;
  }
  clearTimeout(timer);

  const reply = await res.json().catch(() => ({}));
  if (opts.json) console.log(JSON.stringify(reply, null, 2));

  // peer not connected → hub answers 503 with {error}
  if (res.status === 503) {
    console.error(`ktp-eval: peer "${opts.peer}" not connected to the hub.`);
    console.error(`  Launch Foundry with the ktp-foundry-bridge module enabled and pointed`);
    console.error(`  at ${opts.hub.replace(/^http/, "ws")}/ws (module setting "ktp-hub WebSocket URL").`);
    return 2;
  }
  // the bridge caught a throw inside the snippet
  if (reply.event === "command-error") { console.error(`ktp-eval: eval threw — ${reply.error}`); return 3; }
  // routing/timeout error from the hub (e.g. 504 — peer went silent)
  if (reply.error) { console.error(`ktp-eval: ${reply.error}`); return 1; }

  if (!opts.json) {
    if ("result" in reply) console.log(reply.result);
    else console.log("(no return value)");
  }
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
