/** Audio helpers: concatenation, resampling, peak detection and 16-bit PCM WAV encoding. */

export const TARGET_SAMPLE_RATE = 16_000;

export function concatFloat32(chunks: readonly Float32Array[], totalLength?: number): Float32Array {
  const length = totalLength ?? chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const slice = chunk.subarray(0, Math.min(chunk.length, length - offset));
    out.set(slice, offset);
    offset += slice.length;
  }
  return offset === length ? out : out.subarray(0, offset);
}

export function peakAbs(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return Math.min(1, peak);
}

/** Linear-interpolation resampler. Good enough for speech before ASR. */
export function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate || input.length === 0) return input;
  const ratio = inRate / outRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = input[Math.min(index, input.length - 1)];
    const b = input[Math.min(index + 1, input.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Encodes mono 16-bit PCM samples as a RIFF/WAVE file. */
export function encodeWav16(samples: Int16Array, sampleRate: number, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }
  return new Uint8Array(buffer);
}

/** Converts captured float audio at any rate into the 16 kHz mono WAV the API expects. */
export function captureToWav(samples: Float32Array, sampleRate: number): { wav: Uint8Array; durationMs: number; peak: number } {
  const resampled = resampleLinear(samples, sampleRate, TARGET_SAMPLE_RATE);
  const pcm = floatTo16BitPcm(resampled);
  return {
    wav: encodeWav16(pcm, TARGET_SAMPLE_RATE),
    durationMs: Math.round((resampled.length / TARGET_SAMPLE_RATE) * 1000),
    peak: peakAbs(resampled),
  };
}

/** Reads back the header of a WAV produced by encodeWav16 (used by tests and diagnostics). */
export function readWavHeader(bytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataBytes: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  return {
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}
