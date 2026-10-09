/**
 * IPC channel names. Request/response channels use ipcRenderer.invoke + ipcMain.handle.
 * Event channels (evt:*) are pushed from the main process with webContents.send.
 */
export const IPC = {
  appInfo: 'app:info',
  appQuit: 'app:quit',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  apiKeySave: 'apikey:save',
  apiKeyClear: 'apikey:clear',
  apiKeyTest: 'apikey:test',

  historyList: 'history:list',
  historyDelete: 'history:delete',
  historyClear: 'history:clear',

  clipboardCopy: 'clipboard:copy',

  dictationGet: 'dictation:get',
  dictationToggle: 'dictation:toggle',
  dictationCancel: 'dictation:cancel',

  windowOpen: 'window:open',

  updatesCheck: 'updates:check',

  permissionsGet: 'permissions:get',
  permissionsOpen: 'permissions:open',
  microphoneRequest: 'microphone:request',

  trayAction: 'tray:action',
  trayHide: 'tray:hide',

  recordingStarted: 'recording:started',
  recordingFailed: 'recording:failed',
  recordingSubmit: 'recording:submit',

  evtDictation: 'evt:dictation',
  evtPillCommand: 'evt:pill-command',
  evtPillStream: 'evt:pill-stream',
  evtSettings: 'evt:settings',
  evtHistory: 'evt:history',
  evtTray: 'evt:tray',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
