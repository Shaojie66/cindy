import type {
  LeadWorkerNoticeReadiness,
  LostRuntimeWorkerCandidate,
  WorkerTurnInputOrigin,
} from '../localDb/orcaTeamStore.js';
import type { LostLocalWorkerResult, LostWorkerNotice, OrcaTeamService } from './orcaTeamService.js';

/**
 * Startup reconciliation for local Workers whose runtime died with the previous Main
 * process (orca-team-architecture.md, Worker 运行态 #13). In-process runtime deaths
 * already reach handleWorkerTerminalTurn; only a restarted process can observe this
 * gap, so it scans once per DB owner generation instead of polling. After the scan it
 * only follows up on that scan's own Workers and notices, and only for a bounded time.
 */

/** Recheck and redelivery delays: four retries over about 13 minutes, then give up. */
export const LOST_RUNTIME_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;
/** How often a notice waiting on an interrupted Lead rechecks the Lead. */
export const LOST_RUNTIME_LEAD_POLL_MS = 60_000;

export interface OrcaLostRuntimeReconcilerDeps {
  /** Current DB owner generation; null while no DbClient is ready. */
  readClientEpoch(): number | null;
  /** This process's boot boundary, shared with the interrupted-turn prompt. */
  readBootAt(): number;
  getTeamService(): Pick<OrcaTeamService, 'reconcileLostLocalWorker' | 'deliverLostWorkerNotice'> | null;
  listCandidates(bootAt: number): Promise<readonly LostRuntimeWorkerCandidate[]>;
  readTurnInputOrigin(sessionId: string, turnStartedAt: number): Promise<WorkerTurnInputOrigin | null>;
  readLeadReadiness(leadSessionId: string, bootAt: number): Promise<LeadWorkerNoticeReadiness>;
  /** Runs `task` once after `delayMs`; the returned function cancels it. */
  schedule(delayMs: number, task: () => void): () => void;
  now(): number;
  log: {
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
  };
}

export interface OrcaLostRuntimeReconciler {
  /** Resolves true once the current owner has been scanned; false means retry on the next ready signal. */
  reconcileCurrentOwner(): Promise<boolean>;
}

type TeamService = NonNullable<ReturnType<OrcaLostRuntimeReconcilerDeps['getTeamService']>>;

interface Recheck {
  /** Rechecks already scheduled for this Worker. */
  attempts: number;
  dueAt: number;
}

interface PendingNotice extends LostWorkerNotice {
  /** Delivery attempts that were rejected or failed. */
  failures: number;
  dueAt: number;
}

/** Follow-up work of one owner's scan; dropped as soon as the owner changes. */
interface FollowUp {
  epoch: number;
  bootAt: number;
  rechecks: Map<string, Recheck>;
  notices: Map<string, PendingNotice>;
  cancelTimer: (() => void) | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createOrcaLostRuntimeReconciler(
  deps: OrcaLostRuntimeReconcilerDeps,
): OrcaLostRuntimeReconciler {
  let reconciledEpoch: number | null = null;
  let followUp: FollowUp | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  // Scans and follow-ups never overlap, so a Worker is never reconciled twice at once.
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.catch(() => undefined).then(task);
    tail = run;
    return run;
  };

  // An account switch replaces the database; never touch the old owner's rows or Leads.
  const isCurrent = (state: FollowUp): boolean =>
    followUp === state && deps.readClientEpoch() === state.epoch;

  const dropFollowUp = (): void => {
    followUp?.cancelTimer?.();
    followUp = null;
  };

  const retryDelay = (attempt: number): number | null => LOST_RUNTIME_RETRY_DELAYS_MS[attempt] ?? null;

  async function settleCandidate(
    state: FollowUp,
    service: TeamService,
    candidate: LostRuntimeWorkerCandidate,
  ): Promise<void> {
    const { workerId } = candidate;
    // Carried into the service so the owner is re-checked after its locks, not only here.
    const assertCurrent = async (): Promise<void> => {
      if (deps.readClientEpoch() !== state.epoch) throw new Error('Account changed');
    };
    let result: LostLocalWorkerResult | 'failed';
    try {
      const origin = await deps.readTurnInputOrigin(candidate.sessionId, candidate.turnStartedAt);
      if (!isCurrent(state)) return;
      result = await service.reconcileLostLocalWorker({
        workerId,
        sessionId: candidate.sessionId,
        leadSessionId: candidate.leadSessionId,
        observedUpdatedAt: candidate.updatedAt,
        turnStartedAt: candidate.turnStartedAt,
        assertCurrent,
      });
      // Only the CAS winner registers a notice, so each running→error transition notifies once.
      if (
        result === 'marked'
        && origin?.kind === 'orca'
        && origin.senderSessionId === candidate.leadSessionId
      ) {
        state.notices.set(workerId, {
          leadSessionId: candidate.leadSessionId,
          workerId,
          turnStartedAt: candidate.turnStartedAt,
          failures: 0,
          dueAt: deps.now(),
        });
      }
    } catch (err) {
      result = 'failed';
      deps.log.warn('orca lost worker runtime reconciliation failed', { workerId, err: errorMessage(err) });
    }
    if (result === 'marked' || result === 'changed') {
      state.rechecks.delete(workerId);
      if (result === 'changed') deps.log.info('orca lost worker runtime reconciliation skipped', { workerId, result });
      return;
    }
    deferRecheck(state, workerId, result);
  }

  /** Something may still own the Worker, or the attempt failed: look again later, a bounded number of times. */
  function deferRecheck(state: FollowUp, workerId: string, reason: 'runtime-active' | 'failed'): void {
    const attempts = state.rechecks.get(workerId)?.attempts ?? 0;
    const delay = retryDelay(attempts);
    if (delay === null) {
      state.rechecks.delete(workerId);
      deps.log.warn('orca lost worker runtime reconciliation gave up', { workerId, reason, attempts });
      return;
    }
    state.rechecks.set(workerId, { attempts: attempts + 1, dueAt: deps.now() + delay });
    deps.log.info('orca lost worker runtime reconciliation deferred', { workerId, reason, attempt: attempts + 1 });
  }

  async function deliverDueNotices(state: FollowUp, service: TeamService): Promise<void> {
    for (const notice of [...state.notices.values()]) {
      if (notice.dueAt > deps.now()) continue;
      if (!isCurrent(state)) return;
      let readiness: LeadWorkerNoticeReadiness | 'failed';
      try {
        readiness = await deps.readLeadReadiness(notice.leadSessionId, state.bootAt);
      } catch (err) {
        readiness = 'failed';
        deps.log.warn('orca lost worker runtime notice readiness unavailable', {
          workerId: notice.workerId,
          err: errorMessage(err),
        });
      }
      if (!isCurrent(state)) return;
      if (readiness === 'gone') {
        state.notices.delete(notice.workerId);
        deps.log.info('orca lost worker runtime notice dropped: lead is gone', {
          workerId: notice.workerId,
          leadSessionId: notice.leadSessionId,
        });
        continue;
      }
      if (readiness === 'interrupted') {
        // Waits for the user's own continue/ignore choice on the Lead; never made for them.
        notice.dueAt = deps.now() + LOST_RUNTIME_LEAD_POLL_MS;
        continue;
      }
      const accepted = readiness === 'ready' && (await service.deliverLostWorkerNotice(notice));
      if (accepted) {
        state.notices.delete(notice.workerId);
        continue;
      }
      if (!isCurrent(state)) return;
      const delay = retryDelay(notice.failures);
      notice.failures += 1;
      if (delay === null) {
        state.notices.delete(notice.workerId);
        deps.log.warn('orca lost worker runtime notice gave up', {
          workerId: notice.workerId,
          leadSessionId: notice.leadSessionId,
          attempts: notice.failures,
        });
        continue;
      }
      notice.dueAt = deps.now() + delay;
      deps.log.warn('orca lost worker runtime notice was not accepted', {
        workerId: notice.workerId,
        leadSessionId: notice.leadSessionId,
        attempt: notice.failures,
      });
    }
  }

  function scheduleNext(state: FollowUp): void {
    const dueTimes = [...state.rechecks.values(), ...state.notices.values()].map((item) => item.dueAt);
    if (dueTimes.length === 0) return;
    const delay = Math.max(0, Math.min(...dueTimes) - deps.now());
    state.cancelTimer = deps.schedule(delay, () => {
      void serialize(() => runFollowUp(state)).catch((err) =>
        deps.log.warn('orca lost worker runtime follow-up failed', { err: errorMessage(err) }),
      );
    });
  }

  async function recheckDueWorkers(state: FollowUp, service: TeamService): Promise<void> {
    const now = deps.now();
    const due = [...state.rechecks].filter(([, recheck]) => recheck.dueAt <= now).map(([id]) => id);
    if (due.length === 0) return;
    let candidates: readonly LostRuntimeWorkerCandidate[] | null = null;
    try {
      candidates = await deps.listCandidates(state.bootAt);
    } catch (err) {
      deps.log.warn('orca lost worker runtime candidates unavailable', { err: errorMessage(err) });
    }
    const byId = new Map<string, LostRuntimeWorkerCandidate>(
      candidates?.map((candidate) => [candidate.workerId, candidate] as const),
    );
    for (const workerId of due) {
      if (!isCurrent(state)) return;
      const candidate = byId.get(workerId);
      if (candidate) await settleCandidate(state, service, candidate);
      // No longer a candidate: the Worker row or its turn moved on without us.
      else if (candidates) state.rechecks.delete(workerId);
      else deferRecheck(state, workerId, 'failed');
    }
  }

  async function runFollowUp(state: FollowUp): Promise<void> {
    state.cancelTimer = null;
    if (!isCurrent(state)) return;
    // The scan only ran with a service, which is never unset afterwards.
    const service = deps.getTeamService();
    if (!service) return;
    await recheckDueWorkers(state, service);
    if (!isCurrent(state)) return;
    await deliverDueNotices(state, service);
    if (!isCurrent(state)) return;
    scheduleNext(state);
  }

  const reconcileOnce = async (): Promise<boolean> => {
    const epoch = deps.readClientEpoch();
    if (epoch === null) return false;
    if (reconciledEpoch === epoch) return true;
    const service = deps.getTeamService();
    if (!service) return false;

    // A previous owner's follow-ups never carry over to this one.
    dropFollowUp();
    const bootAt = deps.readBootAt();
    let candidates: readonly LostRuntimeWorkerCandidate[];
    try {
      candidates = await deps.listCandidates(bootAt);
    } catch (err) {
      deps.log.warn('orca lost worker runtime candidates unavailable', { err: errorMessage(err) });
      return false;
    }
    const state: FollowUp = { epoch, bootAt, rechecks: new Map(), notices: new Map(), cancelTimer: null };
    followUp = state;
    for (const candidate of candidates) {
      if (!isCurrent(state)) return false;
      await settleCandidate(state, service, candidate);
    }
    if (!isCurrent(state)) return false;
    await deliverDueNotices(state, service);
    if (!isCurrent(state)) return false;
    reconciledEpoch = epoch;
    scheduleNext(state);
    return true;
  };

  return {
    reconcileCurrentOwner(): Promise<boolean> {
      return serialize(reconcileOnce);
    },
  };
}
