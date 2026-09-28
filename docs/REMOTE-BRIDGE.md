# Remote bridge: expose N3zuui Studio Core over Streamable HTTP

`scripts/stdio-http-bridge.mjs` wraps the studio's stdio MCP server and exposes
it as a Streamable HTTP endpoint (`POST /mcp`, plain JSON responses) so a
remote MCP client can connect over the network. N3zuui itself provides no hosted
endpoint (see `docs/CONFIGURATION.md`); this bridge plus a tunnel of your
choice fills that gap.

## Requirements

- Node.js >= 22.16 (same as the studio)
- The repo built once: `npm run build`
- Run from the repository root on the Windows machine that hosts the studio.

## Start

```powershell
npm run build
node scripts/stdio-http-bridge.mjs --port 3000 --path /mcp
```

Options:

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `3000` | Local port to listen on (bound to 127.0.0.1 only) |
| `--path` | `/mcp` | MCP endpoint path |
| `--token SECRET` | none | Require `Authorization: Bearer SECRET` on `/mcp` |
| `--timeout-ms` | `120000` | How long to wait for the studio per request |
| `-- cmd args...` | `node scripts/start.mjs` | Alternative stdio MCP server to expose |

`GET /health` answers `{"ok":true}` (or 503 if the studio process died) —
useful as a tunnel health check.

## Expose it to the internet

The bridge binds to loopback only. Put a tunnel in front of it, for example:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

Use the tunnel's public URL with your MCP client, e.g.
`https://<tunnel-host>/mcp`. If the tunnel URL is public, set `--token` and
give the client the matching bearer token.

## Test the full path (from another machine)

```bash
python mcp_probe.py --url https://<tunnel-host>/mcp --timeout 60
python mcp_probe.py --url https://<tunnel-host>/mcp --timeout 60 --call dwb_broker_status '{}'
```

Expect: `OK connected: n3zuui-mcp-studio-core`, then the tool list.

## Security notes

- The bridge spawns the real studio: anyone who can reach `/mcp` can call its
  tools (filesystem, shell, workspaces). Treat the tunnel URL + token like a
  password, and prefer `--token` on any public tunnel.
- The bridge answers server-initiated child requests with "Method not found";
  host features that need sampling or elicitation round-trips (e.g. some
  agent handoff flows) may not work through it — stdio remains the full path.
- One bridge process = one studio instance. Session state lives in the child;
  restarting the bridge restarts that state.
