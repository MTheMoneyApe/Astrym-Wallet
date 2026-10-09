import browser from 'webextension-polyfill';

export type SystemState = 
  | 'INITIALIZING'
  | 'ERROR_STATE'
  | 'RESET_BLOCKED'
  | 'UNINITIALIZED'
  | 'LOCKED'
  | 'READY'
  | 'READY_WITH_MUTATION_LOCK';

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
  private _activeSignatures = 0;
  public readonly mutex = new AsyncMutex();

  public get state(): SystemState { return this._state; }
  public get resetEpoch(): number { return this._resetEpoch; }
  public get isResetting(): boolean { return this._isResetting; }
  public get activeSignatures(): number { return this._activeSignatures; }

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
    if (this._state === 'LOCKED') {
      this._state = 'READY';
    } else if (this._state === 'READY_WITH_MUTATION_LOCK') {
      // Remain with mutation lock but session is active
    } else if (this._state === 'ERROR_STATE' || this._state === 'RESET_BLOCKED') {
      // Cannot unlock if errored or resetting
      throw new Error('System is in a degraded state and cannot be unlocked');
    }
  }
  
  public setLocked(): void {
    if (this._state === 'READY' || this._state === 'READY_WITH_MUTATION_LOCK') {
      this._state = 'LOCKED';
    }
  }

  /**
   * Authorize a new signing operation to begin.
   * Increments activeSignatures, returns current epoch.
   */
  public authorizeSignature(): number {
    if (this._isResetting) {
      throw new Error('Wallet reset in progress');
    }
    if (
      this._state === 'ERROR_STATE' || 
      this._state === 'RESET_BLOCKED' || 
      this._state === 'READY_WITH_MUTATION_LOCK' || 
      this._state === 'LOCKED'
    ) {
      throw new Error(`System is in a degraded or locked state (${this._state}) and cannot sign`);
    }
    this._activeSignatures++;
    return this._resetEpoch;
  }

  /**
   * Called in finally block to cleanup active operation.
   */
  public endSignature(): void {
    if (this._activeSignatures > 0) {
      this._activeSignatures--;
    }
  }

  /**
   * Evaluate exit barrier synchronously.
   * If valid, returns true. If invalid (reset happened), returns false.
   */
  public validateExit(startEpoch: number): boolean {
    return !this._isResetting && this._resetEpoch === startEpoch && this._state !== 'ERROR_STATE';
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
