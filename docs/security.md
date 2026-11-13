# Security: who can reach the hub

What is true now, edited in place. The repo runs no hosted service; its trust boundary is the hub,
started by hand on the machine at the table, and the browsers and programs that reach it.

| Server | Listens on | Authentication | What a caller can do |
| --- | --- | --- | --- |
| The hub (`hub/server.js`) | Every network interface (`Bun.serve` with no `hostname`), port 3001, or `PORT` | None. It checks `Host` and `Origin` (below), which keeps other sites' pages in a browser out, not other programs | Read and change the session state, presets and macros; drive Kenku FM; send any command to a connected peer, including `eval` in the GM's Foundry browser through the bridge. Every peer reply is broadcast to every socket, so any connection reads what the GM's browser reads, GM-only content included |

Two ways in matter:

- **From a browser, through a page on another site: closed.** The hub checks every request before anything else:
  - **Host:** it must name the hub, as `localhost`, `127.0.0.1` or `[::1]` on the hub's port, or a name in
    `ALLOWED_HOSTS` on any port; anything else gets 421 and is logged. A page that points a name of its own at the
    machine (DNS rebinding) sends its own name, so it can't read or change anything.
  - **Origin:** every request other than GET and HEAD, and every request to `/ws` (the WebSocket upgrade), gets 403
    and is logged with its origin when it carries an `Origin` other than the hub's own (`http://<host>:<port>`
    for each host name it accepts) or one in `ALLOWED_ORIGINS`, by default Foundry's (`http://localhost:30000`,
    `http://127.0.0.1:30000`), where the bridge connects from. `Origin: null` (a sandboxed or `file://` page) is
    refused. A request with no `Origin` passes: browsers send one with every request other than GET and HEAD and with
    every WebSocket, so there only curl, scripts and peers that aren't browser pages send none.

  A page on another site can still send a GET, but the hub sends no CORS headers, so the page can't read the answer;
  no GET route changes anything.
- **From the network: open.** The hub still listens on every network interface with no authentication. A program
  (not a browser page) that can reach the port sets its own `Host` and sends no `Origin`, so it passes both checks
  and can do everything in the table above, `eval` in Foundry included. Any socket can also identify as `foundry`
  and take the bridge's place, and every peer reply still goes to every socket. This is open debt; the rule for
  running the hub until it is fixed is in AGENTS.md (hub).

What the checks trust: the hub's own pages, and every page served from an origin in `ALLOWED_ORIGINS`. With the
default, that is anything Foundry serves on port 30000, so any module in the GM's world can drive the hub, as it can
already drive Foundry.

The two settings are environment variables, like `PORT`: comma-separated lists, each replacing its default (Foundry's
two origins; no extra hosts). `ALLOWED_HOSTS` takes names only (a port given is dropped, with a warning), and an entry
that isn't an origin or a host name is ignored and named in a warning as the hub starts. A Foundry on another port,
or opened by another name, needs its origin in `ALLOWED_ORIGINS`, Foundry's two defaults left out unless they are
listed again. For a phone or tablet over Tailscale through `tailscale serve`, which passes the tailnet's name on as
the `Host`, add the machine's tailnet name to both lists: `ALLOWED_HOSTS=<machine>.<tailnet>.ts.net` and
`ALLOWED_ORIGINS=http://localhost:30000,http://127.0.0.1:30000,https://<machine>.<tailnet>.ts.net`. Use
`tailscale serve` only, never `tailscale funnel`: Funnel would put the hub, which has no authentication, on the
public internet, where any program passes both checks.
