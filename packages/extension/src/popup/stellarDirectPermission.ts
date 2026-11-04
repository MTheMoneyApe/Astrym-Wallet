export const STELLAR_DIRECT_HOST_PERMISSION_ORIGINS = [
  'https://horizon-testnet.stellar.org/*',
  'https://friendbot.stellar.org/*',
] as const;

const DIRECT_PERMISSION_ERROR =
  'Direct mode requires Chrome permissions for Stellar Testnet Horizon and Friendbot. Grant both permissions and retry.';

export type StellarDirectPermissionApi = {
  request: (permissions: { origins: string[] }) => Promise<boolean>;
  contains: (permissions: { origins: string[] }) => Promise<boolean>;
};

function getChromePermissionApi(): StellarDirectPermissionApi | null {
  if (
    typeof chrome === 'undefined' ||
    !chrome?.permissions ||
    typeof chrome.permissions.request !== 'function' ||
    typeof chrome.permissions.contains !== 'function'
  ) {
    return null;
  }

  const request = (permissions: { origins: string[] }) =>
    new Promise<boolean>((resolve, reject) => {
      try {
        chrome.permissions.request(permissions, (granted) => {
          const error = chrome.runtime?.lastError;
          if (error) reject(new Error(error.message));
          else resolve(Boolean(granted));
        });
      } catch (error) {
        reject(error);
      }
    });
  const contains = (permissions: { origins: string[] }) =>
    new Promise<boolean>((resolve, reject) => {
      try {
        chrome.permissions.contains(permissions, (granted) => {
          const error = chrome.runtime?.lastError;
          if (error) reject(new Error(error.message));
          else resolve(Boolean(granted));
        });
      } catch (error) {
        reject(error);
      }
    });

  return { request, contains };
}

/**
 * Start both optional-origin requests synchronously from the Direct-choice click handler.
 * The returned promise only resolves after Chrome confirms both origins.
 */
export function beginStellarDirectPermissionRequestFromUserGesture(
  api: StellarDirectPermissionApi | null = getChromePermissionApi(),
): Promise<void> {
  if (!api) {
    throw new Error(DIRECT_PERMISSION_ERROR);
  }

  const origins = [...STELLAR_DIRECT_HOST_PERMISSION_ORIGINS];
  let requestPromise: Promise<boolean>;
  try {
    requestPromise = api.request({ origins });
  } catch {
    throw new Error(DIRECT_PERMISSION_ERROR);
  }

  return confirmStellarDirectPermissions(api, origins, requestPromise);
}

async function confirmStellarDirectPermissions(
  api: StellarDirectPermissionApi,
  origins: string[],
  requestPromise: Promise<boolean>,
): Promise<void> {
  let requestGranted: boolean;
  try {
    requestGranted = await requestPromise;
  } catch {
    throw new Error(DIRECT_PERMISSION_ERROR);
  }

  let permissionsConfirmed: boolean;
  try {
    permissionsConfirmed = await api.contains({ origins });
  } catch {
    throw new Error(DIRECT_PERMISSION_ERROR);
  }

  if (!requestGranted || !permissionsConfirmed) {
    throw new Error(DIRECT_PERMISSION_ERROR);
  }
}
