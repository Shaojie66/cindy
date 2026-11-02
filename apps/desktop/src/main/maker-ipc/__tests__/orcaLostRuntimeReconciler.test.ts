/**
 * 测试价值
 * - 生产入口与可观察结果：createOrcaLostRuntimeReconciler().reconcileCurrentOwner()；决定哪些
 *   Worker 交给 TeamService 标 error、哪一次会唤醒 Lead，以及每个数据库 owner 只对账一次。
 * - Bug／规则依据：orchestration-pilot.md §7「存活检测缺口」；orca-team-architecture.md
 *   「Worker 运行态」第 13 条。
 * - 现有覆盖缺口：orcaTeamStore.test.ts 只覆盖 SQL 判据，orcaTeamService.test.ts 只覆盖锁与 CAS；
 *   「只有 Lead 派的活才通知」「换账号不写旧 owner 的行」「失败可重试」只在这里编排。
 * - 最小失败输入：一个上一代进程留下的 running Worker，丢失的一轮由 Lead 派发。
 * - tier：unit（注入 fake，无 DB、无计时器）。
 */
import { describe, expect, it, vi } from 'vitest';

import type { LostRuntimeWorkerCandidate, WorkerTurnInputOrigin } from '../../localDb/orcaTeamStore.js';
import {
  createOrcaLostRuntimeReconciler,
  type OrcaLostRuntimeReconcilerDeps,
} from '../orcaLostRuntimeReconciler.js';

const BOOT_AT = 10_000;

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

function createHarness(overrides: Partial<OrcaLostRuntimeReconcilerDeps> = {}) {
  let epoch: number | null = 1;
  const reconcileLostLocalWorker = vi.fn(async () => 'marked' as const);
  const deps: OrcaLostRuntimeReconcilerDeps = {
    readClientEpoch: () => epoch,
    readBootAt: () => BOOT_AT,
    getTeamService: () => ({ reconcileLostLocalWorker }),
    listCandidates: vi.fn(async () => [candidate()]),
    readTurnInputOrigin: vi.fn(async (): Promise<WorkerTurnInputOrigin | null> => ({
      kind: 'orca',
      senderSessionId: 'lead-1',
    })),
    isLeadReadyForNotice: vi.fn(async () => true),
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return {
    deps,
    reconcileLostLocalWorker,
    setEpoch: (next: number | null) => {
      epoch = next;
    },
    reconciler: createOrcaLostRuntimeReconciler(deps),
  };
}

describe('createOrcaLostRuntimeReconciler', () => {
  it.each([
    ['the Lead assigned the lost turn and can be woken', { kind: 'orca', senderSessionId: 'lead-1' }, true, true],
    ['another Lead sent the input', { kind: 'orca', senderSessionId: 'lead-2' }, true, false],
    ['the user talked to the Worker directly', { kind: 'user', senderSessionId: null }, true, false],
    ['no input row was found', null, true, false],
    ['the Lead is itself interrupted or gone', { kind: 'orca', senderSessionId: 'lead-1' }, false, false],
  ] as const)('notifies the Lead only when %s', async (_name, origin, leadReady, notifyLead) => {
    const { reconciler, reconcileLostLocalWorker } = createHarness({
      readTurnInputOrigin: vi.fn(async () => origin),
      isLeadReadyForNotice: vi.fn(async () => leadReady),
    });

    await expect(reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    expect(reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
    expect(reconcileLostLocalWorker).toHaveBeenCalledWith({
      workerId: 'worker-1',
      sessionId: 'worker-session-1',
      leadSessionId: 'lead-1',
      observedUpdatedAt: 5_000,
      turnStartedAt: 6_000,
      notifyLead,
    });
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

    service = { reconcileLostLocalWorker };
    await expect(reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    expect(reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
  });

  it('stops before touching the next Worker once the account switches mid-pass', async () => {
    const harness = createHarness({
      listCandidates: vi.fn(async () => [
        candidate(),
        candidate({ workerId: 'worker-2', sessionId: 'worker-session-2' }),
      ]),
    });
    harness.reconcileLostLocalWorker.mockImplementation(async () => {
      harness.setEpoch(2);
      return 'marked';
    });

    await expect(harness.reconciler.reconcileCurrentOwner()).resolves.toBe(false);
    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(1);
  });

  it('retries a failed pass on the next ready signal', async () => {
    const harness = createHarness();
    harness.reconcileLostLocalWorker.mockRejectedValueOnce(new Error('db busy'));

    await expect(harness.reconciler.reconcileCurrentOwner()).resolves.toBe(false);
    await expect(harness.reconciler.reconcileCurrentOwner()).resolves.toBe(true);
    expect(harness.deps.listCandidates).toHaveBeenCalledTimes(2);
    expect(harness.reconcileLostLocalWorker).toHaveBeenCalledTimes(2);
  });
});
