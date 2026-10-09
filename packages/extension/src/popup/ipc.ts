import browser from 'webextension-polyfill';
import type { MessageTypes, ValidatedRequestPayload, ValidatedResponsePayload, BaseResponseEnvelope } from '../shared/ipcTypes.js';

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

  if (response.error) {
    const error = new Error(response.error.message);
    error.name = response.error.name;
    throw error;
  }

  return response.payload as ValidatedResponsePayload<T>;
}
