<!-- README_SYNC: source=c435e784; updated=2026-11-03 -->

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<h1 align="center">Cindy · Orca 协同试点 fork</h1>

<p align="center">
  <a href="https://github.com/makecindy/cindy">Cindy</a> 的个人 fork，用来试验 Orca 多 Agent 协同：<br>
  串行交付、阶段间重启后的对账，以及独立 Reviewer 复核。<strong>不是官方发行版。</strong>
</p>

<p align="center">
  想用 Cindy 本身，请到<a href="https://github.com/makecindy/cindy">上游仓库</a>下载；觉得有用，就给上游点个
  <a href="https://github.com/makecindy/cindy/stargazers"><strong>Star</strong></a>，方便回来找，也让更多人发现它。<br>
  想跟进这里的试点，看本 fork 的 <a href="https://github.com/Shaojie66/cindy/pulls">Pull requests</a>。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="许可证：Apache-2.0" /></a>
  <a href="https://github.com/makecindy/cindy"><img src="https://img.shields.io/badge/fork%20of-makecindy%2Fcindy-555.svg" alt="上游：makecindy/cindy" /></a>
  <a href="https://github.com/makecindy/cindy/stargazers"><img src="https://img.shields.io/github/stars/makecindy/cindy?label=upstream%20stars" alt="上游 Star 数" /></a>
  <a href="https://github.com/Shaojie66/cindy/commits/main"><img src="https://img.shields.io/github/last-commit/Shaojie66/cindy" alt="本 fork 最近一次提交" /></a>
</p>

## 这个 fork 加了什么

截至 2026-11-03，本 fork 的 `main` 在上游 `main` 的提交 `db723ff7` 之上合入的只有文档：试点文档（[#1](https://github.com/Shaojie66/cindy/pull/1)）和 README 更新（[#3](https://github.com/Shaojie66/cindy/pull/3) 及后续修正）。
**截至该日期，没有合入任何产品代码。**

| 改动 | 状态 | 位置 |
| --- | --- | --- |
| 首个串行协同试点：计划、证据合同、重启对账规则与首次运行记录 | 已合并（[#1](https://github.com/Shaojie66/cindy/pull/1)） | [`docs/dev-rules/orchestration-pilot.md`](docs/dev-rules/orchestration-pilot.md)，并在 [`AGENTS.md`](AGENTS.md) 加了索引 |
| 启动时对账「丢失运行进程」的本机 Orca Worker | 截至 2026-11-03 为 Open（[#2](https://github.com/Shaojie66/cindy/pull/2)），最新状态见 PR | Desktop 主进程、对应测试，以及 Orca 架构与试点文档 |

## 试点做了什么，结果如何

试点用现有的 Orca 做一次有人监督的串行交付。Claude 担任 Lead，一个 Orca Worker 负责写作。
独立 Reviewer 由 Lead 所在的任务显式触发现有的 `/review`：只读，不继承开发记忆。

每个阶段的执行身份、文件 hash、终态和裁决都记进台账。状态依次是
`pending → dispatched → produced → accepted`，另有 `rejected` 和 `blocked`。
Worker 报告 done 最多算 `produced`，不等于验收通过。首轮不改产品代码，不加 schema 或 migration。

首次运行的结果：

- **跑通了**：串行流程、阶段间重启后的对账、中断后的人工对账，都按证据合同完成；Worker 的 done 没有被当成验收。
- **没跑通**：写作的 Worker 原计划用 GPT-6.1 Terra，原生 OpenAI 订阅没有连上，Terra 当时只能通过另一个付费来源使用，而试点没有使用该来源，所以 Terra 从未派单。随后用户决定改用本地的 Pi + Ollama `qwen3:8b`。
  它在约 23k 的可用对话窗口下，没能按修订清单写完。两轮写作、两次 Review 之后第二稿仍被拒，最终交付记为 `rejected`。
- **发现的缺口**：应用进程和 Worker 的运行进程一起退出后再启动，Worker 在数据库里仍是 `running`。
  没有自动对账，Lead 也没被唤醒，只能靠人发现。[#2](https://github.com/Shaojie66/cindy/pull/2) 就是为这个缺口做的。
- **方法上的限制**：负对照和正文一起附给 Reviewer、两份只差一行时，比对附件就能找到插入的错句，
  证明不了 Reviewer 能在全文里独立发现问题。

完整计划、证据合同和运行记录见 [`orchestration-pilot.md`](docs/dev-rules/orchestration-pilot.md)；
Orca 本身的架构见 [`orca-team-architecture.md`](docs/dev-rules/orca-team-architecture.md)。

## 与上游的关系

- **上游**：[makecindy/cindy](https://github.com/makecindy/cindy) 是 Cindy 客户端的源码仓库，完整介绍见[上游 README](https://github.com/makecindy/cindy#readme)。
- **基线**：本 fork 的 `main` 基于上游 `main` 的 `db723ff7`。
- **发行**：本 fork 不提供安装包，也不发布版本。
- **反馈**：本 fork 没有开启 Issues。Cindy 的使用问题和 Bug 请到[上游 Issues](https://github.com/makecindy/cindy/issues)，
  先看 [SUPPORT.md](SUPPORT.md)（English：[SUPPORT.en.md](SUPPORT.en.md)）；对试点的建议，欢迎直接提 PR。

## Cindy 是什么

按上游的介绍，Cindy 是一个开源、开箱即用的 AI Agent。它连接你的多台电脑和手机，用你已有的模型与订阅；
支持 Claude Code、Codex 和 Pi 三种 Harness，也能让多个 Agent 分工协同。

客户端免费；模型调用仍按各供应商的限额和计费规则执行。支持 **macOS · Windows · Linux · iOS · Android**。

下载：[国际版](https://cindy.app/download) · [中国大陆版](https://cindy.cn/download)　官网：[国际版](https://cindy.app) · [中国大陆版](https://cindy.cn)

Linux 用户可参考 [Ubuntu、Arch Linux 与 Omarchy 安装指南](docs/linux.md)。

---

## 给开发者

本仓库包含 Cindy 的开源**桌面端、手机端及其共享 packages**，以 pnpm monorepo 组织。服务端在独立仓库，不在这里。

| 路径 | 说明 |
| --- | --- |
| `apps/desktop` | Electron 桌面客户端 |
| `apps/mobile` | Expo / React Native 手机客户端 |
| `packages/*` | 客户端共享能力（鉴权、device-link、Agent 编排、模型供应商等） |
| `apps/*-bin` | 桌面端附带的工具二进制，均不入库；claude-code / codex / ripgrep 由 `pnpm install` 按平台自动下载，Android platform-tools 在 Windows 打包前按 pin 版本下载并校验 sha256 |

### 前置要求

- **Node.js** 22.x
- **pnpm** 10.x（暂不支持 v11）
- **Git LFS**

### 快速开始

```bash
git clone https://github.com/Shaojie66/cindy.git
cd cindy
git lfs pull
pnpm install
```

要拉取上游的新提交，再加一个上游 remote：

```bash
git remote add upstream https://github.com/makecindy/cindy.git
```

依赖更新、权限和新 worktree 的准备见 [`CONTRIBUTING.md`](CONTRIBUTING.md)（English：[`CONTRIBUTING.en.md`](CONTRIBUTING.en.md)）
和[环境安装](docs/dev-rules/environment-setup.md)。

### 启动桌面端开发版

用中国大陆版 Cindy 账号：

```bash
pnpm restart:desktop:remote --region=cn
```

用国际版 Cindy 账号：

```bash
pnpm restart:desktop:remote --region=global
```

Remote 开发使用你自己的 Cindy 云端账号和现有登录态，可以继续已有的任务。区域必须显式指定，不要依赖内部默认值。

登录页的「跳过登录」不连接本地服务端：它让你不登录 Cindy 账号也能使用本机 Agent，应用内显示为「未登录」，
依赖服务端的能力在这个状态下不可用。

**关于默认服务器**：客户端默认连接 Cindy 官方云服务（端点清单见
[`config/endpoint.json`](config/endpoint.json) 与 [`config/endpoint.global.json`](config/endpoint.global.json)），
桌面端自动更新也来自官方 CDN。从本 fork 源码构建的客户端同样如此。

### 架构与规则

- [`DESIGN.md`](DESIGN.md) —— 视觉设计系统、颜色 token 与 UI 规范
- [`docs/README.md`](docs/README.md) —— 完整文档与规则索引
- [`docs/auth-realm-routing.md`](docs/auth-realm-routing.md) —— 组织 SSO 登录的区域发现与端点路由
- [`AGENTS.md`](AGENTS.md) —— 工程规范、启动与运行时契约、模块边界
- [`docs/dev-rules/orca-team-architecture.md`](docs/dev-rules/orca-team-architecture.md) —— Orca 多 Agent 协同架构
- [`docs/dev-rules/orchestration-pilot.md`](docs/dev-rules/orchestration-pilot.md) —— 本 fork 的串行协同试点
- [`docs/dev-rules/`](docs/dev-rules/) —— 其他架构深度文档

## 贡献

本 fork 的改动同样通过 PR 合入 `main`，每个 commit 都要带 [DCO](DCO) 签名（`git commit -s`），不需要签 CLA。

想给 Cindy 本身贡献代码，请向上游提 PR：先读 [`CONTRIBUTING.md`](CONTRIBUTING.md)（English：[`CONTRIBUTING.en.md`](CONTRIBUTING.en.md)），
再按 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) 提交。
同时请遵守 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)（English：[`CODE_OF_CONDUCT.en.md`](CODE_OF_CONDUCT.en.md)）。

## 安全

任何凭证或授权文件都不得提交进工作区。发现安全问题，请按 [`SECURITY.md`](SECURITY.md)
（English：[`SECURITY.en.md`](SECURITY.en.md)）私下报告给上游维护者，不要开公开 issue。

## 隐私与遥测

本 fork 没有改动这部分代码，以下说明与上游一致（截至基线提交 `db723ff7`）。

**官方分发的安装包**包含 TapDB（[taptap.cn](https://www.taptap.cn/tapdb) · [taptap.io](https://www.taptap.io/tapdb)）使用统计，用于
产品层面的汇总分析，包括设备标识、系统 / 应用版本、启动与活跃事件；登录后会
关联账号 ID，因此不应理解为完全匿名。TapDB **不采集**聊天内容、文件内容或
工作目录数据。

**无需修改代码即可关闭使用统计**：桌面端在「设置 → 关于 → 使用统计」，移动端在
设置页的「使用统计」关闭。SDK 检查本地记录的隐私同意状态和统计开关，统计开关
默认开启。同意《隐私政策》会记录同意状态；符合条件的存量已登录用户也会通过一次性
迁移记录为已同意。

**移动端已知例外**：企业 SSO 跳过协议勾选。如果本机尚无统计同意记录，并在重启应用后
恢复该登录态，当前迁移逻辑可能把新装用户也标记为已同意。在已配置 TapDB 且统计开启时，
即使用户未明确接受隐私政策，也可能开始上报。实现见
[移动端登录恢复](apps/mobile/src/auth/AuthContext.tsx)与
[同意状态迁移](apps/mobile/src/analytics/analyticsConsentStore.ts)。
关闭「使用统计」可避免该迁移放行统计上报。

- 桌面端关闭后立即停止后续统计上报；「跳过登录」的本地模式不上报 TapDB。
- 移动端关闭后立即解绑账号并停止 Cindy 主动触发的上报；已初始化的原生 SDK
  不支持反初始化，需彻底退出并重新启动应用，才会保持 SDK 未初始化。

实现依据：[桌面端同意与开关](apps/desktop/src/main/analyticsSettingsService.ts)、
[桌面端 SDK](apps/desktop/src/renderer/analytics/tapdbClient.ts)、
[移动端同意状态](apps/mobile/src/analytics/analyticsConsentStore.ts)、
[移动端 SDK](apps/mobile/src/analytics/mobileTapdb.ts)。

在线心跳与诊断日志是独立机制，不受「使用统计」开关控制。桌面端仅在已验证的云端
登录态下向 Cindy 服务发送在线心跳（账号 ID、平台与版本号），本地模式不发送。
桌面端原生崩溃转储只保留在本地，不会自动上传；诊断日志可手动上传，另外有默认关闭的
「崩溃时自动上传」选项，上传均须通过隐私同意门槛。详见
[心跳实现](apps/desktop/src/main/heartbeatService.ts)与
[日志上报规则](docs/dev-rules/log-upload-and-redaction.md)。

**从源码自行构建**时不必保留统计：

- 桌面端开发构建默认不初始化 TapDB；仅显式设置 `XDT_TAPDB_DEV=1` 才放开构建闸，
  仍须满足同意与开关条件。自行打包的桌面版与官方包使用相同统计门槛，可在设置中关闭；
- 移动端未注入 TapDB 配置（`clientId` / `clientToken`）时不会初始化 SDK。
  这不等于所有源码构建都默认关闭：自建正式发布流程要求配置非空，本地开发允许留空，
  见[移动端构建说明](apps/mobile/docs/simulator-debugging.md)。

## 许可证 / License

本 fork 沿用上游的 [`LICENSE`](LICENSE) 与 [`NOTICE`](NOTICE)，没有改动其中的版权和署名；
除另有说明外，本 fork 新增的内容同样适用根目录 `LICENSE`。

除非另有说明，本仓库的源代码依据 [Apache License 2.0](LICENSE) 授权。
源文件不单独携带许可证头，统一以仓库根目录的 `LICENSE` 为准。

模型权重、数据集、提示词、商标，以及其他单独标识的材料，可能适用各自的许可条款，
不因根目录的 Apache-2.0 而被自动覆盖。第三方开源组件保留各自的版权与许可，其归属
声明与 SPDX SBOM 统一收口在 [`docs/legal/`](docs/legal/)；各分发产物的精确清单
见 [`docs/legal/notices/`](docs/legal/notices/)。本项目的版权与归属信息见
[`NOTICE`](NOTICE)。

---

<p align="center">
  试点对你有参考价值的话：给<a href="https://github.com/makecindy/cindy/stargazers">上游</a>点个 Star，
  <a href="https://github.com/Shaojie66/cindy/pull/2">#2</a> 是针对运行进程存活检测缺口的改动，有改进建议欢迎通过本 fork 的 <a href="https://github.com/Shaojie66/cindy/pulls">Pull requests</a> 提交。
</p>
