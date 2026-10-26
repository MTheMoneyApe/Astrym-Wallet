import {
  BaseRequestEnvelopeSchema,
  BaseResponseEnvelopeSchema,
  DappConnectRequestSchema,
  DappConnectResponseSchema,
  DappDisconnectRequestSchema,
  DappDisconnectResponseSchema,
  DappSignRequestSchema,
  DappSignResponseSchema,
} from '../shared/ipcSchemas.js';

type DappMessageType = 'DAPP_CONNECT' | 'DAPP_DISCONNECT' | 'DAPP_SIGN_TRANSACTION';

const DAPP_REQUEST_SCHEMAS = {
  DAPP_CONNECT: DappConnectRequestSchema,
  DAPP_DISCONNECT: DappDisconnectRequestSchema,
  DAPP_SIGN_TRANSACTION: DappSignRequestSchema,
};

const DAPP_RESPONSE_SCHEMAS = {
  DAPP_CONNECT: DappConnectResponseSchema,
  DAPP_DISCONNECT: DappDisconnectResponseSchema,
  DAPP_SIGN_TRANSACTION: DappSignResponseSchema,
};

function isDappMessageType(type: string): type is DappMessageType {
  return (
    type === 'DAPP_CONNECT' ||
    type === 'DAPP_DISCONNECT' ||
    type === 'DAPP_SIGN_TRANSACTION'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postProviderResponse(message: unknown): void {
  window.postMessage(
    {
      source: 'solanym-content',
      message,
    },
    window.location.origin,
  );
}

function postProviderError(id: string, name: string, message: string): void {
  try {
    postProviderResponse({
      id,
      type: 'ERROR',
      error: { name, message },
    });
  } catch {
    // The page may have navigated or detached before the response could be posted.
  }
}

async function forwardDappRequest(rawMessage: unknown): Promise<void> {
  let requestId: string | undefined;
  try {
    const envelopeResult = BaseRequestEnvelopeSchema.safeParse(rawMessage);
    if (!envelopeResult.success) {
      if (
        isRecord(rawMessage) &&
        typeof rawMessage['id'] === 'string' &&
        rawMessage['id'].length > 0 &&
        typeof rawMessage['type'] === 'string' &&
        isDappMessageType(rawMessage['type'])
      ) {
        postProviderError(rawMessage['id'], 'MalformedEnvelopeError', 'DApp request envelope is malformed');
      }
      return;
    }

    const envelope = envelopeResult.data;
    const requestType = envelope.type;
    if (!isDappMessageType(requestType)) return;
    requestId = envelope.id;

    const payload = Object.prototype.hasOwnProperty.call(rawMessage, 'payload')
      ? envelope.payload
      : {};
    const payloadResult = DAPP_REQUEST_SCHEMAS[requestType].safeParse(payload);
    if (!payloadResult.success) {
      postProviderError(requestId, 'PayloadValidationError', 'DApp request payload is invalid');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      id: requestId,
      type: requestType,
      payload: payloadResult.data,
    });
    const responseResult = BaseResponseEnvelopeSchema.safeParse(response);
    if (!responseResult.success || responseResult.data.id !== requestId) {
      postProviderError(requestId, 'InvalidResponseError', 'Wallet returned an invalid response');
      return;
    }

    const validatedResponse = responseResult.data;
    if (validatedResponse.error !== undefined) {
      if (validatedResponse.type !== requestType && validatedResponse.type !== 'ERROR') {
        postProviderError(requestId, 'InvalidResponseError', 'Wallet returned an invalid response');
        return;
      }
      postProviderResponse(validatedResponse);
      return;
    }

    if (validatedResponse.type !== requestType) {
      postProviderError(requestId, 'InvalidResponseError', 'Wallet returned an invalid response');
      return;
    }

    const responsePayloadResult = DAPP_RESPONSE_SCHEMAS[requestType].safeParse(
      validatedResponse.payload,
    );
    if (!responsePayloadResult.success) {
      postProviderError(requestId, 'InvalidResponseError', 'Wallet returned an invalid response');
      return;
    }

    postProviderResponse({
      ...validatedResponse,
      payload: responsePayloadResult.data,
    });
  } catch (error) {
    if (requestId !== undefined) {
      postProviderError(
        requestId,
        'ContentScriptError',
        error instanceof Error ? error.message : 'Message forwarding failed',
      );
    }
  }
}

// Inject the provider script into the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('provider.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (
    event.source !== window ||
    !isRecord(event.data) ||
    event.data['source'] !== 'solanym-provider' ||
    !isRecord(event.data['message'])
  ) {
    return;
  }

  void forwardDappRequest(event.data['message']);
});
