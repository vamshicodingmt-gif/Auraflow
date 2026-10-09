import { describe, expect, it } from 'vitest';
import { captureToWav, concatFloat32, encodeWav16, floatTo16BitPcm, peakAbs, readWavHeader, resampleLinear } from '../src/shared/wav';

describe('WAV encoding', () => {
  it('writes a valid 16 kHz mono 16-bit header and matching data length', () => {
    const samples = new Int16Array([0, 1000, -1000, 32767]);
    const wav = encodeWav16(samples, 16_000);
    expect(wav.byteLength).toBe(44 + samples.length * 2);
    const header = readWavHeader(wav);
    expect(header).toEqual({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, dataBytes: 8 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(44 + 2, true)).toBe(1000);
    expect(view.getInt16(44 + 4, true)).toBe(-1000);
  });

  it('clamps float samples to the 16-bit range', () => {
    expect(Array.from(floatTo16BitPcm(new Float32Array([2, -2, 0])))).toEqual([32767, -32768, 0]);
  });

  it('rejects non-WAV bytes', () => {
    expect(() => readWavHeader(new Uint8Array(44))).toThrow(/WAVE/);
  });
});

describe('audio helpers', () => {
  it('resamples 48 kHz to 16 kHz with a third of the samples', () => {
    const input = new Float32Array(4800).fill(0.25);
    const out = resampleLinear(input, 48_000, 16_000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBeCloseTo(0.25);
  });

  it('measures peak and concatenates chunks in order', () => {
    expect(peakAbs(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7);
    const joined = concatFloat32([new Float32Array([1, 2]), new Float32Array([3])]);
    expect(Array.from(joined)).toEqual([1, 2, 3]);
  });

  it('turns captured audio into a WAV with the right duration', () => {
    const { wav, durationMs, peak } = captureToWav(new Float32Array(48_000).fill(0.5), 48_000);
    expect(durationMs).toBe(1000);
    expect(peak).toBeCloseTo(0.5);
    expect(readWavHeader(wav).sampleRate).toBe(16_000);
  });
});
