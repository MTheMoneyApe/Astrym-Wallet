/**
 * Fase 2.30 — Bridge Ro1Broker ↔ ReadOnlySession (harness).
 * Never returns raw Client. Client.new args on the wire exclude opaque handles;
 * the session already holds rpcUrl/contractConfig from createReadOnlySession.
 */

import {
  createReadOnlySession,
  type ReadOnlyClientHandle,
  type ReadOnlySession,
  type ReadOnlySessionConfig,
} from '../readOnlyPolicy/readOnlySession.js';
import type { Ro1BrokerBackend, Ro1BrokerMethod, Ro1JsonValue } from './types.js';

export type SessionBrokerBundle = {
  session: ReadOnlySession;
  backend: Ro1BrokerBackend;
};

/**
 * Create a ReadOnlySession + broker backend that maps wire methods to session ops.
 * `Client.new` on the wire only signals "createClient" — config comes from session.
 */
export function createSessionBrokerBackend(
  config: ReadOnlySessionConfig,
): { ok: true; bundle: SessionBrokerBundle } | { ok: false; reason: string } {
  const created = createReadOnlySession(config);
  if (!created.ok) return { ok: false, reason: created.reason };

  const session = created.session;
  let handle: ReadOnlyClientHandle | undefined;

  const backend: Ro1BrokerBackend = {
    async execute(method: Ro1BrokerMethod, args: Ro1JsonValue): Promise<Ro1JsonValue> {
      if (session.state !== 'open') {
        throw new Error('session closed');
      }

      if (method === 'Storage.open') {
        const workerUrl =
          args && typeof args === 'object' && !Array.isArray(args) && 'workerUrl' in args
            ? (args as { workerUrl?: string }).workerUrl
            : undefined;
        const r = await session.openStorage(
          workerUrl !== undefined ? { workerUrl } : undefined,
        );
        if (!r.ok) throw new Error(r.reason);
        return { opened: true };
      }

      if (method === 'Client.new') {
        // Wire args already validated (loopback rpcUrl etc.) but session owns config.
        // Reject attempting to override session rpc via wire (defense in depth).
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          const wireRpc = (args as { rpcUrl?: string }).rpcUrl;
          if (typeof wireRpc === 'string' && wireRpc !== config.rpcUrl) {
            throw new Error('Client.new rpcUrl does not match session config');
          }
        }
        const r = await session.createClient();
        if (!r.ok) throw new Error(r.reason);
        handle = r.handle;
        // Never return handle object with methods — JSON summary only
        return { bound: true, sessionId: session.sessionId };
      }

      if (method === 'Client.aspState') {
        if (!handle) throw new Error('createClient required');
        const r = await handle.aspState();
        if (!r.ok) throw new Error(r.reason);
        return summarizeUnknown(r.result);
      }

      if (method === 'Client.allContractsData') {
        if (!handle) throw new Error('createClient required');
        const r = await handle.allContractsData();
        if (!r.ok) throw new Error(r.reason);
        return summarizeUnknown(r.result);
      }

      throw new Error(`unreachable method ${method}`);
    },
  };

  return { ok: true, bundle: { session, backend } };
}

function summarizeUnknown(value: unknown): Ro1JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return { type: typeof value };
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Ro1JsonValue;
  } catch {
    const keys = Object.keys(value as object).slice(0, 20);
    return { keys, note: 'non-serializable summary' };
  }
}
