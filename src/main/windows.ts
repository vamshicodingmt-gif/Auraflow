import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';
import { IPC } from '../shared/ipc';
import type { PillPlacement, TrayData, WindowView } from '../shared/types';

export const PILL_WIDTH = 384;
export const PILL_HEIGHT = 96;
export const TRAY_MENU_WIDTH = 276;
export const TRAY_MENU_HEIGHT = 300;

export interface WindowManagerOptions {
  /** Vite dev server origin (e.g. http://localhost:5173) when running `npm run dev`, else null. */
  devServerUrl: string | null;
  rendererOrigin: string;
  preloadPath: string;
  iconPath: string;
}

type Page = 'pill' | 'index' | 'settings' | 'tray';

export class WindowManager {
  private pillWindow: BrowserWindow | null = null;
  private dashboardWindow: BrowserWindow | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private trayWindow: BrowserWindow | null = null;
  private quitting = false;

  constructor(private readonly options: WindowManagerOptions) {}

  markQuitting(): void {
    this.quitting = true;
  }

  // ---------------------------------------------------------------- creation

  private pageUrl(page: Page): string {
    const file = `${page}.html`;
    return this.options.devServerUrl ? `${this.options.devServerUrl}/${file}` : `${this.options.rendererOrigin}/${file}`;
  }

  private create(page: Page, options: BrowserWindowConstructorOptions): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      backgroundColor: '#0A0A0A',
      icon: this.options.iconPath,
      autoHideMenuBar: true,
      ...options,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        // Dictation starts from a global hotkey, not a click, so audio engines must be allowed to run.
        autoplayPolicy: 'no-user-gesture-required',
        ...options.webPreferences,
      },
    });

    // Renderers are single-page apps: never let them navigate away.
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.loadURL(this.pageUrl(page)).catch((error: unknown) => {
      console.error(`Failed to load ${page} window`, error);
    });
    return win;
  }

  private ensurePill(): BrowserWindow {
    if (this.pillWindow && !this.pillWindow.isDestroyed()) return this.pillWindow;
    const win = this.create('pill', {
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      webPreferences: { backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    win.on('close', (event) => {
      if (!this.quitting) event.preventDefault();
    });
    this.pillWindow = win;
    return win;
  }

  private ensureDashboard(): BrowserWindow {
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) return this.dashboardWindow;
    const win = this.create('index', {
      width: 1080,
      height: 740,
      minWidth: 900,
      minHeight: 640,
      title: 'AuraFlow',
    });
    win.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    this.dashboardWindow = win;
    return win;
  }

  private ensureSettings(): BrowserWindow {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) return this.settingsWindow;
    const win = this.create('settings', {
      width: 520,
      height: 820,
      minWidth: 480,
      minHeight: 640,
      title: 'AuraFlow Settings',
    });
    win.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    this.settingsWindow = win;
    return win;
  }

  private ensureTrayMenu(): BrowserWindow {
    if (this.trayWindow && !this.trayWindow.isDestroyed()) return this.trayWindow;
    const win = this.create('tray', {
      width: TRAY_MENU_WIDTH,
      height: TRAY_MENU_HEIGHT,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      thickFrame: false,
    });
    win.on('blur', () => {
      if (!win.isDestroyed()) win.hide();
    });
    win.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    this.trayWindow = win;
    return win;
  }

  /** Creates the hidden windows that must be ready before the first hotkey press or tray click. */
  preload(): void {
    this.ensurePill();
    this.ensureDashboard();
    this.ensureTrayMenu();
  }

  // ---------------------------------------------------------------- pill

  showPill(placement: PillPlacement): void {
    const win = this.ensurePill();
    win.setBounds(this.pillBounds(placement));
    win.showInactive();
  }

  hidePill(): void {
    if (this.pillWindow && !this.pillWindow.isDestroyed()) this.pillWindow.hide();
  }

  sendToPill(channel: string, payload?: unknown): void {
    const win = this.pillWindow;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  private pillBounds(placement: PillPlacement): Rectangle {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const area = display.workArea;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    if (placement === 'cursor') {
      const x = clamp(cursor.x - PILL_WIDTH / 2, area.x + 8, area.x + area.width - PILL_WIDTH - 8);
      const y = clamp(cursor.y - PILL_HEIGHT - 28, area.y + 8, area.y + area.height - PILL_HEIGHT - 8);
      return { x: Math.round(x), y: Math.round(y), width: PILL_WIDTH, height: PILL_HEIGHT };
    }
    return {
      x: Math.round(area.x + (area.width - PILL_WIDTH) / 2),
      y: Math.round(area.y + area.height - PILL_HEIGHT - 32),
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
    };
  }

  // ---------------------------------------------------------------- dashboard / settings

  showView(view: WindowView): void {
    const win = view === 'dashboard' ? this.ensureDashboard() : this.ensureSettings();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  // ---------------------------------------------------------------- tray popup

  showTrayMenu(anchor: Rectangle, data: TrayData): void {
    const win = this.ensureTrayMenu();
    const { x: left, y: top, width, height } = anchor;
    const display = screen.getDisplayNearestPoint({ x: left + width / 2, y: top + height / 2 });
    const area = display.workArea;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    const x = clamp(Math.round(left + width / 2 - TRAY_MENU_WIDTH / 2), area.x + 8, area.x + area.width - TRAY_MENU_WIDTH - 8);
    // Menu bar (macOS, top) opens downward; taskbar (Windows, bottom) opens upward.
    const menuBarAtTop = process.platform === 'darwin' || top < area.y + area.height / 2;
    const rawY = menuBarAtTop ? top + height + 6 : top - TRAY_MENU_HEIGHT - 6;
    const y = clamp(Math.round(rawY), area.y + 4, area.y + area.height - TRAY_MENU_HEIGHT - 4);

    win.setBounds({ x: Math.round(x), y, width: TRAY_MENU_WIDTH, height: TRAY_MENU_HEIGHT });
    win.webContents.send(IPC.evtTray, data);
    win.show();
    win.focus();
  }

  hideTrayMenu(): void {
    if (this.trayWindow && !this.trayWindow.isDestroyed()) this.trayWindow.hide();
  }

  // ---------------------------------------------------------------- broadcast

  broadcast(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  dashboardVisible(): boolean {
    return Boolean(this.dashboardWindow && !this.dashboardWindow.isDestroyed() && this.dashboardWindow.isVisible());
  }
}
