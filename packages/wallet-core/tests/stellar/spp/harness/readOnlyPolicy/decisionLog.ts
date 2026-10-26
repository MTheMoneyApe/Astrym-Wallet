/**
 * Authorization / denial log — no secrets, keys, or full configs.
 */
import type { PolicyDecision } from './types.js';

export type DecisionLogEntry = {
  at: string;
  method: string;
  outcome: 'allow' | 'deny';
  reason?: string;
};

const MAX_ENTRIES = 500;

export class DecisionLog {
  private readonly entries: DecisionLogEntry[] = [];

  record(decision: PolicyDecision): void {
    const entry: DecisionLogEntry = {
      at: decision.at,
      method: decision.method,
      outcome: decision.ok ? 'allow' : 'deny',
      ...(decision.ok ? {} : { reason: decision.reason }),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  snapshot(): readonly DecisionLogEntry[] {
    return Object.freeze([...this.entries]);
  }

  clear(): void {
    this.entries.length = 0;
  }

  denials(): readonly DecisionLogEntry[] {
    return Object.freeze(this.entries.filter((e) => e.outcome === 'deny'));
  }

  allows(): readonly DecisionLogEntry[] {
    return Object.freeze(this.entries.filter((e) => e.outcome === 'allow'));
  }
}
