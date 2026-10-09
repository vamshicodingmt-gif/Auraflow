import { Menu, nativeImage, Tray, type NativeImage, type Rectangle } from 'electron';
import { statusLineFor } from '../shared/status';
import type { DictationPhase, DictationSnapshot, TrayAction } from '../shared/types';

export const APP_TOOLTIP = 'AuraFlow · Goth Edition';
const FRAME_INTERVAL_MS = 110;
const FRAME_COUNT = 6;

export interface TrayOptions {
  /** Absolute path to a file in assets/tray/. */
  assetPath(fileName: string): string;
  onLeftClick(): void;
  onRightClick(anchor: Rectangle): void;
  onNativeAction(action: TrayAction): void;
}

function loadImage(path: string): NativeImage {
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) console.warn(`Tray asset missing or unreadable: ${path}`);
  return image;
}

export class TrayController {
  private readonly tray: Tray;
  private readonly isMac = process.platform === 'darwin';
  private readonly isLinux = process.platform === 'linux';
  private readonly idleImage: NativeImage;
  private readonly recordingFrames: NativeImage[];
  private animation: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private status = 'Status: Ready';
  private phase: DictationPhase = 'idle';

  constructor(private readonly options: TrayOptions) {
    if (this.isMac) {
      // Monochrome template so macOS can tint it for light/dark menu bars.
      this.idleImage = loadImage(options.assetPath('tray_icon.png'));
      this.idleImage.setTemplateImage(true);
      this.recordingFrames = Array.from({ length: FRAME_COUNT }, (_, k) => loadImage(options.assetPath(`tray_recording_${k}.png`)));
    } else {
      this.idleImage = loadImage(options.assetPath('tray_color.png'));
      this.recordingFrames = Array.from({ length: FRAME_COUNT }, (_, k) => loadImage(options.assetPath(`tray_recording_win_${k}.png`)));
    }

    this.tray = new Tray(this.idleImage);
    this.tray.setToolTip(APP_TOOLTIP);

    if (this.isLinux) {
      // Linux desktops rarely emit right-click events for AppIndicator, so use a native menu.
      this.rebuildNativeMenu();
    } else {
      this.tray.on('click', () => options.onLeftClick());
      this.tray.on('right-click', (_event, bounds) => options.onRightClick(bounds));
      this.tray.on('double-click', () => options.onLeftClick());
    }
  }

  /** Mirrors dictation progress into the menu bar / system tray. */
  setStatus(snapshot: DictationSnapshot): void {
    this.phase = snapshot.phase;
    this.status = statusLineFor(snapshot.phase);
    this.tray.setToolTip(`${APP_TOOLTIP}\n${this.status.replace('Status: ', '')}`);
    if (this.phase === 'recording') {
      this.startPulse();
    } else {
      this.stopPulse();
    }
    if (this.isLinux) this.rebuildNativeMenu();
  }

  currentStatus(): string {
    return this.status;
  }

  destroy(): void {
    this.stopPulse();
    this.tray.destroy();
  }

  private startPulse(): void {
    if (this.animation) return;
    this.frameIndex = 0;
    this.tray.setImage(this.recordingFrames[0]);
    this.animation = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.recordingFrames.length;
      this.tray.setImage(this.recordingFrames[this.frameIndex]);
    }, FRAME_INTERVAL_MS);
  }

  private stopPulse(): void {
    if (this.animation) {
      clearInterval(this.animation);
      this.animation = null;
    }
    this.tray.setImage(this.idleImage);
  }

  private rebuildNativeMenu(): void {
    const menu = Menu.buildFromTemplate([
      { label: this.status, enabled: false },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => this.options.onNativeAction('open-dashboard') },
      { label: 'Settings', click: () => this.options.onNativeAction('open-settings') },
      { label: 'Check for Updates', click: () => this.options.onNativeAction('check-updates') },
      { type: 'separator' },
      { label: 'Quit Flow (Goth Edition)', click: () => this.options.onNativeAction('quit') },
    ]);
    this.tray.setContextMenu(menu);
  }
}
