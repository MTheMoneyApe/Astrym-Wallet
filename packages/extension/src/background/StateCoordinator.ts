import browser from 'webextension-polyfill';

export type SystemState = 
  | 'INITIALIZING'
  | 'ERROR_STATE'
  | 'RESET_BLOCKED'
  | 'UNINITIALIZED'
  | 'LOCKED'
  | 'READY'
  | 'LOCKING'
  | 'READY_WITH_MUTATION_LOCK';

export const SIGNATURE_DRAIN_TIMEOUT_MS = 35_000;

export interface SignatureAuthorization {
  readonly epoch: number;
  readonly signal: AbortSignal;
}

export class AsyncMutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      if (next) next();
    } else {
      this._locked = false;
    }
  }
}

export class StateCoordinator {
  private _state: SystemState = 'INITIALIZING';
  private _resetEpoch = 0;
  private _isResetting = false;
  private _activeSignatures = new Map<SignatureAuthorization, AbortController>();
  private _signatureDrainResolvers: Array<() => void> = [];
  private _lockRequested = false;
  private _lockOperation: Promise<void> | null = null;
  public readonly mutex = new AsyncMutex();

  public get state(): SystemState { return this._state; }
  public get resetEpoch(): number { return this._resetEpoch; }
  public get isResetting(): boolean { return this._isResetting; }
  public get activeSignatures(): number { return this._activeSignatures.size; }
  public get isLocking(): boolean { return this._lockRequested || this._state === 'LOCKING'; }

  /** Force system into ERROR_STATE due to uncertain write or corruption */
  public enterErrorState(): void {
    this._state = 'ERROR_STATE';
  }

  public async initializeHolistic(
    hasVault: boolean, 
    hasValidAccounts: boolean, 
    hasOrphanedIntent: boolean
  ): Promise<void> {
    const { solanym_reset_in_progress } = await browser.storage.local.get('solanym_reset_in_progress');

    if (solanym_reset_in_progress === true) {
      this._state = 'RESET_BLOCKED';
      return;
    }

    if (!hasValidAccounts && hasVault) {
      // Missing accounts but vault exists, or schema corrupt
      this._state = 'ERROR_STATE';
      return;
    }

    if (!hasVault) {
      this._state = 'UNINITIALIZED';
      return;
    }

    if (hasOrphanedIntent) {
      this._state = 'READY_WITH_MUTATION_LOCK';
      return;
    }

    // Default assume LOCKED (session restoration is handled separately)
    this._state = 'LOCKED';
  }

  public setUnlocked(): void {
    if (this._state === 'LOCKED' || this._state === 'UNINITIALIZED') {
      this._state = 'READY';
    } else if (this._state === 'READY_WITH_MUTATION_LOCK') {
      // Remain with mutation lock but session is active
    } else if (this._state === 'ERROR_STATE' || this._state === 'RESET_BLOCKED') {
      // Cannot unlock if errored or resetting
      throw new Error('System is in a degraded state and cannot be unlocked');
    }
  }
  
  public setLocked(): void {
    if (this._state === 'READY' || this._state === 'READY_WITH_MUTATION_LOCK' || this._state === 'LOCKING') {
      this._state = 'LOCKED';
    }
  }

  public runLockOperation(lock: () => Promise<void>): Promise<void> {
    if (this._lockOperation !== null) return this._lockOperation;

    const previousState = this._state;
    this._lockRequested = true;
    for (const controller of this._activeSignatures.values()) {
      controller.abort(new Error('Wallet lock requested'));
    }
    this._lockOperation = (async () => {
      await this.mutex.acquire();
      try {
        if (this._state === 'UNINITIALIZED' || this._state === 'RESET_BLOCKED') return;
        this._state = 'LOCKING';
        if (this._activeSignatures.size > 0) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let drainResolver: (() => void) | undefined;
          const drained = await Promise.race([
            new Promise<boolean>((resolve) => {
              drainResolver = () => resolve(true);
              this._signatureDrainResolvers.push(drainResolver);
            }),
            new Promise<boolean>((resolve) => {
              timeout = setTimeout(() => resolve(false), SIGNATURE_DRAIN_TIMEOUT_MS);
            }),
          ]);
          if (timeout !== undefined) clearTimeout(timeout);
          if (!drained) {
            // Late work retains only an invalid lease and no longer blocks locking.
            if (drainResolver !== undefined) {
              this._signatureDrainResolvers = this._signatureDrainResolvers.filter(
                (resolve) => resolve !== drainResolver,
              );
            }
            this._activeSignatures.clear();
          }
        }
        await lock();
        this._state = previousState === 'ERROR_STATE' || previousState === 'READY_WITH_MUTATION_LOCK'
          ? previousState
          : 'LOCKED';
      } finally {
        this.mutex.release();
      }
    })().catch((error: unknown) => {
      this.enterErrorState();
      throw error;
    }).finally(() => {
      this._lockOperation = null;
      this._lockRequested = false;
      if (this._state === 'LOCKING') this._state = previousState;
    });

    return this._lockOperation;
  }

  /**
   * Authorize a new signing operation to begin.
   * Returns an abortable per-operation lease tracked until endSignature().
   */
  public authorizeSignature(): SignatureAuthorization {
    if (this._isResetting) {
      throw new Error('Wallet reset in progress');
    }
    if (
      this._state === 'INITIALIZING' ||
      this._state === 'ERROR_STATE' || 
      this._state === 'RESET_BLOCKED' || 
      this._state === 'LOCKING' ||
      this._state === 'READY_WITH_MUTATION_LOCK' || 
      this._state === 'LOCKED' ||
      this._state === 'UNINITIALIZED' ||
      this._lockRequested
    ) {
      throw new Error(`System is in a degraded or locked state (${this._state}) and cannot sign`);
    }
    const controller = new AbortController();
    const authorization = Object.freeze({
      epoch: this._resetEpoch,
      signal: controller.signal,
    });
    this._activeSignatures.set(authorization, controller);
    return authorization;
  }

  /**
   * Called in finally block to cleanup active operation.
   */
  public endSignature(authorization: SignatureAuthorization): void {
    if (!this._activeSignatures.delete(authorization)) return;
    if (this._activeSignatures.size === 0) {
      const resolvers = this._signatureDrainResolvers;
      this._signatureDrainResolvers = [];
      resolvers.forEach((resolve) => resolve());
    }
  }

  public assertSignatureActive(authorization: SignatureAuthorization): void {
    if (
      !this._activeSignatures.has(authorization) ||
      authorization.signal.aborted ||
      this._lockRequested ||
      this._isResetting ||
      this._resetEpoch !== authorization.epoch ||
      this._state === 'ERROR_STATE' ||
      this._state === 'LOCKING' ||
      this._state === 'LOCKED'
    ) {
      throw new Error('Signature authorization is no longer active');
    }
  }

  /**
   * Evaluate exit barrier synchronously.
   * If valid, returns true. If invalidated by reset, lock, or error, returns false.
   */
  public validateExit(authorization: SignatureAuthorization): boolean {
    try {
      this.assertSignatureActive(authorization);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Begin a destructive reset operation.
   */
  public beginReset(): void {
    this._isResetting = true;
    this._resetEpoch++;
  }

  /**
   * Complete reset.
   */
  public finishReset(): void {
    this._isResetting = false;
    this._state = 'UNINITIALIZED';
  }
}

export const stateCoordinator = new StateCoordinator();
