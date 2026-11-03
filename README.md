<!-- README_SYNC: source=c435e784; updated=2026-11-03 -->

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">Cindy · Orca orchestration pilot fork</h1>

<p align="center">
  A personal fork of <a href="https://github.com/makecindy/cindy">Cindy</a> for testing Orca multi-agent collaboration:<br>
  serial hand-offs, reconciliation after a restart between stages, and review by an independent Reviewer. <strong>Not an official release.</strong>
</p>

<p align="center">
  Looking for Cindy itself? Download it from the <a href="https://github.com/makecindy/cindy">upstream repository</a>, and if it helps you,
  give upstream a <a href="https://github.com/makecindy/cindy/stargazers"><strong>Star</strong></a> so you can find it again and others can discover it.<br>
  To follow the pilot, watch this fork's <a href="https://github.com/Shaojie66/cindy/pulls">pull requests</a>.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
  <a href="https://github.com/makecindy/cindy"><img src="https://img.shields.io/badge/fork%20of-makecindy%2Fcindy-555.svg" alt="Fork of makecindy/cindy" /></a>
  <a href="https://github.com/makecindy/cindy/stargazers"><img src="https://img.shields.io/github/stars/makecindy/cindy?label=upstream%20stars" alt="Upstream stars" /></a>
  <a href="https://github.com/Shaojie66/cindy/commits/main"><img src="https://img.shields.io/github/last-commit/Shaojie66/cindy" alt="Last commit in this fork" /></a>
</p>

## What this fork adds

As of 2026-11-03, this fork's `main` has merged only documentation on top of upstream `main` at `db723ff7`: the pilot docs ([#1](https://github.com/Shaojie66/cindy/pull/1)) and README updates ([#3](https://github.com/Shaojie66/cindy/pull/3) and subsequent corrections).
**No product code has been merged as of that date.**

| Change | Status | Where |
| --- | --- | --- |
| First serial collaboration pilot: plan, evidence contract, restart reconciliation rules, and the first-run record | Merged ([#1](https://github.com/Shaojie66/cindy/pull/1)) | [`docs/dev-rules/orchestration-pilot.md`](docs/dev-rules/orchestration-pilot.md), indexed from [`AGENTS.md`](AGENTS.md) |
| On startup, reconcile local Orca Workers whose runtime process is gone | Open as of 2026-11-03 ([#2](https://github.com/Shaojie66/cindy/pull/2)); see the PR for its current status | Desktop main process, its tests, and the Orca architecture and pilot docs |

## The pilot and what happened

The pilot runs one supervised, serial delivery through the existing Orca team feature. Claude is the Lead,
and a single Orca Worker does the writing. An independent Reviewer is started by explicitly running the existing
`/review` from the Lead's session: it is read-only and does not inherit the development history.

Every stage records its execution identity, file hashes, final state and verdict in a ledger. States move through
`pending → dispatched → produced → accepted`, with `rejected` and `blocked` on the side.
A Worker reporting done counts as `produced` at most, never as accepted. The first round changes no product code
and adds no schema or migration.

Results of the first run:

- **Worked**: the serial flow, reconciliation after a planned restart between stages, and manual reconciliation
  after an interruption all followed the evidence contract. A Worker's done was never treated as acceptance.
- **Did not work**: the writing Worker was planned to use GPT-6.1 Terra. The native OpenAI subscription was not
  connected. Terra was available only through another paid source, which the pilot did not use, so Terra was never dispatched. The user then chose to use
  local Pi + Ollama `qwen3:8b`. With roughly 23k tokens of usable conversation window,
  it could not finish the revision checklist. After two writing rounds and two reviews the second draft was still
  rejected, and the final delivery was recorded as `rejected`.
- **Gap found**: when the app process and the Worker's runtime exit together, the Worker is still `running` in the
  database after relaunch. Nothing reconciles it and the Lead is never woken up; a person has to notice.
  [#2](https://github.com/Shaojie66/cindy/pull/2) targets this gap.
- **Method limit**: when the negative control and the real draft are attached together and differ by one line,
  diffing the attachments is enough to find the planted sentence. That does not show the Reviewer can find
  problems in a full document on its own.

The full plan, evidence contract and run record are in [`orchestration-pilot.md`](docs/dev-rules/orchestration-pilot.md).
Orca's own architecture is in [`orca-team-architecture.md`](docs/dev-rules/orca-team-architecture.md).

## Relationship to upstream

- **Upstream**: [makecindy/cindy](https://github.com/makecindy/cindy) is the source repository for the Cindy clients.
  See the [upstream README](https://github.com/makecindy/cindy#readme) for the full introduction.
- **Base**: this fork's `main` is based on upstream `main` at `db723ff7`.
- **Releases**: this fork ships no installers and publishes no releases.
- **Feedback**: Issues are not enabled on this fork. Report Cindy bugs and usage questions in
  [upstream Issues](https://github.com/makecindy/cindy/issues) after reading [SUPPORT.en.md](SUPPORT.en.md)
  (中文：[SUPPORT.md](SUPPORT.md)). Suggestions about the pilot are welcome as pull requests.

## What Cindy is

In upstream's words, Cindy is an open-source AI agent that works out of the box. It connects your computers
and phone and uses the models and subscriptions you already have. It supports three harnesses (Claude Code,
Codex and Pi) and can split work across several agents that collaborate.

The client is free; model usage still follows each provider's limits and billing.
Available on **macOS · Windows · Linux · iOS · Android**.

[Download](https://cindy.app/download) · [Website](https://cindy.app) · Mainland China: [download](https://cindy.cn/download) · [website](https://cindy.cn)

Linux users: see the [Ubuntu, Arch Linux and Omarchy installation guide](docs/linux.md).

---

## For developers

This repository contains Cindy's open-source **desktop and mobile clients** and their shared packages,
organized as a pnpm monorepo. The backend service lives in a separate repository.

| Path | Description |
| --- | --- |
| `apps/desktop` | Electron desktop client |
| `apps/mobile` | Expo / React Native mobile client |
| `packages/*` | Shared client capabilities (auth, device-link, agent orchestration, model providers, …) |
| `apps/*-bin` | Tool binaries shipped with the desktop app; none are committed — claude-code, codex, and ripgrep are downloaded per platform by `pnpm install`, and the Android platform-tools binaries are fetched (pinned version, sha256-verified) before Windows packaging |

### Prerequisites

- **Node.js** 22.x
- **pnpm** 10.x (v11 is not yet supported)
- **Git LFS**

### Getting started

```bash
git clone https://github.com/Shaojie66/cindy.git
cd cindy
git lfs pull
pnpm install
```

To pull in new upstream commits, add an upstream remote:

```bash
git remote add upstream https://github.com/makecindy/cindy.git
```

Dependency updates, access requirements and new-worktree setup are covered in
[`CONTRIBUTING.en.md`](CONTRIBUTING.en.md) (中文：[`CONTRIBUTING.md`](CONTRIBUTING.md)) and the
[environment setup guide](docs/dev-rules/environment-setup.md).

### Run the desktop dev build

With a Mainland China Cindy account:

```bash
pnpm restart:desktop:remote --region=cn
```

With a Global Cindy account:

```bash
pnpm restart:desktop:remote --region=global
```

Remote development uses your own Cindy cloud account and existing login state, so you can continue existing
sessions. Always pass the region explicitly; do not rely on the internal default.

“Skip Sign-In” on the login screen does not connect to a local server. It runs local agents without a Cindy
account (shown in the app as “Not signed in”); server-backed capabilities are unavailable in that state.

**About the default servers:** the client connects to Cindy's official cloud services by default (endpoint
manifests in [`config/endpoint.json`](config/endpoint.json) and
[`config/endpoint.global.json`](config/endpoint.global.json)); desktop auto-updates also come from the
official CDN. Clients built from this fork behave the same way.

### Architecture and rules

- [`DESIGN.md`](DESIGN.md) — visual design system, color tokens, and UI conventions
- [`docs/README.md`](docs/README.md) — complete documentation and rules index
- [`docs/auth-realm-routing.md`](docs/auth-realm-routing.md) — organization SSO region discovery and session endpoint routing
- [`AGENTS.md`](AGENTS.md) — engineering rules, launch/runtime contracts, and module boundaries
- [`docs/dev-rules/orca-team-architecture.md`](docs/dev-rules/orca-team-architecture.md) — Orca multi-agent collaboration architecture
- [`docs/dev-rules/orchestration-pilot.md`](docs/dev-rules/orchestration-pilot.md) — this fork's serial collaboration pilot
- [`docs/dev-rules/`](docs/dev-rules/) — other deep-dive architecture docs

## Contributing

Changes to this fork also go through pull requests into `main`. Every commit needs a
[Developer Certificate of Origin](DCO) sign-off (`git commit -s`); no CLA is required.

To contribute to Cindy itself, open a pull request upstream: read [`CONTRIBUTING.en.md`](CONTRIBUTING.en.md)
(中文：[`CONTRIBUTING.md`](CONTRIBUTING.md)) first, then use
[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).
Please also follow [`CODE_OF_CONDUCT.en.md`](CODE_OF_CONDUCT.en.md) (中文：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)).

## Security

Never commit credentials or authorization files to the working tree. If you discover a security issue, follow
[`SECURITY.en.md`](SECURITY.en.md) (中文：[`SECURITY.md`](SECURITY.md)) to report it privately to the upstream
maintainers rather than opening a public issue.

## Privacy & telemetry

This fork does not change this code; the description below matches upstream as of the base commit `db723ff7`.

**Official distribution builds** include TapDB ([taptap.io](https://www.taptap.io/tapdb) · [taptap.cn](https://www.taptap.cn/tapdb))
usage analytics for product-level aggregate statistics, including device identifiers,
OS / app version, startup and activity events. Events are associated with your account
ID after sign-in, so this is not fully anonymous. TapDB does **not** collect chat
content, file content, or working-directory data.

**You can disable usage analytics without editing code**: on Desktop, use
Settings → About → Usage statistics; on Mobile, use Usage statistics in Settings.
The SDK checks the stored privacy-consent state and the statistics preference,
which defaults to on. Accepting the Privacy Policy records consent; a one-time
migration also records consent for eligible existing signed-in users.

**Known Mobile exception:** enterprise SSO skips the policy-acceptance step. If no
analytics consent record exists and that sign-in is restored after restarting the
app, the current migration can mark even a new installation as consented. With
TapDB configured and statistics enabled, reporting can then start without explicit
policy acceptance. See [Mobile sign-in restoration](apps/mobile/src/auth/AuthContext.tsx)
and the [consent migration](apps/mobile/src/analytics/analyticsConsentStore.ts).
Turning off Usage statistics prevents reporting from being enabled by this migration.

- Desktop stops subsequent analytics reporting immediately when disabled. Local
  mode (Skip sign-in) does not report to TapDB.
- Mobile immediately unlinks the account and stops reports explicitly triggered
  by Cindy. An already initialized native SDK cannot be uninitialized; fully quit
  and relaunch the app to keep the SDK uninitialized.

Implementation: [Desktop consent and settings](apps/desktop/src/main/analyticsSettingsService.ts),
[Desktop SDK](apps/desktop/src/renderer/analytics/tapdbClient.ts),
[Mobile consent](apps/mobile/src/analytics/analyticsConsentStore.ts), and
[Mobile SDK](apps/mobile/src/analytics/mobileTapdb.ts).

Online heartbeats and diagnostic logs are separate mechanisms, unaffected by the
usage statistics switch. Desktop sends heartbeats to Cindy services only during a
verified cloud sign-in (account ID, platform, and version); local mode sends none.
Desktop native crash dumps stay local and are never uploaded automatically.
Diagnostic logs can be uploaded manually; a separate, default-off automatic crash
log upload option is also available. Log uploads require privacy consent. See the
[heartbeat implementation](apps/desktop/src/main/heartbeatService.ts) and
[log upload rules](docs/dev-rules/log-upload-and-redaction.md).

**Building from source?** You are not required to keep analytics:

- Desktop development builds do not initialize TapDB by default. Explicitly setting
  `XDT_TAPDB_DEV=1` lifts the build gate but still requires consent and the statistics
  preference. Self-packaged Desktop builds use the same analytics gates as official
  builds; you can disable analytics in Settings.
- Mobile does not initialize the SDK without injected TapDB configuration
  (`clientId` / `clientToken`). This does not mean all source builds default to off:
  the self-hosted release pipeline requires nonempty configuration, while local
  development permits empty values. See the
  [Mobile build guide](apps/mobile/docs/simulator-debugging.md).

## License / 许可证

This fork keeps upstream's [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) unchanged, including their copyright and
attribution. Except as otherwise noted, content added in this fork is also covered by the repository-root `LICENSE`.

Except as otherwise noted, the source code in this repository is licensed under
the [Apache License, Version 2.0](LICENSE). Individual source files do not
carry per-file license headers; the repository-root `LICENSE` governs.

Model weights, datasets, prompts, trademarks, and other separately identified
materials may be subject to their own license terms and are not automatically
covered by the repository-level Apache-2.0 grant. Third-party open-source
components retain their own copyright and license. Their attribution notices and
SPDX SBOMs are managed under [`docs/legal/`](docs/legal/), with artifact-specific
outputs in [`docs/legal/notices/`](docs/legal/notices/). See [`NOTICE`](NOTICE)
for this project's copyright and attribution information.

---

<p align="center">
  If the pilot is useful to you: star <a href="https://github.com/makecindy/cindy/stargazers">upstream</a>,
  <a href="https://github.com/Shaojie66/cindy/pull/2">#2</a> addresses the runtime liveness gap; send improvements through this fork's <a href="https://github.com/Shaojie66/cindy/pulls">pull requests</a>.
</p>
