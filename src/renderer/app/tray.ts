import '../styles/fonts.css';
import '../styles/base.css';
import '../styles/tray.css';
import type { TrayAction, TrayData } from '../../shared/types';
import { bridge } from './bridge';
import { $, $$, svgFrom } from './dom';
import { daggerMarkup } from './logo';

$('.brand-mark').append(svgFrom(daggerMarkup()));

function render(data: TrayData): void {
  $('#trayStatus').textContent = data.status;
  $('#trayHotkey').textContent = data.hotkeyLabel;
  const dot = $('#trayDot');
  dot.className = data.phase === 'error'
    ? 'status-dot is-warn'
    : data.phase === 'recording'
      ? 'status-dot is-ok'
      : 'status-dot is-ok';
}

function activate(action: TrayAction): void {
  void bridge.trayAction(action);
}

const items = $$<HTMLButtonElement>('.tray-item');

for (const item of items) {
  item.addEventListener('click', () => activate(item.dataset.action as TrayAction));
}

// Keyboard: arrow keys move between items, Escape dismisses the menu.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    void bridge.hideTrayMenu();
    return;
  }
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    const wrapped = (next + items.length) % items.length;
    items[wrapped === index ? 0 : wrapped].focus();
  }
});

bridge.onTrayData(render);
items[0].focus();
