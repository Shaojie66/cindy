# 首个串行协作试点

> 状态：方案已获用户批准；真实 Claude 整理已完成并核证。用户随后选择先用本地 Writer，
> 本轮改走现有 Ollama + Pi 接入，不再以 OpenAI 登录作为写作前置；本地 Writer 产出 draft-v1，阶段间重启对账通过；Review 1 后 draft-v1 被拒，用户批准第 2 轮（最后一轮）写作 draft-v2；第 2 轮经宿主中断与 Ollama 上下文调整后产出 draft-v2，Review 2 后被拒；两轮写作与两次 Review 用尽，本次运行以最终交付 rejected 结束。
> 核验基线：`db723ff786c9b5e8c9e628fab277ff01f38dc185`。
> 本文是本 fork 的试点计划，不改变 Cindy 的默认产品行为。

## 1. 本轮决定

先用现有 Orca 做一次受监督的串行交付，再根据实测失败决定是否增加可选 WorkflowRun。
首轮不增加产品代码、数据库 schema、migration、Agent 注册中心、Memory 或底层循环。
普通任务不加载试点提示、不扫描试点台账、不增加模型请求或后台服务。

参考 [orchestra-auto README（本次查看的提交）](https://github.com/whutlichao/orchestra-auto/blob/607e493/README.md)
中的协调与执行分工、持久记录、恢复核实和人工监督。其 Orca CLI 命令不移植到 Cindy；
其 exit-check 只能检查部分产物结构，不能证明内容正确。本试点不安装该工程 Skill。

## 2. 当前基线可以复用什么

以下是当前代码审计结果，不是与旧提交的完整 diff，也不是真实模型验收。

| 能力 | 当前生产入口 | 已有能力与边界 |
| --- | --- | --- |
| Lead / Worker 创建与路由 | `apps/desktop/src/main/maker-ipc/orcaWorkerCreationService.ts` | 校验来源、型号和 effort；返回实际解析的 agent/model/provider/device；创建预留租约只保护创建，不是工作流阶段锁 |
| 派单、回报、完成 | `apps/desktop/src/main/maker-ipc/orcaTeamService.ts` | accepted/dispatch/rollback 和轮次终态已存在；`done` 不检查产物或验收条件 |
| 身份与冷恢复 | `orcaSessionStartOptions.ts`、`localDb/schema.ts`、`register.ts` | 保存 team/worker/session 与原生 session 身份；恢复任务身份不代表自动恢复业务阶段 |
| 本地回报恢复缺口 | `orcaTeamService.ts`、`orcaRemoteWorkers.ts` | 本地 auto-bridge 欠回报状态在内存；跨设备有持久 pendingRemoteReport，不能推断本地也有 |
| 空闲释放 | `orcaIdleReleaseWatcher.ts` | 保留身份、历史和上下文，只释放当前进程持有且无运行/排队输入的 runtime |
| 输入恢复与租约 | `agent-input-coordinator.ts`、`recoveryCoordinator.ts`、`sessionTurnLease.ts` | 队列按 clientId 去重；持久进展用于 continuation；租约按 owner/generation 收口。提示模型核实现场不等于副作用 exactly-once |
| 自动续跑预算 | `interruptedTurnAutoResume.ts` | 存在有限重试预算，但 guard 为内存状态，重启复位；不能充当持久阶段台账 |
| Pi 子代理 | `packages/maker-core/src/agents/pi/pi-subagent-runs.ts`、`cindy-subagent-runner-source.ts` | 有依赖调度、磁盘运行记录、身份与 transcript；completed 是执行终态。resume 默认会建立新代 single/parallel 运行并清空依赖，不能当原 workflow 剩余图的恢复 |
| 群串行分工 | `botGroupChatService.ts`、`chatServer.ts` | 有串行分工与继续入口；本地旧群重启将 running 标失败，未核实已落盘产物；首轮不引入 Chat Server 前置 |
| 独立 Review | `reviewStartHandler.ts`、`reviewSessionPolicy.ts`、`reviewArtifactSnapshot.ts` | 新建无开发记忆的只读 Reviewer；快照及启动/发布时新鲜度检查已存在；completed 不等于验收通过 |
| Review 触发与恢复 | `register.ts`、`reviewRunRecovery.ts` | 显式触发、按来源任务懒初始化；重启后对已死亡 owner 的运行标失败。没有供 Agent 自动调用的 review_start 工具 |
| Memory | `packages/maker-core/src/memory/storage.ts`、`fts.ts` | Markdown 分片、派生索引、FTS 与中文兜底已存在，不另建 |

首轮相关规则继续以 [Orca 架构](orca-team-architecture.md)、
[Agent 行为](maker-core-and-agent-behavior.md)、[Review 产品方向](../product-rules/review-product-direction.md)
为正本。

## 3. 固定任务与边界

任务：用固定的 Cindy 公开源码/规则摘录，写一篇约 1,200–1,800 中文字的
《Cindy 协作的执行、验收与中断恢复说明》，给第一次使用协作的人阅读。
这是实际可用的交付文档，也能暴露把 done、恢复和验收混为一谈的问题。

素材来自本基线的 Orca 规则、Agent 行为规则和 Review 产品方向；准备阶段挑选
1,500–3,000 中文字的相关摘录，记录来源 commit、路径、行范围和 SHA-256。
原文保持不变，运行中不再追踪上游更新，不加入课程材料、私聊或凭证。

角色：

- Claude Lead：理解要求、整理事实、只派下一阶段、核证和最终裁决。
- GPT-6.1 Terra xhigh Writer：按整理结果写作，最多两轮写作/修订。
- 独立 Reviewer：从 Claude Lead 任务显式触发现有 `/review`，继承 Lead 的 Claude
  harness/provider/model；新建只读任务，不继承 Lead 的开发记忆。
- DeepSeek 首轮不启用。需要更换型号、来源或扩大调用范围时重新说明，不静默 fallback。

用户后续明确选择“先用本地模型”：本轮 Writer 允许改用本机已安装、实报支持 tools 的
Ollama 模型，优先复用 Pi 的原生 Chat 接口。Lead 与 Reviewer 沿用已授权 Claude；
不把这种组合称为全本地运行。原素材与已核证 facts 保留，路线变更以新增补充输入和
requested/resolved 证据记录，不覆盖旧输入，不沿用 Terra 的 xhigh 声明。

宿主权限确认（Lead / Writer 的工具审批）是人工监督检查点，默认由用户在试点窗口批准；
宿主审批约 10 分钟超时，超时等于未执行，不算用户拒绝。用户可明确授权操作者代批：
仅限本次试点 Lead/Writer 的请求，逐条核对工具、路径与内容；写文件只批 `artifacts/`
下计划内且尚不存在的新文件，以及计划内的 `controls/negative-control*.md` 与
`evidence/lead-check-v*.md`，并先存证待写内容 SHA-256；删除、覆盖、配置、凭证、联网
类请求不代批。每次代批写入 `evidence/operator-approvals-*.jsonl`。

上限：一个 Lead、一个 Orca Writer、最多两次显式 Review、一次阶段间重启演练；
不扩组，不无限重试，不自动合并或发布。Lead 派活后按现有协议结束该轮，等回报唤醒，
不轮询 Worker。真实调用的计费渠道须先核实。

## 4. 目录与证据合同

批准后在 **checkout 之外、独立非 Git 的工作目录**建立本次运行。仓库内部的普通子目录
仍会被 Git 向上发现，不能用来隔离 Review 范围。Lead 与 Writer 都只服务这一次试点。

先写该目录的 `AGENTS.md`，约定如下结构，再放素材：

```text
<pilot-root>/<run-id>/
  AGENTS.md                  # 范围、目录约定、人工监督与保留规则
  inputs/                    # 冻结素材、brief、rubric，只读使用
  artifacts/                 # facts.md、draft-v1.md、后续独立版本
  controls/                  # negative-control.md；保留不修复的负对照
  evidence/                  # 非敏感回执、人工核证和 Review 引用
  run-manifest.json          # 单一操作者维护的阶段台账
```

不放凭证、完整用户数据库或其他 checkout 的本地配置。不覆盖前一版产物；修订使用
`draft-v2.md`。失败材料和旧版本保留，清理时仍遵守用户的删除授权边界。
台账只是本轮运行证据，不是新增 Memory 或产品数据库，也不冒充并发安全的通用编排器。

每阶段至少记录：

- run/step/attempt、预期前序阶段、输入文件与 hash、验收条件。
- teamId、workerId、sessionId、原生 session/turn/clientId（回执可得时）。
- requested 与 resolved 的 engine/model/providerId/effort/device，以及执行中可观察的身份。
  上游没有实报的字段注明未核实；本地解析身份不冒充上游模型证明。
- 派单回执、真实启动证据、终态、产物路径及 SHA-256。
- Review 来源/Reviewer 任务、成果快照或指纹、Finding 位置、有效性及读取证据。
- Lead 的逐项裁决、操作者核对、时间与下一步。

状态区分 `pending → dispatched → produced → accepted`；另有 `rejected / blocked`。
Worker done 最多支持 produced。素材与整理等中间阶段按各自门槛核证并由操作者放行；
只有最终交付的 accepted 才同时要求实际文件、rubric、有效独立 Review 和 Lead 核证。
派单 queued 不是已运行。重启后发现有效产物，也不能倒填“当时已经验收”。
首轮由操作者监督逐阶段放行，台账不提供产品级强制门禁或自动恢复保证。

## 5. 执行与验收

| 阶段 | 动作 | 进入下一步的证据 |
| --- | --- | --- |
| 素材准备 | 冻结输入与 rubric；记录实际可用路线 | 路线存在且来源明确；素材 hash 可复核 |
| 整理 | Lead 产出 facts.md，逐条关联素材 | 核心事实有来源，不把规划当已实现 |
| 写作 | 明确授权创建 Orca Writer，派一次写作 | 真实启动/结束；文件可读；身份与 hash 入账 |
| 恢复演练 | Writer 已结束且文件落盘、Review 尚未发起时，停止并重启试点实例 | 对账同一 run/team/worker/session、队列和产物，完成核证后只进入 Review |
| 独立 Review | 在 Claude Lead 任务显式附加正文与负对照，再触发 /review | 独立 Reviewer 身份；只读；Finding 正确定位；结论未过期 |
| 最终核证 | Lead 重新读取产物，对照素材与 rubric | 正文无未处理必改问题；负对照未被修掉；操作者复核后记录 accepted |

负对照只放在 `controls/negative-control.md`：从正文另复制一份，故意加入一条
“Worker done 就表示质量验收通过”的错误。原始要求明确它是保留不修复的测试材料；
审阅关注点不提示具体错句，避免把复述答案当发现能力。

答案不能出现在 Reviewer 能读到的地方。Review 证据包含来源任务的用户消息与每轮最终答复，
因此负对照要由独立的普通 Cindy 任务生成，不在 Lead 任务里布置。Reviewer 对运行目录整体
只读可见，插入句、行号等答案记录必须放在运行目录之外的操作者目录。首轮 Review 1 中
Reviewer 读到了目录内的负对照证据，负对照 Finding 定位正确但不能证明独立发现能力。

在一次 Review 中同时附加正文与负对照，关注点可用：

```text
/review 分别核查两个 Markdown 中的事实、推理和验收表述，对照本任务指定素材与验收条件。
Finding 必须注明文件和具体原文；只读审查，不把一个文件的结论推广到另一个文件。
```

有 Finding 时宿主会自动排一轮 Lead 核实，用这一轮完成最终核证。负对照必须触发
定位正确的有效 Finding；正文独立判定，不能因为负对照有 Finding 就误判正文失败。
正文若修改，原 Review 不能继续证明新版有效，第二次显式 Review 只审新版。
第二次 Review 附加新版正文和从新版复制的 `controls/negative-control-v2.md`；首个负对照只对应
draft-v1，保留不改。Lead 历史（Review 1 的核证轮）和运行目录已出现过首个负对照的插入句，
沿用同一句等于把答案交给 Reviewer，因此 v2 负对照改插一条此前未在任何 Reviewer 可读位置
出现过、与冻结素材相冲突的执行/验收/恢复类错句，仍由独立普通任务生成，插入句、行号和
生成过程证据只记在运行目录之外的操作者目录，台账只记文件路径与 hash。
修订前若 Writer 上下文余量不足，先用宿主自带压缩处理同一 Writer Session，沿用同一
worker/session，不新建 Worker、不换模型；压缩前后的上下文占用入账。
Review 2 暴露两点限制，后续试点应先改设计再复用：其一，负对照与正文同时附上且只差一行时，
比对两份附件即可定位插入句，只能证明 Reviewer 能判断该句错误，不能证明能在全文中独立发现；
其二，Lead 在发起 Review 前于来源任务写出的初步问题清单会进入 Review 证据，正文 Finding 的
独立性随之受限。需要证明发现能力时，负对照应单独审阅，Lead 的预判留到 Review 之后。
最多两次 Review 仍未收口就记录失败原因，停止扩大调用。

正文验收清单：

1. 每条关于当前能力的实质断言能追溯到冻结素材。
2. 正确区分派单成功、真实执行完成、独立复核完成与成果验收。
3. 解释恢复前先读台账、文件、历史和队列，不承诺任意中断下 exactly-once。
4. 给出可操作的中断继续步骤；资料不足处明确未知。
5. 不声称 WorkflowRun、自动 Review 工具或专用 Reviewer 模型配置已经实现。

## 6. 重启对账与停止条件

只在阶段间演练，先确认 Writer 不再运行、无排队输入，避免引入任意进程崩溃语义。
重启用首次启动的同一组参数（命名沙箱、`--passive`、区域；带 `--isolated-auth` 前先确认沙箱
`codex-home/auth.json` 不存在），并沿用首次的 `XDT_CDP_PORT`。默认 9222 常被本机 Chrome 占用，
漏传会让新实例没有调试端口，只能改用只读 SQLite 对账，读不到内存中的回合、审批与队列投影。
重启后先核输入/产物 hash、原 Session 历史、Worker 状态、在途输入和已有验收记录。

- 文件与输入匹配、已有验收仍有效：沿用证据，跳过已验收执行。
- 文件存在但未验收：核证后决定接受或修订，不因台账空缺就重派全文。
- 状态 running 或队列归属不清：停止派单，先排除旧进程/旧输入仍在执行。
- 文件改变、证据缺失或 Review 失效：标 blocked/rejected，不伪造成功，保留现场。

恢复成功的证据是同一 Writer 任务和同一稿件 hash 被沿用，且历史中没有第二次写作派单；
不能只凭“恢复成功”的模型自述。首轮不验证任意时点 crash、跨设备或外部副作用去重。
如果暴露持久欠回报或强制门禁缺口，再单独提出可选 WorkflowRun 的最小设计及 schema 审批。

另一个候选缺口是存活检测（实测见 §7「存活检测缺口」）：Worker 为 running，但对应 runtime
已不存在。候选做法是确定性判断，不另起监督 Agent：发现两者不一致时标为异常并唤醒 Lead，
由 Lead 按本节规则对账，不自动重派。外部 Watchdog 思路参考 DeepSeek Harness 团队的
Super-agent 设计文章（2026-10-31，研究原型，未核验其实现）；进入产品前单独出方案。
若检测覆盖跨设备 Worker，还须回答[远程与移动适配](remote-and-mobile-adaptation.md)的「故障半径三问」。

## 7. 环境、授权与验证记录

启动与隔离以 [Desktop 开发](desktop-development.md) 为准。使用命名沙箱
`orchestration-pilot`、Global 区域；禁止默认共用 `dev`，不使用 `--shared`。
先确认沙箱是全新且非符号链接，再决定是否带 `--isolated-auth` 做 Codex 独立登录；
该参数具有清理本沙箱旧 auth 的语义，已有沙箱不得未经授权使用。Claude Code 仍按
当前宿主规则使用默认 CLI 登录；不复制其凭证或转录，不在试点中重登录/断开共享账号。

启动前仍须批准安全包装器对 `.env` 的创建/重写，以及新沙箱按现有 migration 链初始化
空数据库。这里的“无数据库改动”指不增加/改写 schema 和 migration，并非启动时不建库。
OpenAI 登录如需新凭证由用户在新沙箱中完成，Agent 不复制其他 checkout 的授权。

本轮已安装锁文件依赖（未复制其他 checkout 的 node_modules）；运行时二进制版本按仓库 pin。
安装曾被本机不可达 pnpm 代理阻断，本次命令增加 `--config.proxy=false --config.https-proxy=false`
后成功，只影响该命令，不修改全局配置。Git LFS 使用本机缓存内的官方校验版本，不全局安装。
只对本 checkout 配置了指向该工具的 Git LFS filter，未安装 hook 或修改全局 Git 配置。
当前平台 sqlite-vec 已从 LFS 展开，大小与原 pointer 的 SHA-256 一致，内存数据库加载
返回 v0.1.9；完整 dev runtime 资产检查通过。获准后安全启动器已创建无新增秘密的 `.env`，
按现有链初始化独立沙箱，并返回 `DESKTOP_DEV_VERDICT=ready`；定时任务保持 passive。

模型目录静态核验：离线 Registry 有 GPT-6.1 Sol 和较旧 Terra，未列 GPT-6.1 Terra。
这不证明账号不能使用它；真实运行前必须查询新实例的活动连接与实际模型发现结果。
精确目标不存在就停在配置阶段，不静默改用旧 Terra、Sol 或付费代理。

实际连接判定不能只看 `maker.auth.getState('codex').authenticated`：
该通用引擎门禁允许 Cindy AI key 作为后备就绪条件，并不证明 OpenAI 订阅已连接
（见 `apps/desktop/src/main/maker-host/auth-adapters.ts` 的 `readState`）。
运行前必须同时核对指定 provider 的 connected、精确 model ID 与 effort，并在执行身份中
保留 provider；目标模型在另一付费来源出现不能视为该订阅路线可用。每次启动使用
`--isolated-auth` 前还须检查本沙箱是否已有 auth，不能为重启而删除用户后来登录的凭证。

定向验证（当前基线实跑；不代表真实协作或完整 CI）：

| 范围 | 文件 / 用例 | 结果 / 墙钟耗时 |
| --- | --- | --- |
| Desktop Orca 创建、派单、身份、空闲释放与生命周期 | 6 / 568 | 通过，6.86s |
| Desktop Review handler、恢复、租约、快照 | 4 / 79 | 通过，3.23s |
| Desktop 自动续跑、checkpoint、执行租约、启动中断判据 | 4 / 169 | 通过，2.68s |
| maker-core Pi runner 与持久运行记录 | 2 / 208 | 通过，27.03s；真实 runner + 假 Pi child，无模型调用 |
| Orca MCP 与 Lead prompt | 2 / 61 | 通过，1.34s |
| 启动包装与文档契约 | 2 / 100 | 通过，0.99s |

合计 20 个现有测试文件、1,185 项通过。未新增测试或修改生产代码。
未执行完整 CI。已完成一次真实 Claude 素材整理轮次：SDK 消息实报型号、原生 session、
真实文件哈希与空闲终态均有本地证据；整理按中间阶段标准核证通过。原 Terra Writer 未派发：
精确目标虽出现在 Cindy AI 目录，原生 OpenAI 订阅未连接，未改用该付费来源。
随后按用户指示改为本地 Writer（Pi + Ollama `qwen3:8b`），已建 Orca Writer 并完成派单前核对。
派单前核对发现：模型不提供档位，Cindy 仍解析为 `high`；创建回执写 `auto`，落库权限为 `ask`；
无任务的就绪确认轮结束后 Worker 状态即为 `done`。这些都已作为差异入账，不当作产出证据。
此后已执行写作 v1、阶段间重启对账与 Review 1（v1 被拒）；最终写作验收仍未完成。

第 2 轮准备与执行中的实测发现（证据在运行目录 `evidence/writer-compact-01.json`、
`evidence/writing-interruption-01.json`）：

- 本地小窗口模型的 Pi Writer 固定开销约 17.8k tokens（首轮 116 字输入即 17.8k）；对话部分
  小于 Pi 默认保留窗口时，原生手动压缩返回 noop，压缩不能为第二轮腾出空间。重启后会话不在线时
  `compactSession` 直接返回 null，需先经会话树懒恢复同一原生会话。
- Cindy 记录的窗口取自模型元数据（qwen3:8b 为 40,960），请求未指定 Ollama `num_ctx`；
  实测 Ollama 当时加载的上下文为 32,768，且该加载值会受共用同一 Ollama 的其他程序影响。
  界面上的余量与压缩阈值因此可能高估真实余量；超出后截断或报错未实测。
- v2 派单送达、模型请求已发出后，试点实例与 Writer 的 Pi 进程一起退出（Pi 退出码 129，
  无崩溃报告），Worker 留在 running，draft-v2 未写出。原因未核实。这属于 §6 不覆盖的任意时点
  中断，按 blocked 入账，不自动重派。重启后读到的应用退出诊断为有序退出
  （`reason=before-quit`、disposers 完成，见运行目录 `evidence/restart-after-02.json`），与首份
  中断记录“无 before-quit”不一致，以前者为准。Pi 129（SIGHUP）与应用退出时子进程被挂断一致；
  是谁触发了 quit 未核实，时间上相近的是另一 checkout 在 14:53:13Z 起跑的
  `restart:desktop:remote`（按代码阅读不应命中本 checkout）。
- 存活检测缺口（已实测）：本地 Worker 只在会话回合的终态事件中离开 running（`orcaTeamService.ts`
  的 terminal 处理）。实例与 Pi 一起退出时不产生终态事件；重启后数据库中 Worker 仍为 running
  （`restart-after-02.json`），没有自动对账，Lead 也未被唤醒，靠操作者人工发现。
- 用户批准后把 Ollama 上下文调到 40,960（LaunchAgent 环境变量，重载后实测加载值 40,960，
  见 `evidence/ollama-context-01.json`）。重启实例对账后，Lead 只给同一 Writer 补发一条简短续执行
  消息（原派单已在原生历史中），Writer 产出 draft-v2 并按要求文字回报终态与路径。Review 2 的
  11 项正文 Finding 经 Lead 核证全部成立，draft-v2 rejected；负对照第 59 行被正确定位（限制见 §5）。
  裁决见运行目录 `evidence/operator-final-decision.md`。
- 结论：串行流程、阶段间重启对账与中断后人工对账按证据合同跑通，Done 未被当作验收；本地
  qwen3:8b Writer 在约 23k 可用对话窗口下未能按修订清单完成写作，最终交付失败。
