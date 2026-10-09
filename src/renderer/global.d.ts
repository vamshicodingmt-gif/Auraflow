import type { AuraFlowApi } from '../shared/api';

declare global {
  interface Window {
    /** Injected by the preload script in Electron; absent in the browser preview. */
    auraflow?: AuraFlowApi;
  }
}

export {};
