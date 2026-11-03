/**
 * interrupted-turn-resume — main / renderer 共享常量。
 *
 * 当前语义(2026-07-06 简化重构后):中断检测是 session 行两个时间戳的纯读判定
 * (startedAt > endedAt,见 main/localDb/sessionActiveTurn.ts 文件头),**不再往
 * 消息流插任何行**;banner 由 session 字段驱动,红点经 sessions:interrupted-pending
 * IPC 启动拉取。
 *
 * APP_EXIT_INTERRUPTED_REASON 仅作**向后兼容**保留:简化前的旧版本会在启动扫尾
 * 时给中断会话补一条 role='error'、content.reason 为该值的持久化行 —— 旧库遗留
 * 的这类历史行,renderer 仍按尾部错误行判定优雅展示(InterruptedTurnBanner),
 * content.dismissed=true(用户点过「忽略」)的排除逻辑照旧。新中断不再产生此类行。
 */
/**
 * 合成 UI 指令行(隐藏续跑 / Mivo 图片按钮等)的 magic 前缀与规范化续跑指令。
 * **唯一定义点已上移到 `@cindy/maker-shared/synthetic-trigger`**(手机端消息流 /
 * 排队区 / 会话预览同一判定),此处 re-export 保持桌面既有 import 路径稳定
 * (renderer makerChatStore 再 re-export 前缀常量)。带此前缀的 user 行经
 * coordinator enqueue 正常落库参与时序,但对一切「面向用户的文本消费」不可见:
 * renderer 消息流渲染 null;main 侧 DB 派生消费(sidebar 预览 / 任务摘要素材 /
 * 语义索引 embedder)用 isSyntheticTriggerText 排除(review P2:漏一处就会把
 * 隐藏英文指令暴露给用户或索引进语义历史)。
 */
export {
  APP_EXIT_INTERRUPTED_REASON,
  UI_ACTION_TRIGGER_PREFIX,
  isSyntheticTriggerText,
  syntheticTriggerKind,
  CONTINUE_AFTER_APP_EXIT_PROMPT,
  CONTINUE_AFTER_ERROR_PROMPT,
} from '@cindy/maker-shared/synthetic-trigger';

/**
 * 这条即将落库的 user 消息是不是**自动补发**的续跑指令。
 *
 * 唯一判据是 `agentMeta.autoResume`（coordinator → makerSendTransaction 一路透传，
 * 见 AgentInputQueuedMessage.autoResume）。**刻意不看正文**：续跑指令的文本是共享
 * 常量，用户完全可以手动发一条一模一样的内容，按文本判会把人类动作误判成自动动作。
 *
 * 用途是在「人工介入 → 重置连续失败计数」时排除自动补发的那条消息：不排除就等于
 * 自己给自己重置，连续 N 次失败后停下等人这条保证会失效。抽成纯函数是为了让这个
 * 判据只有一份、且能被单测锁住——它长在 register 的巨型 wiring 里时既测不到也容易
 * 被改坏。Orca 启动对账（orca-team-architecture.md「Worker 运行态」#13）读丢失轮次的
 * 派单来源时也用它跳过隐藏续跑行，所以放在不依赖 maker-core 的共享模块里。
 */
export function isAutoResumeUserMessage(agentMeta: unknown): boolean {
  if (!agentMeta || typeof agentMeta !== 'object') return false;
  return (agentMeta as { autoResume?: unknown }).autoResume === true;
}

/**
 * error-tail-banner:把 role='error' 行的原始 content(DB 存的 JSON 字符串)
 * merge 上 dismissed:true,返回可直接回写的对象。纯函数(规则 14,单测覆盖):
 *  - 合法 JSON 对象 → 原字段全保留(message / reason / sdkError / ...)+ dismissed;
 *  - 数组 / 标量 / 非法 JSON → 包一层 { message: 原文, dismissed: true },
 *    原始信息不丢。幂等:重复 merge 结果相同。
 */
export function mergeDismissedIntoErrorContent(raw: string): Record<string, unknown> {
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      return { ...(p as Record<string, unknown>), dismissed: true };
    }
  } catch {
    /* fall through */
  }
  return { message: raw, dismissed: true };
}
