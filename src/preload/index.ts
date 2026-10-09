/**
 * Preload bridge: exposes a narrow, typed `window.auraflow` API to renderer pages.
 * Runs in Electron's sandbox, so it may only import 'electron' at runtime.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc';
import type { AuraFlowApi } from '../shared/api';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: AuraFlowApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  quitApp: () => ipcRenderer.invoke(IPC.appQuit),

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),

  saveApiKey: (key) => ipcRenderer.invoke(IPC.apiKeySave, key),
  clearApiKey: () => ipcRenderer.invoke(IPC.apiKeyClear),
  testApiKey: () => ipcRenderer.invoke(IPC.apiKeyTest),

  listHistory: () => ipcRenderer.invoke(IPC.historyList),
  deleteHistoryEntry: (id) => ipcRenderer.invoke(IPC.historyDelete, id),
  clearHistory: () => ipcRenderer.invoke(IPC.historyClear),
  copyText: (text) => ipcRenderer.invoke(IPC.clipboardCopy, text),

  getDictation: () => ipcRenderer.invoke(IPC.dictationGet),
  toggleDictation: () => ipcRenderer.invoke(IPC.dictationToggle),
  cancelDictation: () => ipcRenderer.invoke(IPC.dictationCancel),

  openWindow: (view) => ipcRenderer.invoke(IPC.windowOpen, view),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updatesCheck),

  getPermissions: () => ipcRenderer.invoke(IPC.permissionsGet),
  openPermissionSettings: (which) => ipcRenderer.invoke(IPC.permissionsOpen, which),
  requestMicrophone: () => ipcRenderer.invoke(IPC.microphoneRequest),

  trayAction: (action) => ipcRenderer.invoke(IPC.trayAction, action),
  hideTrayMenu: () => ipcRenderer.invoke(IPC.trayHide),

  notifyRecordingStarted: () => ipcRenderer.invoke(IPC.recordingStarted),
  notifyRecordingFailed: (message) => ipcRenderer.invoke(IPC.recordingFailed, message),
  submitRecording: (payload) => ipcRenderer.invoke(IPC.recordingSubmit, payload),

  onDictationState: (callback) => subscribe(IPC.evtDictation, callback),
  onPillCommand: (callback) => subscribe(IPC.evtPillCommand, callback),
  onPillStream: (callback) => subscribe(IPC.evtPillStream, callback),
  onSettingsChanged: (callback) => subscribe(IPC.evtSettings, callback),
  onHistoryChanged: (callback) => subscribe<void>(IPC.evtHistory, () => callback()),
  onTrayData: (callback) => subscribe(IPC.evtTray, callback),
};

contextBridge.exposeInMainWorld('auraflow', api);
