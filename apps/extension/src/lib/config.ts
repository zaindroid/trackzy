const DEFAULT_BACKEND_URL = 'https://fulfillment-tracker.zainey4-26a.workers.dev';
const STORAGE_KEY = 'fulfillmentTrackerConfig';

export interface ExtensionConfig {
  backendUrl: string;
  bearerToken: string | null;
}

export async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<ExtensionConfig> | undefined;
  return {
    backendUrl: stored?.backendUrl ?? DEFAULT_BACKEND_URL,
    bearerToken: stored?.bearerToken ?? null,
  };
}

export async function setConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}
