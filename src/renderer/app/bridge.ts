import type { AuraFlowApi } from '../../shared/api';
import { createMockBridge } from './mock';

/**
 * The typed bridge to the main process. In the browser preview (`npm run dev:web`) there is
 * no preload script, so a clearly-labelled in-memory stand-in is used instead.
 */
function resolveBridge(): AuraFlowApi {
  if (window.auraflow) return window.auraflow;
  if (import.meta.env.DEV) return createMockBridge();
  throw new Error('AuraFlow bridge is unavailable. The preload script did not load.');
}

export const bridge: AuraFlowApi = resolveBridge();
