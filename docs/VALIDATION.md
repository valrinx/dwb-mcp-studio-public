# Beta validation

Validated locally on Windows with Node.js 24.11.1 and the minimum supported Node.js 22.16.0. The latter binary was downloaded from nodejs.org and checked against its official SHA-256 manifest. CI is configured for Node.js 22.16.0; a hosted CI run has not been performed from this workspace.

## Self-contained core checks

- TypeScript typecheck/build.
- Logical request-context selection.
- Payload guard budgets and redaction.
- Worker restart circuit and backoff.
- Twelve worker lifecycle regressions: concurrent allocation at cap, retaining unneeded warm workers, startup during shutdown/disconnect, capacity held during process stop, busy restart/resume, resumed transport family, active resource reads, work arriving during an idle probe, new-chat routing after resume, sibling chat routing, and preserving background work before resume. The initial cap/read/probe and new-chat resume reproductions failed before the fixes.
- Context selection excludes nested request/run/trace IDs and chat titles; a stable nested conversation ID remains unchanged when request IDs change.
- Doctor reports stopped/running brokers without attaching sessions or allocating workers.
- A duplicate broker startup cannot rewrite the live broker's session state; concurrent hello messages on one connection create only one session.
- Workspace tests cover exact child binding, registration reuse, invalid paths, duplicate folder names, per-chat worker replacement, active work/concurrent-call protection, unbinding and persistence through broker recovery.
- Missing external dependency produces an actionable error.
- Setup/Doctor and generated MCP configuration work after moving the program to a path containing spaces.
- Re-running Setup preserves a user-edited base policy.
- WPF Thai setup window rendered and visually inspected at the initial and successful states, including populated input text, original N3zuui logo, and enabled result actions.
- The Workspace guide link in Setup was visually checked in the rendered window; the offline HTML guide and local asset/link targets were checked from source. Browser rendering of the guide was not verified because the inspection browser blocks local file URLs.
- Setup requirements reject missing/older Node versions and missing workers.
- GUI save action tested end to end from an installation path containing spaces and an ampersand: production npm install, configure, Doctor, and enabled result buttons.
- Native process arguments round-trip spaces, quotes, ampersands and trailing backslashes without shell evaluation.
- GUI setup does not install Desktop Commander and leaves the external validation fixture unchanged.
- Public tool surface contains only the eight core control/workspace tools plus upstream tools.
- Two adapters obtain separate workers and config homes while preserving the real OS home.
- An unpatched test double is isolated in memory, and its source stays byte-for-byte unchanged.
- Workspace boundary and stale-write rejection preserve the expected file contents.

## Integration with a separately installed Desktop Commander 0.2.50

- Two chats bind different directories, receive distinct workers, write to their own workspace, and enforce the file boundary. A real PowerShell process reports the bound directory as its starting CWD.

- Worker crash: same adapter recovers with a new worker.
- Oversized images: approximately 4.19 MB reduced to a roughly 1.4 KB guard response; subsequent requests still work.
- Three adapters share one broker and receive distinct workers.
- Concurrent first requests allocate one worker for that session.
- Detached session resumes with its existing worker.
- Fourth worker allocation waits at capacity and proceeds when capacity is released.
- Broker crash restores the session identifier and stale-file observations.
- Logical contexts split and reclaim idle workers.
- Modern and legacy MCP clients both list 34 tools and two upstream resources.
- The external installation's config.js hash is unchanged after testing.

## beta.7 release acceptance

- Installed Desktop Commander 0.2.50 independently from npm in a new external directory. Confirmed its original `USER_HOME = os.homedir()` expression; its config.js hash stayed unchanged after all eight real-worker integration suites.
- Extracted a release candidate into a path containing spaces with no pre-existing dependencies, used a new data directory and workspace, and ran the actual GUI Setup on Node.js 22.16.0. Setup installed production dependencies and generated the client configuration.
- Ran the installed release over stdio: separate chat workspaces/workers, new-chat resume, concurrent reconnect after broker crash, and 34 exposed tools passed.
- Ran the installed release through the separately installed OpenAI tunnel-client's `dev proxy` with a Go in-memory control plane bound only to loopback. HTTP MCP calls carrying chat metadata selected separate workers; a third chat selected the first workspace by alias and received its own worker. No hosted account, existing tunnel profile, or public endpoint was used.
- A real-worker resume suite verifies root identity updates, logical child resume without redirecting siblings, adapters with different initial directories, retained workspace bindings and stale-write observations through broker restart.

The existing private worker was used for earlier betas; beta.7's acceptance above uses a fresh unpatched upstream install. Third-party binaries and dependencies remain outside the release.

## Remaining environment acceptance

### beta.10 dashboard

- Read-only broker snapshots expose worker/session/workspace/queue state without hello or adapter attachment. Regression checks verify unchanged session counts, worker counts and activity timestamps across repeated polling, and correct live worker PIDs.
- A stopped broker remains stopped when the dashboard probe runs. An older broker is reported as requiring an update; a disconnected broker returns stopped rather than stale session rows.
- WPF dashboard rendered with empty state and a snapshot from two live test workers. Background probe processes have bounded timeouts and do not run on the WPF UI thread. Closing the window terminates only its own pending probe.
- Log tests cover partial JSON lines, heartbeat filtering and redaction of common credential patterns. Full arbitrary log privacy is not guaranteed; logs are read only from the configured local N3zuui event file and the owned tunnel log directory.

### beta.9 managed dependencies

- Downloaded Desktop Commander 0.2.50 from npm and the official OpenAI tunnel-client 0.0.11 Windows amd64 ZIP into this application's `external` directory using the new installer. The archive matched the SHA-256 pinned from the upstream release; both version checks passed.
- Windows ARM64 archive URL/hash are pinned from the same release metadata; ARM64 execution has not been tested on this x64 machine.
- The managed Desktop Commander and tunnel-client passed the local HTTP MCP acceptance with the real tunnel `dev proxy`: separate chat workers/workspaces and selecting an existing workspace by alias passed. No hosted account or API key was used.
- WPF Setup and connection screens were rendered and inspected. Actual GUI Setup and Start/Stop handlers passed in isolated test installs with app-owned fixtures.
- Tests reject external path escapes, checksum mismatch before extraction and archive traversal. Empty installations do not discover globally installed dependencies. Tunnel Start requires this application's managed paths and supported versions.
- ZIP packaging remains an explicit allowlist excluding `external` and third-party binaries.

### beta.8 connection setup

- The new WPF connection screen was rendered and inspected. Its actual Start/Stop button handlers passed with an original local executable fixture that implements a loopback readiness endpoint.
- Tests cover invalid/missing inputs, JSON profile generation, paths with spaces and ampersands, duplicate Start, process ownership by PID/image/creation time, stop/restart, encrypted DPAPI key reuse and removal, and environment isolation from existing tunnel profiles.
- A wrapper test verifies the tunnel API key is removed before loading the N3zuui launcher. No real credential was used in these checks.
- Core tests, typecheck/build and the original GUI machine Setup passed after adding the new connection flow.
- The profile follows the installed tunnel-client 0.0.11 CLI and built-in stdio sample. Automatic approval review blocked the attempted real `run --config` test against a loopback failure endpoint, returning only `blocked by policy`. That launch/authentication path is therefore not certified by the fixture results. The beta.7 local `dev proxy` results above remain historical evidence for core transport, not proof of beta.8 hosted authentication.

A new installation/data directory on the development machine is not a fresh Windows OS. Hyper-V VM access was denied by the host's permissions, so clean-OS acceptance remains unverified. Hosted ChatGPT/account authentication, the production OpenAI control plane, Desktop Commander Remote, and other connector versions were not exercised. The local tunnel test does not certify those paths. Use the [clean-machine checklist](CLEAN-MACHINE.md) before treating this beta as a stable general release.

## beta.11 — upgrade without repeated connection setup

- Isolated Windows WPF setup test performs first install, then installs into a second directory using the same user data directory.
- Confirms Desktop Commander, tunnel-client and matching N3zuui node_modules are copied from the previous N3zuui installation. A sentinel proves npm ci did not replace reused dependencies.
- Verifies unchanged bytes for DPAPI key, tunnel settings and custom policy; verifies workspace/cap, custom config fields and updated worker/client launcher paths. Old installation remains intact.
- Forces doctor failure after configure and checks byte-for-byte rollback of config.json and mcp-client.json.
- Upgrade unit checks cover foreign-app rejection, idempotence, junction refusal and changed source/dist detection for Git updates.
- Full core, workspace, lifecycle and dashboard tests pass. This is local isolated-directory testing, not a second physical Windows machine or hosted OpenAI connector acceptance.

## beta.12 — one app, branded launcher and notification icon

- N3zuui-owned launcher builds with Windows .NET Framework compiler; embeds a seven-size ICO made from the supplied N3zuui logo. No third-party executables are bundled.
- WPF shell tests verify close/minimize to notification area, restore, duplicate launch signaling through the real EXE, explicit Windows taskbar AppUserModelID and page transition.
- Real WPF navigation test exercises Dashboard → Tunnel settings → Dashboard → machine settings → Dashboard, hide/restore in each page, and control-window exit in a single host process. Uses an isolated data directory without starting MCP.
- Exit from the tray stops only the UI and its short-lived status probe; the tunnel/broker lifecycle is unchanged. Windows controls whether the notification icon appears directly or under the overflow arrow.

## beta.13 — pre-publish hardening

- `npm test` includes case/junction locks, workspace transaction rollback, background-work restart guards, queue cancellation, dispatched-work lock retention, persistence failure/recovery and actual broker wire deadlines.
- `npm run test:runtime-upgrade` checks legacy process ownership and retirement, busy runtime rejection and unchanged configuration.
- `npm run test:integration` runs the eight suites against a separately installed Desktop Commander.
- Setup, tunnel, external dependency, upgrade and shell tests run in Windows CI. ZIP validation runs the Setup flow from extracted release files.
- `scripts/release-test.ps1 -Zip <zip> -PreviousZip <beta9.zip>,<beta11.zip>` tests a fresh extracted package and settings-preserving upgrades with isolated data and owned dependency fixtures. Source ZIPs also exercise the initial automatic build. These are tests on the current Windows account, not proof of a clean OS or hosted OpenAI authentication.

Behavior and limits: [core reliability](CORE-RELIABILITY.md).
