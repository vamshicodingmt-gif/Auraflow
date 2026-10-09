export type WaveMode = 'live' | 'busy' | 'idle';

function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.rect(x, y, width, height);
  }
}

/** Canvas bar visualiser: reacts to live levels, shimmers while busy, rests when idle. */
export class WaveformRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly displayed: Float32Array;
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement, readonly bars = 26) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.ctx = ctx;
    this.displayed = new Float32Array(bars);
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  draw(levels: Float32Array, mode: WaveMode, time: number): void {
    const { ctx, width, height } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const gap = 3;
    const barWidth = (width - gap * (this.bars - 1)) / this.bars;
    const mid = height / 2;

    for (let i = 0; i < this.bars; i++) {
      let target: number;
      if (mode === 'live') target = levels[i] ?? 0;
      else if (mode === 'busy') target = 0.22 + 0.16 * Math.sin(time * 0.007 + i * 0.55);
      else target = 0.06;

      const current = this.displayed[i];
      const easing = target > current ? 0.6 : 0.16;
      this.displayed[i] = current + (target - current) * easing;

      const barHeight = Math.max(2, this.displayed[i] * (height - 4));
      const x = i * (barWidth + gap);
      const y = mid - barHeight / 2;

      const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
      if (mode === 'live') {
        gradient.addColorStop(0, '#ff3b3b');
        gradient.addColorStop(0.5, '#e50914');
        gradient.addColorStop(1, '#8b0000');
      } else {
        gradient.addColorStop(0, '#9a9a9a');
        gradient.addColorStop(1, '#3d3d3d');
      }
      ctx.fillStyle = gradient;
      ctx.shadowColor = mode === 'live' ? 'rgba(229, 9, 20, 0.7)' : 'transparent';
      ctx.shadowBlur = mode === 'live' ? 9 : 0;
      roundedBar(ctx, x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}
