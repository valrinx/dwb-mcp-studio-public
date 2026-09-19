type Waiter = {
  settle: (notified: boolean, error?: unknown) => void;
};

/**
 * Wakes an agent request as soon as a new message is available.
 *
 * The queue deliberately has no durable state: AgentTaskStore is the source
 * of truth, so a waiter always re-reads the inbox after it wakes. This keeps
 * reconnects and races safe while avoiding a fixed polling interval.
 */
export class AgentWakeQueue {
  private readonly waiters = new Map<string, Set<Waiter>>();

  wait(agentId: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted)
      return Promise.reject(signal.reason ?? new Error('Agent wait was cancelled.'));
    const timeout = Math.max(0, Math.min(Math.trunc(timeoutMs), 120_000));
    if (timeout === 0) return Promise.resolve(false);

    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      let onAbort: (() => void) | undefined;
      const waiter: Waiter = {
        settle: (notified, error) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          this.waiters.get(agentId)?.delete(waiter);
          if (this.waiters.get(agentId)?.size === 0) this.waiters.delete(agentId);
          if (onAbort) signal?.removeEventListener('abort', onAbort);
          if (error !== undefined) reject(error);
          else resolve(notified);
        },
      };
      timer = setTimeout(() => waiter.settle(false), timeout);
      if (signal) {
        onAbort = () =>
          waiter.settle(false, signal.reason ?? new Error('Agent wait was cancelled.'));
        signal.addEventListener('abort', onAbort, { once: true });
      }
      let waiters = this.waiters.get(agentId);
      if (!waiters) {
        waiters = new Set<Waiter>();
        this.waiters.set(agentId, waiters);
      }
      waiters.add(waiter);
    });
  }

  notify(agentId: string): void {
    const waiters = this.waiters.get(agentId);
    if (!waiters) return;
    for (const waiter of [...waiters]) waiter.settle(true);
  }
}
