/**
 * In-process wallet host for the Android PWA / browser webapp.
 * Must run after installAndroidChromeShim and before the popup UI.
 */

import { NymHostPermissionService } from '../background/nym/NymHostPermissionService.js';
import {
  NymRuntimeController,
  resetNymRuntimeControllerForTests,
} from '../background/nym/NymRuntimeController.js';
import { InPageMixFetchBridge } from './inPageMixFetchBridge.js';

let booted: Promise<void> | null = null;

export function bootStandaloneWallet(): Promise<void> {
  if (booted) return booted;
  booted = (async () => {
    resetNymRuntimeControllerForTests(
      new NymRuntimeController({
        bridge: new InPageMixFetchBridge(),
        hostPermissions: new NymHostPermissionService(null),
        allowConnectWithoutHostPermission: true,
      }),
    );
    await import('../background/index.js');
  })();
  return booted;
}
