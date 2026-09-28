# Remote bridge: expose N3zuui Studio Core over Streamable HTTP

`scripts/stdio-http-bridge.mjs` wraps the studio's stdio MCP server and exposes
it as a Streamable HTTP endpoint (`POST /mcp`, plain JSON responses) so a
remote MCP client can connect over the network. N3zuui itself provides no hosted
endpoint (see `docs/CONFIGURATION.md`); this bridge plus a tunnel of your
choice fills that gap.

## Setup (automatic)

`npm install` runs the self-setup (`scripts/setup.mjs`, also available as
`npm run setup`) which, without asking anything:

1. Builds the project when `dist/` is missing.
2. Downloads the `cloudflared` binary for your platform into `bin/`
   (gitignored) when missing.
3. Creates `bridge.config.json` (gitignored) with a random bearer token when
   missing. Re-running setup never overwrites it; change values with flags:
   `npm run setup -- --port 4000 --token mysecret --no-token`.

The bridge and the tunnel read `bridge.config.json`; command-line flags on the
bridge still override the file.

## Run

```powershell
npm run bridge   # stdio -> http://127.0.0.1:3000/mcp (port/token from bridge.config.json)
npm run tunnel   # cloudflared -> public https URL; keep it running
```

Use the tunnel's public URL with your MCP client, e.g.
`https://<tunnel-host>/mcp`, plus the bearer token printed by setup
(also stored in `bridge.config.json`).

## Test the full path (from another machine)

```bash
python mcp_probe.py --url https://<tunnel-host>/mcp --timeout 60 --bearer <token>
python mcp_probe.py --url https://<tunnel-host>/mcp --timeout 60 --bearer <token> --call dwb_broker_status '{}'
```

Expect: `OK connected: n3zuui-mcp-studio-core`, then the tool list.

`GET /health` on the bridge answers `{"ok":true}` (or 503 if the studio
process died) — useful as a tunnel health check.

## Security notes

- The bridge spawns the real studio: anyone who can reach `/mcp` can call its
  tools (filesystem, shell, workspaces). Setup generates a random token by
  default — treat the tunnel URL + token like a password.
- The bridge answers server-initiated child requests with "Method not found";
  host features that need sampling or elicitation round-trips (e.g. some
  agent handoff flows) may not work through it — stdio remains the full path.
- One bridge process = one studio instance. Session state lives in the child;
  restarting the bridge restarts that state.
