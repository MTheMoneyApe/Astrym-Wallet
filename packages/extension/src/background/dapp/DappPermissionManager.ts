export interface DappPermission {
  origin: string;
  connectedAt: number;
}

export class DappPermissionManager {
  private static STORAGE_KEY = 'dapp_permissions';

  /**
   * Retrieves all permissions from storage.
   */
  async getAllPermissions(): Promise<DappPermission[]> {
    const data = await chrome.storage.local.get(DappPermissionManager.STORAGE_KEY);
    const stored = data[DappPermissionManager.STORAGE_KEY];
    return Array.isArray(stored) ? (stored as DappPermission[]) : [];
  }

  /**
   * Checks if an origin is already trusted (connected).
   */
  async isTrusted(origin: string): Promise<boolean> {
    const perms = await this.getAllPermissions();
    return perms.some(p => p.origin === origin);
  }

  /**
   * Grants permission to an origin and persists it.
   */
  async grantPermission(origin: string): Promise<void> {
    const perms = await this.getAllPermissions();
    if (!perms.some(p => p.origin === origin)) {
      perms.push({ origin, connectedAt: Date.now() });
      await chrome.storage.local.set({ [DappPermissionManager.STORAGE_KEY]: perms });
    }
  }

  /**
   * Revokes permission for an origin.
   */
  async revokePermission(origin: string): Promise<void> {
    const perms = await this.getAllPermissions();
    const updated = perms.filter(p => p.origin !== origin);
    await chrome.storage.local.set({ [DappPermissionManager.STORAGE_KEY]: updated });
  }
}

