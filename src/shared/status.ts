import type { DictationPhase } from './types';

/** Single source of truth for the status wording shown in the tray menu and tooltip. */
export function statusLineFor(phase: DictationPhase): string {
  switch (phase) {
    case 'recording':
      return 'Status: Listening...';
    case 'transcribing':
      return 'Status: Transcribing...';
    case 'refining':
      return 'Status: Polishing...';
    case 'pasting':
      return 'Status: Pasting...';
    case 'error':
      return 'Status: Attention needed';
    case 'idle':
    case 'done':
    default:
      return 'Status: Ready';
  }
}
