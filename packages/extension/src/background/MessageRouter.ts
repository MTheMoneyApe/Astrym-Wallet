import browser from 'webextension-polyfill';
import { BaseRequestEnvelopeSchema, MessageSchemas } from '../shared/ipcSchemas.js';
import type { BaseResponseEnvelope, MessageTypes, ValidatedRequestPayload, ValidatedResponsePayload } from '../shared/ipcTypes.js';

export type MessageHandler<T extends MessageTypes> = (
  payload: ValidatedRequestPayload<T>,
  sender?: browser.Runtime.MessageSender
) => Promise<ValidatedResponsePayload<T>>;

export class MessageRouter {
  private readonly _handlers = new Map<MessageTypes, MessageHandler<any>>();
  private readonly _dappRoutes = new Set<MessageTypes>([
    'DAPP_CONNECT',
    'DAPP_DISCONNECT',
    'DAPP_SIGN_TRANSACTION'
  ]);

  public registerHandler<T extends MessageTypes>(type: T, handler: MessageHandler<T>): void {
    this._handlers.set(type, handler);
  }

  public async routeMessage(rawMessage: unknown, sender?: browser.Runtime.MessageSender): Promise<BaseResponseEnvelope> {
    let envelope;
    
    // 1. Validate envelope shape first so we know what route we're dealing with
    try {
      envelope = BaseRequestEnvelopeSchema.parse(rawMessage);
    } catch (e: any) {
      return {
        id: 'UNKNOWN',
        type: 'ERROR',
        error: { name: 'MalformedEnvelopeError', message: 'Message envelope is malformed or missing id/type' }
      };
    }

    const isDappRoute = this._dappRoutes.has(envelope.type as MessageTypes);

    // 2. Sender Authorization (Security Boundary)
    if (!sender) {
      return {
        id: envelope.id,
        type: 'ERROR',
        error: { name: 'UnauthorizedSenderError', message: 'Message sender missing' }
      };
    }

    const isInternalSender = sender.id === browser.runtime.id && sender.url && sender.url.startsWith(`chrome-extension://${browser.runtime.id}/`);
    
    if (isDappRoute) {
      if (!sender.url || sender.url.startsWith('chrome-extension://')) {
        return {
          id: envelope.id,
          type: 'ERROR',
          error: { name: 'UnauthorizedSenderError', message: 'DApp routes not allowed from internal origins or missing URL' }
        };
      }
      try {
        const parsedUrl = new URL(sender.url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new Error();
        }
      } catch {
        return {
          id: envelope.id,
          type: 'ERROR',
          error: { name: 'UnauthorizedSenderError', message: 'DApp routes only allowed from http/https origins' }
        };
      }
    } else if (envelope.type === 'REVEAL_RECOVERY_PHRASE') {
      if (
        !isInternalSender ||
        sender.url !== browser.runtime.getURL('/popup.html')
      ) {
        return {
          id: envelope.id,
          type: 'ERROR',
          error: {
            name: 'UnauthorizedSenderError',
            message: 'Recovery phrase reveal must originate from the trusted popup',
          },
        };
      }
    } else {
      // Internal route
      if (!isInternalSender) {
        return {
          id: envelope.id,
          type: 'ERROR',
          error: { name: 'UnauthorizedSenderError', message: 'Message sender is not authorized for internal routes' }
        };
      }
    }



    // 2. Route existence
    const handler = this._handlers.get(envelope.type as MessageTypes);
    if (!handler) {
      return {
        id: envelope.id,
        type: envelope.type,
        error: { name: 'UnknownMessageTypeError', message: `No handler registered for type: ${envelope.type}` }
      };
    }

    // 3. Schema lookup
    const schemaDef = MessageSchemas[envelope.type as MessageTypes];
    if (!schemaDef) {
      return {
        id: envelope.id,
        type: envelope.type,
        error: { name: 'SchemaNotFoundError', message: `No schema defined for type: ${envelope.type}` }
      };
    }

    // 4. Validate payload against Zod schema
    let parsedPayload;
    try {
      parsedPayload = schemaDef.request.parse(envelope.payload || {});
    } catch (e: any) {
      return {
        id: envelope.id,
        type: envelope.type,
        error: { name: 'PayloadValidationError', message: 'Payload failed strict schema validation' }
      };
    }

    // 5. Execute handler
    try {
      const result = await handler(parsedPayload, sender);
      
      // 6. Validate response against Zod schema (prevent accidental secret leaks)
      const parsedResult = schemaDef.response.parse(result);
      
      return {
        id: envelope.id,
        type: envelope.type,
        payload: parsedResult
      };
    } catch (e: any) {
      // Safe error serialization (no stack traces!)
      return {
        id: envelope.id,
        type: envelope.type,
        error: {
          name: e.name || 'Error',
          message: e.message || 'Unknown error occurred during processing'
        }
      };
    }
  }
}
