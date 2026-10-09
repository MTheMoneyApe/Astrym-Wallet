export class SolanymProvider {
  public isSolanym = true;
  public publicKey: string | null = null;
  public isConnected = false;
  private listeners: Record<string, Function[]> = {
    connect: [],
    disconnect: [],
    accountChanged: []
  };
  private resolvers: Record<string, { resolve: Function, reject: Function }> = {};

  constructor() {
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  private handleMessage(event: MessageEvent) {
    if (event.source !== window || !event.data || event.data.source !== 'solanym-content') return;
    
    const { id, type, payload, error } = event.data.message;

    // Handle events from background
    if (type === 'ACCOUNT_CHANGED') {
      this.publicKey = payload.publicKey;
      this.emit('accountChanged', payload.publicKey);
      return;
    }

    if (type === 'DISCONNECTED_EVENT') {
      this.publicKey = null;
      this.isConnected = false;
      this.emit('disconnect');
      return;
    }

    // Handle responses
    if (id && this.resolvers[id]) {
      if (error) {
        this.resolvers[id].reject(new Error(error.message));
      } else {
        this.resolvers[id].resolve(payload);
      }
      delete this.resolvers[id];
    }
  }

  private request(type: string, payload: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.resolvers[id] = { resolve, reject };
      window.postMessage({
        source: 'solanym-provider',
        message: { id, type, payload }
      }, window.location.origin);
    });
  }

  async connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: string }> {
    try {
      const res = await this.request('DAPP_CONNECT', { onlyIfTrusted: options?.onlyIfTrusted });
      this.publicKey = res.publicKey;
      this.isConnected = true;
      this.emit('connect', res.publicKey);
      return { publicKey: res.publicKey };
    } catch (e: any) {
      this.isConnected = false;
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    await this.request('DAPP_DISCONNECT');
    this.publicKey = null;
    this.isConnected = false;
    this.emit('disconnect');
  }

  async signTransaction(transactionBase64: string): Promise<{ signature: string; transaction: string }> {
    if (!this.isConnected) throw new Error('Wallet not connected');
    return this.request('DAPP_SIGN_TRANSACTION', { transactionBase64 });
  }

  on(event: 'connect' | 'disconnect' | 'accountChanged', listener: Function): void {
    if (this.listeners[event]) {
      this.listeners[event].push(listener);
    }
  }

  private emit(event: string, ...args: any[]) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(listener => listener(...args));
    }
  }
}

// Inject provider
(window as any).solana = new SolanymProvider();
