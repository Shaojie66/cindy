import type { LostRuntimeWorkerCandidate, WorkerTurnInputOrigin } from '../localDb/orcaTeamStore.js';
import type { OrcaTeamService } from './orcaTeamService.js';

/**
 * Startup reconciliation for local Workers whose runtime died with the previous Main
 * process (orca-team-architecture.md, Worker 运行态 #13). In-process runtime deaths
 * already reach handleWorkerTerminalTurn; only a restarted process can observe this
 * gap, so it runs once per DB owner generation instead of polling.
 */
export interface OrcaLostRuntimeReconcilerDeps {
  /** Current DB owner generation; null while no DbClient is ready. */
  readClientEpoch(): number | null;
  /** This process's boot boundary, shared with the interrupted-turn prompt. */
  readBootAt(): number;
  getTeamService(): Pick<OrcaTeamService, 'reconcileLostLocalWorker'> | null;
  listCandidates(bootAt: number): Promise<readonly LostRuntimeWorkerCandidate[]>;
  readTurnInputOrigin(sessionId: string, turnStartedAt: number): Promise<WorkerTurnInputOrigin | null>;
  isLeadReadyForNotice(leadSessionId: string, bootAt: number): Promise<boolean>;
  log: {
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
  };
}

export interface OrcaLostRuntimeReconciler {
  /** Resolves true once the current owner has been reconciled; false means retry on the next ready signal. */
  reconcileCurrentOwner(): Promise<boolean>;
}

export function createOrcaLostRuntimeReconciler(
  deps: OrcaLostRuntimeReconcilerDeps,
): OrcaLostRuntimeReconciler {
  let reconciledEpoch: number | null = null;
  let tail: Promise<boolean> = Promise.resolve(false);

  const reconcileOnce = async (): Promise<boolean> => {
    const epoch = deps.readClientEpoch();
    if (epoch === null) return false;
    if (reconciledEpoch === epoch) return true;
    const service = deps.getTeamService();
    if (!service) return false;

    const bootAt = deps.readBootAt();
    let candidates: readonly LostRuntimeWorkerCandidate[];
    try {
      candidates = await deps.listCandidates(bootAt);
    } catch (err) {
      deps.log.warn('orca lost worker runtime candidates unavailable', {
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    // Carried into the service so the owner is re-checked after its locks, not only here.
    const assertCurrent = async (): Promise<void> => {
      if (deps.readClientEpoch() !== epoch) throw new Error('Account changed');
    };
    let failed = false;
    for (const candidate of candidates) {
      // An account switch replaces the database; never write the old owner's rows into it.
      if (deps.readClientEpoch() !== epoch) return false;
      try {
        const origin = await deps.readTurnInputOrigin(candidate.sessionId, candidate.turnStartedAt);
        const leadAssigned =
          origin?.kind === 'orca' && origin.senderSessionId === candidate.leadSessionId;
        const notifyLead =
          leadAssigned && (await deps.isLeadReadyForNotice(candidate.leadSessionId, bootAt));
        if (deps.readClientEpoch() !== epoch) return false;
        const result = await service.reconcileLostLocalWorker({
          workerId: candidate.workerId,
          sessionId: candidate.sessionId,
          leadSessionId: candidate.leadSessionId,
          observedUpdatedAt: candidate.updatedAt,
          turnStartedAt: candidate.turnStartedAt,
          notifyLead,
          assertCurrent,
        });
        if (result !== 'marked') {
          deps.log.info('orca lost worker runtime reconciliation skipped', {
            workerId: candidate.workerId,
            result,
          });
        }
      } catch (err) {
        // A failed candidate stays running and is retried on the next ready signal;
        // only the error CAS winner notifies, so a retry cannot notify twice.
        failed = true;
        deps.log.warn('orca lost worker runtime reconciliation failed', {
          workerId: candidate.workerId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (failed || deps.readClientEpoch() !== epoch) return false;
    reconciledEpoch = epoch;
    return true;
  };

  return {
    reconcileCurrentOwner(): Promise<boolean> {
      const current = tail.catch(() => false).then(reconcileOnce);
      tail = current;
      return current;
    },
  };
}
