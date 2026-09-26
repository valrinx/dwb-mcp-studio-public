# Distribution boundary

The release contains N3zuui Studio's rebranded source, compiled JavaScript, setup scripts, tests and documentation. Original N3zuui Studio materials are covered by LICENSE. Upstream-derived portions retain the notice in LICENSE-UPSTREAM-MIT.

The release does not contain Node.js, Desktop Commander, Desktop Commander Remote, OpenAI tunnel, other tunnel clients, third-party binaries, node_modules, accounts, API keys or runtime data. It is not an official release of those projects and does not grant access to their services.

When the user clicks Install in Setup, their machine downloads Desktop Commander 0.2.50 from npm and tunnel-client 0.0.11 from the [official OpenAI release](https://github.com/openai/tunnel-client/releases/tag/v0.0.11), into this DWB installation's `external` folder. These downloads are separate from the distributed ZIP. Their upstream licenses apply and are retained. See [sources and installation](docs/EXTERNAL.md).

When the user chooses Install for the catalog entry in MCP Server Manager, npm downloads `@modelcontextprotocol/server-filesystem@2026.8.31` into the DWB-managed MCP server directory. The package is pinned, npm lifecycle scripts are disabled, and it is not bundled in the DWB release. Its upstream MIT license applies.

The package manifests reference MCP SDK libraries, Zod and development tools. npm downloads these dependencies on the user's machine during setup; their own licenses apply. They are not vendored or bundled in DWB's ZIP. `npm ci --omit=dev` does not install Desktop Commander or a tunnel.

The DWB worker loader redirects the supported external worker's configuration-home expression in memory. It does not copy the external package into a release or alter the user's installed files. The test fixture under the DWB test script is an original minimal MCP test double.

## License review (2026-09-18)

| Component                 | Version reviewed       | License                                                                                                     | Delivery                                      |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| N3zuui source and launcher | 0.1.0-beta.21         | [N3zuui Proprietary License](LICENSE) + [upstream MIT notice](LICENSE-UPSTREAM-MIT)                         | Included in this repository and release       |
| Desktop Commander         | 0.2.50                 | [MIT, upstream license](https://raw.githubusercontent.com/wonderwhy-er/DesktopCommanderMCP/v0.2.50/LICENSE) | Downloaded by Setup from npm                  |
| OpenAI tunnel-client      | 0.0.11                 | [Apache-2.0, upstream license](https://raw.githubusercontent.com/openai/tunnel-client/v0.0.11/LICENSE)      | Downloaded by Setup from the upstream release |
| MCP SDK / server / client | 1.30.0 / 2.0.0 / 2.0.0 | MIT (installed package licenses and lockfile)                                                               | Downloaded by npm                             |
| MCP Filesystem server     | 2026.8.31              | [MIT, upstream license](https://github.com/modelcontextprotocol/servers/blob/main/LICENSE)                  | Downloaded from npm only after user installs  |
| Zod                       | 4.6.2                  | MIT (installed package license and lockfile)                                                                | Downloaded by npm                             |
| TypeScript                | 7.0.2                  | Apache-2.0 (installed package license and lockfile)                                                         | Downloaded by npm for source builds           |

The reviewed lockfile declares MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause and ISC licenses across its 150 dependency entries. None has a missing license field. This is a metadata inventory, not an independent provenance audit of every dependency. Dependencies remain separate downloads; DWB compilation does not bundle their implementations into the release JavaScript.

Keep N3zuui's proprietary license and the upstream license/attribution files with copies of this project. If redistributing upstream components later, review their redistribution conditions separately, including any applicable Apache NOTICE files and notices for modified files. Do not redistribute a configured installation folder as a N3zuui release.

The DWB logo supplied by the project owner is used in the launcher and documentation. This review relies on the owner's rights to that asset and the DWB source; it does not independently establish their provenance. An open-source software license does not grant access to a hosted service or permission to imply endorsement by its operator. Users supply their own authorized service credentials.
