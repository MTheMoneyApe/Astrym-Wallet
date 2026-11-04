import browser from 'webextension-polyfill';
import type { MessageTypes, ValidatedRequestPayload, ValidatedResponsePayload, BaseResponseEnvelope } from '../shared/ipcTypes.js';

export type NymStatusRequestResult = {
  generation: number;
  response: ValidatedResponsePayload<'NYM_STATUS'>;
};

export type NymStatusRequest = {
  generation: number;
  promise: Promise<NymStatusRequestResult>;
  isCurrent: () => boolean;
};

export function createNymStatusRequestCoordinator(
  sendStatus: () => Promise<ValidatedResponsePayload<'NYM_STATUS'>>,
): () => NymStatusRequest {
  let latestGeneration = 0;
  let inFlight: Promise<NymStatusRequestResult> | null = null;
  let pending:
    | {
        generation: number;
        resolve: (result: NymStatusRequestResult) => void;
        reject: (error: unknown) => void;
        promise: Promise<NymStatusRequestResult>;
      }
    | null = null;

  const createRequest = (
    generation: number,
    promise: Promise<NymStatusRequestResult>,
  ): NymStatusRequest => ({
    generation,
    promise,
    isCurrent: () => generation === latestGeneration,
  });

  const startRequest = (generation: number): Promise<NymStatusRequestResult> => {
    const request = sendStatus().then((response) => ({ generation, response }));
    inFlight = request;

    const settle = () => {
      if (inFlight !== request) return;
      inFlight = null;
      const queued = pending;
      pending = null;
      if (!queued) return;
      startRequest(queued.generation).then(queued.resolve, queued.reject);
    };
    void request.then(settle, settle);
    return request;
  };

  return () => {
    const generation = ++latestGeneration;
    if (!inFlight) {
      return createRequest(generation, startRequest(generation));
    }

    if (!pending) {
      let resolve!: (result: NymStatusRequestResult) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<NymStatusRequestResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending = { generation, resolve, reject, promise };
    } else {
      pending.generation = generation;
    }
    return createRequest(generation, pending.promise);
  };
}

export async function sendIpcMessage<T extends MessageTypes>(
  type: T,
  payload: ValidatedRequestPayload<T>
): Promise<ValidatedResponsePayload<T>> {
  const id = crypto.randomUUID();
  
  const response: BaseResponseEnvelope = await browser.runtime.sendMessage({
    id,
    type,
    payload
  });

  if (!response) {
    const error = new Error('No response received from background script. The extension service worker might be restarting or crashed.');
    error.name = 'IpcConnectionError';
    throw error;
  }

  if (response.error) {
    const error = new Error(response.error.message);
    error.name = response.error.name;
    throw error;
  }

  return response.payload as ValidatedResponsePayload<T>;
}

export const requestNymStatus = createNymStatusRequestCoordinator(() =>
  sendIpcMessage('NYM_STATUS', {}),
);
