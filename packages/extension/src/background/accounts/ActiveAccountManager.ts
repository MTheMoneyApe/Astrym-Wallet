import browser from 'webextension-polyfill';

export interface IAccountService {
  getAccounts(): Promise<Array<{ index: number; address: string; label: string }>>;
}

export class ActiveAccountManager {
  private _activeAccountIndex: number | undefined;
  private _isInitialized = false;

  public async initialize(): Promise<void> {
    const data = await browser.storage.local.get('solanym_active_index');
    if (typeof data['solanym_active_index'] === 'number') {
      this._activeAccountIndex = data['solanym_active_index'];
    } else {
      this._activeAccountIndex = undefined;
    }
    this._isInitialized = true;
  }

  public getActiveAccountIndex(): number {
    if (!this._isInitialized) {
      throw new Error('ActiveAccountManager not initialized');
    }
    if (this._activeAccountIndex === undefined) {
      throw new Error('Active account index is missing or corrupted. Cannot perform sensitive operations.');
    }
    return this._activeAccountIndex;
  }

  public async getActiveAccountPublicKey(accountService: IAccountService): Promise<string> {
    const index = this.getActiveAccountIndex();
    
    // Check against real existing accounts to ensure identity is valid
    const accounts = await accountService.getAccounts();
    const activeAccount = accounts.find(a => a.index === index);
    
    if (!activeAccount) {
      throw new Error(`Trusted active account index ${index} not found in wallet metadata`);
    }

    return activeAccount.address;
  }

  public async setActiveAccountIndex(index: number, accountService: IAccountService): Promise<void> {
    if (!this._isInitialized) {
      throw new Error('ActiveAccountManager not initialized');
    }

    const accounts = await accountService.getAccounts();
    const activeAccount = accounts.find(a => a.index === index);
    
    if (!activeAccount) {
      throw new Error(`Cannot set active index: ${index} not found in wallet metadata`);
    }
    
    await browser.storage.local.set({ solanym_active_index: index });
    this._activeAccountIndex = index;
  }
}

export const activeAccountManager = new ActiveAccountManager();

