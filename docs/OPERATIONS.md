# Updates and removal

## Update

[คู่มืออัปเดตภาษาไทย](UPDATING-TH.md)

1. Click **Stop** in `N3zuui Studio.exe` for a N3zuui-managed tunnel, or stop your manually configured external tunnel using its own controls. Disconnect N3zuui in your MCP client.
2. Open Setup in the new release. It verifies and retires the old runtime only after work is finished; a busy or unverifiable runtime blocks the update. See [updating](UPDATING-TH.md).
3. Keep a backup of the N3zuui user data directory if you need session/workspace state.
4. Extract the new release into a new folder and run Setup there. Setup copies compatible components from the previous N3zuui installation into the new `external` directory, reuses a matching dependency graph, and updates worker/launcher paths. Saved workspace, custom policy, Tunnel ID and remembered key remain in the same user data directory; do not recreate the connector. When that folder already has compatible dependencies and configuration, the Dashboard opens directly. Configure regenerates the manual client entry and preserves the existing base policy.
5. For a N3zuui-managed tunnel, click Start MCP. For a manually configured client, replace its old N3zuui entry with the new generated entry. Check the policy permits your intended workspace and reconnect.

The program directory contains no durable user state. Unfinished process/search handles are not restored after a broker or worker restart. Finish or checkpoint external work before stopping it. Changes to worker cap, worker entry and policy take effect for a fresh broker/worker; existing workers may retain their current settings.

## Remove

Disconnect the client, stop the external connector and this N3zuui broker, then remove the N3zuui client entry and extracted program folder. Keep `%LOCALAPPDATA%\DWB-MCP-Studio` if you want to retain local data; remove that directory separately only if you intend to erase it. Separately installed Desktop Commander, Node and tunnel software are managed by their own installers.

## Troubleshooting

Open `node scripts/doctor.mjs` for a persistent diagnostic window, or run `npm run doctor`. The report checks configuration and probes the configured local broker without creating a session or worker. `running` includes its PID, capacity and queue counts; `stopped` is normal before a client connects; `unresponsive`/`unreachable` means the runtime probe failed even if static configuration is valid. This is not an end-to-end worker or tunnel test.

- **Missing worker/tunnel:** open Setup and click Install to prepare this installation's `external` directory. Programs installed elsewhere are not used by the GUI. See [external dependencies](EXTERNAL.md).
- **Unsupported version/layout:** this beta checks 0.2.50. Do not force a different version or edit the external install to bypass the check.
- **No worker per chat:** inspect session/context status. A multiplexing connector must forward stable context metadata.
- **Queue is waiting:** check `dwb_broker_status` and the session's `queuePosition` (one-based) and `queueWaitMs`. `stoppingWorkers` still occupy capacity until their processes close. Busy workers with active processes/searches are retained. End that work or raise the cap and restart the broker.
- **Restart/resume says busy:** let the current requests finish before retrying. These actions no longer interrupt an in-flight request.
- **Workspace boundary:** explicitly bind the intended root. Binding does not expand the upstream base policy.
- **User supplied a working directory:** the MCP instructions tell the assistant to call `workspace` with `action=bind` and the absolute `path` immediately. This registers/reuses the exact directory and binds it in one operation. The broker receives tool calls, not chat text, so the assistant/client must follow those instructions.
- **Directory changes:** binding/unbinding replaces only the current idle worker when its directory changes. The next request starts a worker in `workingDirectory`. `workspaceKey` is the session's initial directory; `transportWorkspaceKey` identifies the current adapter's directory for reconnect, including after a resume from a different directory. Running requests/processes/searches must finish before a switch. Binding the same directory keeps the worker.
- **Resume from a new chat:** the selected session is reassigned to the requesting chat ID. Later requests and reconnects continue using it; other logical chats keep their own sessions. Resume is refused while the current worker has active processes/searches, so those are not discarded.
- **Stale-write conflict:** read the current file, reconcile changes and retry.
- **No window after Start.cmd:** it is an MCP stdio server, not a GUI.
- **Start/Stop window:** open `N3zuui Studio.exe`. Closing it keeps the tunnel running. Stop disconnects the tunnel and its adapter tree, while the shared broker and its background work may remain running.
- **Tunnel not ready:** check the Tunnel ID, API key permissions, internet connection and installed tunnel-client version. Stop before changing settings. A healthy local process does not prove the hosted chat has discovered its tools.
- **Forget a saved API key:** uncheck Remember and Start with the saved or newly entered key. The encrypted key file is removed; the next Start requires a key. Alternatively, while stopped remove only `tunnel/key.dpapi` from the N3zuui data directory.
- **Doctor succeeds, remote client fails:** check the separately installed connector, its credentials and custom stdio configuration.
