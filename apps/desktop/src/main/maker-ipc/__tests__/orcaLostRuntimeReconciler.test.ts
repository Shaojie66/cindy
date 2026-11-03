/**
 * 测试价值
 * - 生产入口与可观察结果：createOrcaLostRuntimeReconciler().reconcileCurrentOwner() 及其排定的后续复查；
 *   决定哪些 Worker 交给 TeamService 标 error、哪一次、何时会唤醒 Lead，以及每个数据库 owner 只扫描一次。
 * - Bug／规则依据：orchestration-pilot.md §7「存活检测缺口」；orca-team-architecture.md
 *   「Worker 运行态」第 13 条；PR #2 审查：被跳过的 Worker 永不重试、Lead 中断时通知被丢弃、
 *   投递被拒时通知丢失。
 * - 现有覆盖缺口：orcaTeamStore.test.ts 只覆盖 SQL 判据，orcaTeamService.test.ts 只覆盖锁、CAS 与单次投递；
 *   「只有 Lead 派的活才通知」「换账号不写旧 owner 的行」「有界复查」「Lead 解除中断后才投递」
 *   「被拒后有界重投」只在这里编排。
 * - 最小失败输入：一个上一代进程留下的 running Worker，丢失的一轮由 Lead 派发。
 * - tier：unit（注入 fake，无 DB；计时器与时钟由测试推进，无真实等待）。
 */
import { describe, expect, it, vi } from 'vitest';

import type {
  LeadWorkerNoticeReadiness,
  LostRuntimeWorkerCandidate,
  WorkerTurnInputOrigin,
} from '../../localDb/orcaTeamStore.js';
import type { LostLocalWorkerParams, LostLocalWorkerResult, LostWorkerNotice } from '../orcaTeamService.js';
import {
  createOrcaLostRuntimeReconciler,
  LOST_RUNTIME_LEAD_POLL_MS,
  LOST_RUNTIME_RETRY_DELAYS_MS,
  type OrcaLostRuntimeReconcilerDeps,
} from '../orcaLostRuntimeReconciler.js';

const BOOT_AT = 10_000;
const START = 100_000;

function candidate(overrides: Partial<LostRuntimeWorkerCandidate> = {}): LostRuntimeWorkerCandidate {
  return {
    workerId: 'worker-1',
    teamId: 'team-1',
    sessionId: 'worker-session-1',
    leadSessionId: 'lead-1',
    updatedAt: 5_000,
    turnStartedAt: 6_000,
    ...overrides,
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function createHarness(overrides: Partial<OrcaLostRuntimeReconcilerDeps> = {}) {
  let epoch: number | null = 1;
  let now = START;
  const timers: Array<{ at: number; task: () => void; cancelled: boolean }> = [];
  const reconcileLostLocalWorker = vi.fn(
    async (_params: LostLocalWorkerParams): Promise<LostLocalWorkerResult> => 'marked',
  );
  const deliverLostWorkerNotice = vi.fn(async (_notice: LostWorkerNotice) => true);
  const deps: OrcaLostRuntimeReconcilerDeps = {
    readClientEpoch: () => epoch,
    readBootAt: () => BOOT_AT,
    getTeamService: () => ({ reconcileLostLocalWorker, deliverLostWorkerNotice }),
    listCandidates: vi.fn(async () => [candidate()]),
    readTurnInputOrigin: vi.fn(async (): Promise<WorkerTurnInputOrigin | null> => ({
      kind: 'orca',
      senderSessionId: 'lead-1',
    })),
    readLeadReadiness: vi.fn(async (): Promise<LeadWorkerNoticeReadiness> => 'ready'),
    schedule: (delayMs, task) => {
      const timer = { at: now + delayMs, task, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    now: () => now,
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  const pending = () => timers.filter((timer) => !timer.cancelled).sort((a, b) => a.at - b.at);
  return {
    deps,
    reconcileLostLocalWorker,
    deliverLostWorkerNotice,
    reconciler: createOrcaLostRuntimeReconciler(deps),
    setEpoch: (next: number | null) => {
      epoch = next;
    },
    /** Time until the next scheduled follow-up pass, or null when none is left. */
    pendingDelay: () => (pending()[0] ? pending()[0]!.at - now : null),
    /** Moves the clock to the next follow-up, fires it and lets its pass finish. */
    fireNext: async () => {
      const next = pending()[0];
      if (!next) throw new Error('no follow-up scheduled');
      next.cancelled = true;
      now = next.at;
      next.task();
      await settle();
    },
  };
}

describe('createOrcaLostRuntimeReconciler', () => {
  it.each([
    ['the Lead assigned the lost turn', { kind: 'orca', senderSessionId: 'lead-1' }, 1],
    ['another Lead sent the input', { kind: 'orca', senderSessionId: 'lead-2' }, 0],
    ['the user talked to the Worker directly', { kind: 'user', senderSessionId: null }, 0],
    ['no input row was found', null, 0],
  ] as const)('notifies the Lead only when %s', async (_name, origin, notices) => {
    const { reconciler, reconcileLostLocalWorker, deliverLostWorkerNotice, pendingDelay } = createHarness({
      readTurnInputOrigin: vi.fn(async () => origin),
    });

    await expect(reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    expect(reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
    expect(reconcileLostLocalWorker).toHaveBeenCalledWith({
      workerId: 'worker-1',
      sessionId: 'worker-session-1',
      leadSessionId: 'lead-1',
      observedUpdatedAt: 5_000,
      turnStartedAt: 6_000,
      assertCurrent: expect.any(Function),
    });
    expect(deliverLostWorkerNotice).toHaveBeenCalledTimes(notices);
    if (notices) {
      expect(deliverLostWorkerNotice).toHaveBeenCalledWith(
        expect.objectContaining({ leadSessionId: 'lead-1', workerId: 'worker-1', turnStartedAt: 6_000 }),
      );
    }
    // Nothing is left to follow up on.
    expect(pendingDelay()).toBeNull();
  });

  it('reconciles each DB owner generation once, including concurrent ready signals', async () => {
    const { deps, reconciler, setEpoch } = createHarness();

    const [first, second] = await Promise.all([
      reconciler.reconcileCurrentOwner(),
      reconciler.reconcileCurrentOwner(),
    ]);
    expect([first, second]).toEqual([true, true]);
    expect(deps.listCandidates).toHaveBeenCalledTimes(1);
    expect(deps.listCandidates).toHaveBeenCalledWith(BOOT_AT);

    setEpoch(2);
    await expect(reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    expect(deps.listCandidates).toHaveBeenCalledTimes(2);
  });

  it('waits for the database and team service before marking the owner reconciled', async () => {
    let service: ReturnType<OrcaLostRuntimeReconcilerDeps['getTeamService']> = null;
    const reconcileLostLocalWorker = vi.fn(async () => 'marked' as const);
    const { deps, reconciler, setEpoch } = createHarness({ getTeamService: () => service });

    setEpoch(null);
    await expect(reconciler.reconcileCurrentOwner()).resolves.toBe(false);
    setEpoch(1);
    await expect(reconciler.reconcileCurrentOwner()).resolves.toBe(false);
    expect(deps.listCandidates).not.toHaveBeenCalled();

    service = { reconcileLostLocalWorker, deliverLostWorkerNotice: vi.fn(async () => true) };
    await expect(reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    expect(reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
  });

  it('retries a scan whose candidate query failed on the next ready signal', async () => {
    const harness = createHarness();
    vi.mocked(harness.deps.listCandidates).mockRejectedValueOnce(new Error('db busy'));

    await expect(harness.reconciler.reconcileCurrentOwner()).resolves.toBe(false);
    await expect(harness.reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    expect(harness.deps.listCandidates).toHaveBeenCalledTimes(2);
    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
  });

  it('stops before touching the next Worker once the account switches mid-pass', async () => {
    const harness = createHarness({
      listCandidates: vi.fn(async () => [
        candidate(),
        candidate({ workerId: 'worker-2', sessionId: 'worker-session-2' }),
      ]),
    });
    let carried: (() => Promise<void>) | undefined;
    harness.reconcileLostLocalWorker.mockImplementation(async (params) => {
      carried = params.assertCurrent;
      await expect(params.assertCurrent()).resolves.toBeUndefined();
      harness.setEpoch(2);
      return 'marked';
    });

    await expect(harness.reconciler.reconcileCurrentOwner()).resolves.toBe(false);
    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
    // The check handed to the service also turns false, so its post-lock writes stop too.
    await expect(carried!()).rejects.toThrow('Account changed');
    // The old owner's Lead is never notified in the new account.
    expect(harness.deliverLostWorkerNotice).not.toHaveBeenCalled();
  });

  // PR #2 review: a skipped Worker was never looked at again in this process.
  it.each([
    ['stays owned', ['runtime-active', 'runtime-active', 'runtime-active', 'runtime-active', 'runtime-active'], 5, 0],
    ['is released by the first recheck', ['runtime-active', 'marked'], 2, 1],
    ['fails once, then is marked', ['failed', 'marked'], 2, 1],
  ] as const)('rechecks a Worker that %s a bounded number of times', async (_name, results, calls, notices) => {
    const harness = createHarness();
    let call = 0;
    harness.reconcileLostLocalWorker.mockImplementation(async () => {
      const result = results[Math.min(call++, results.length - 1)]!;
      if (result === 'failed') throw new Error('db busy');
      return result;
    });

    await expect(harness.reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    const delays: number[] = [];
    for (let delay = harness.pendingDelay(); delay !== null; delay = harness.pendingDelay()) {
      delays.push(delay);
      await harness.fireNext();
    }

    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(calls);
    expect(delays).toEqual(LOST_RUNTIME_RETRY_DELAYS_MS.slice(0, calls - 1));
    expect(harness.deliverLostWorkerNotice).toHaveBeenCalledTimes(notices);
    // Each recheck re-reads the candidate, so it never acts on a stale observation.
    expect(harness.deps.listCandidates).toHaveBeenCalledTimes(calls);
  });

  it('drops a recheck once the Worker is no longer a candidate', async () => {
    const harness = createHarness();
    harness.reconcileLostLocalWorker.mockResolvedValueOnce('runtime-active');
    vi.mocked(harness.deps.listCandidates).mockResolvedValueOnce([candidate()]).mockResolvedValueOnce([]);

    await harness.reconciler.reconcileCurrentOwner();
    await harness.fireNext();

    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
    expect(harness.pendingDelay()).toBeNull();
  });

  it('cancels every follow-up of the previous owner on an account switch', async () => {
    const harness = createHarness();
    harness.reconcileLostLocalWorker.mockResolvedValueOnce('runtime-active');
    await harness.reconciler.reconcileCurrentOwner();
    expect(harness.pendingDelay()).toBe(LOST_RUNTIME_RETRY_DELAYS_MS[0]);

    harness.setEpoch(2);
    await harness.fireNext();

    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
    expect(harness.pendingDelay()).toBeNull();
  });

  // PR #2 review: an interrupted Lead's notice was dropped, so it waited forever for the report.
  it.each([
    ['resolves its interruption', 'ready', 1],
    ['is archived', 'gone', 0],
  ] as const)('holds the notice while the Lead is interrupted, then delivers or drops it once the Lead %s', async (
    _name,
    later,
    notices,
  ) => {
    const readiness: LeadWorkerNoticeReadiness[] = ['interrupted', 'interrupted', later];
    const harness = createHarness({
      readLeadReadiness: vi.fn(async () => readiness.shift() ?? later),
    });

    await harness.reconciler.reconcileCurrentOwner();
    expect(harness.deliverLostWorkerNotice).not.toHaveBeenCalled();
    expect(harness.pendingDelay()).toBe(LOST_RUNTIME_LEAD_POLL_MS);
    await harness.fireNext();
    expect(harness.deliverLostWorkerNotice).not.toHaveBeenCalled();
    await harness.fireNext();

    expect(harness.deliverLostWorkerNotice).toHaveBeenCalledTimes(notices);
    expect(harness.deps.readLeadReadiness).toHaveBeenCalledWith('lead-1', BOOT_AT);
    expect(harness.pendingDelay()).toBeNull();
  });

  // PR #2 review: a rejected or failed delivery was only logged, and no later pass resent it.
  it.each([
    ['keeps being rejected', [false, false, false, false, false], 5],
    ['is accepted on the second attempt', [false, true], 2],
  ] as const)('redelivers a notice that %s a bounded number of times', async (_name, outcomes, attempts) => {
    const harness = createHarness();
    let attempt = 0;
    harness.deliverLostWorkerNotice.mockImplementation(async () => outcomes[Math.min(attempt++, outcomes.length - 1)]!);

    await harness.reconciler.reconcileCurrentOwner();
    const delays: number[] = [];
    for (let delay = harness.pendingDelay(); delay !== null; delay = harness.pendingDelay()) {
      delays.push(delay);
      await harness.fireNext();
    }

    expect(harness.deliverLostWorkerNotice).toHaveBeenCalledTimes(attempts);
    expect(delays).toEqual(LOST_RUNTIME_RETRY_DELAYS_MS.slice(0, attempts - 1));
    // Redelivery never re-runs the error CAS, so the Worker is marked once.
    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
  });
});
