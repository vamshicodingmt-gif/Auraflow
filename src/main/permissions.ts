import { shell, systemPreferences } from 'electron';
import type { MicrophoneStatus, PermissionStatus } from '../shared/types';

export function readPermissions(): PermissionStatus {
  const platform = process.platform;
  let microphone: MicrophoneStatus = 'unknown';
  if (platform === 'darwin' || platform === 'win32') {
    microphone = systemPreferences.getMediaAccessStatus('microphone');
  }
  let accessibility: PermissionStatus['accessibility'] = 'not-applicable';
  if (platform === 'darwin') {
    accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'missing';
  }
  return { platform, microphone, accessibility };
}

export async function openPermissionSettings(which: 'microphone' | 'accessibility'): Promise<void> {
  if (process.platform === 'darwin') {
    const anchor = which === 'microphone' ? 'Privacy_Microphone' : 'Privacy_Accessibility';
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
    return;
  }
  if (process.platform === 'win32' && which === 'microphone') {
    await shell.openExternal('ms-settings:privacy-microphone');
  }
}

export async function requestMicrophoneAccess(): Promise<boolean> {
  if (process.platform === 'darwin') {
    return systemPreferences.askForMediaAccess('microphone');
  }
  return readPermissions().microphone !== 'denied';
}
