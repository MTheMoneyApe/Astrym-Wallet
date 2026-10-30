/**
 * Route a Horizon.Server's HTTP client through an injected fetch.
 *
 * @stellar/stellar-sdk 17 uses global fetch inside its default adapter.
 * Replacing `httpClient.defaults.adapter` keeps account loads, fee quotes,
 * submits, and confirmation polls on the same transport as StellarReadClient
 * (fail-closed MixFetch when Nym mode is active, clearnet when mode is direct).
 */

import type { Horizon } from '@stellar/stellar-sdk';
import type { StellarReadFetch } from '../read/StellarReadClient.js';

type HeaderSource = Headers | Record<string, string> | Array<[string, string]>;

type HorizonRequestConfig = {
  url?: string;
  method?: string;
  baseURL?: string;
  data?: unknown;
  headers?: HeaderSource;
  params?: Record<string, unknown>;
};

type HorizonHttpClient = {
  defaults: {
    headers?: HeaderSource;
    adapter?: (config: HorizonRequestConfig) => Promise<{
      data: unknown;
      headers: Headers;
      config: HorizonRequestConfig;
      status: number;
      statusText: string;
    }>;
  };
};

function appendHeaders(target: Headers, source: HeaderSource | undefined): void {
  if (!source) return;
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      target.set(key, value);
    });
    return;
  }
  if (Array.isArray(source)) {
    for (const pair of source) {
      const name = pair[0];
      const value = pair[1];
      if (name !== undefined && value !== undefined) target.set(name, value);
    }
    return;
  }
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') target.set(key, value);
  }
}

export function resolveHorizonRequestUrl(config: HorizonRequestConfig): string {
  let url = config.url ?? '';
  if (config.baseURL && url && !/^https?:\/\//i.test(url)) {
    url = `${config.baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  }
  const params = config.params;
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      qs.append(key, String(value));
    }
    const extra = qs.toString();
    if (extra) url += (url.includes('?') ? '&' : '?') + extra;
  }
  return url;
}

/**
 * Install a fetch adapter on an existing Horizon server.
 * Does nothing when `fetchImpl` is omitted (caller keeps the SDK default).
 */
export function routeHorizonServerThroughFetch(
  server: Horizon.Server,
  fetchImpl: StellarReadFetch,
): void {
  const client = (server as unknown as { httpClient: HorizonHttpClient }).httpClient;
  client.defaults.adapter = async (config) => {
    const url = resolveHorizonRequestUrl(config);
    const headers = new Headers();
    appendHeaders(headers, client.defaults.headers);
    appendHeaders(headers, config.headers);
    const method = (config.method ?? 'GET').toUpperCase();
    const init: RequestInit = { method, headers };
    if (config.data != null && method !== 'GET' && method !== 'HEAD') {
      init.body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
      if (!headers.has('content-type') && typeof config.data === 'string') {
        headers.set('content-type', 'application/x-www-form-urlencoded');
      }
    }
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const error = new Error(`Request failed with status code ${response.status}`);
      Object.assign(error, {
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data,
          config,
        },
      });
      throw error;
    }
    return {
      data,
      headers: response.headers,
      config,
      status: response.status,
      statusText: response.statusText,
    };
  };
}
