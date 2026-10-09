import { concatFloat32, TARGET_SAMPLE_RATE } from '../../shared/wav';

export interface CaptureResult {
  samples: Float32Array;
  sampleRate: number;
  peak: number;
}

/** Human-friendly explanation for microphone failures. */
export function describeMicError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Microphone access is blocked. Allow AuraFlow to use the microphone in your system privacy settings.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No microphone was found. Connect one or choose another in Settings.';
      case 'NotReadableError':
      case 'AbortError':
        return 'The microphone is busy in another app. Close that app and try again.';
      default:
        break;
    }
  }
  return error instanceof Error && error.message ? error.message : 'The microphone could not start.';
}

async function openMicrophone(deviceId: string): Promise<MediaStream> {
  const base: MediaTrackConstraints = {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } }, video: false });
    } catch (error) {
      // The chosen device was unplugged: fall back to the default instead of failing outright.
      if (!(error instanceof DOMException) || error.name !== 'OverconstrainedError') throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base, video: false });
}

function createContext(): AudioContext {
  try {
    // Ask for 16 kHz so no resampling is needed before upload when the platform allows it.
    return new AudioContext({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

/**
 * Captures microphone audio: an AudioWorklet collects PCM frames, an AnalyserNode drives
 * the live visualiser, and the samples are returned on stop() for WAV encoding.
 */
export class Recorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private silencer: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private peak = 0;
  private frequency = new Uint8Array(0);

  /** Fired when the microphone disappears mid-recording (unplugged, permission revoked). */
  onTrackEnded: (() => void) | null = null;

  get isActive(): boolean {
    return this.context !== null;
  }

  get durationSeconds(): number {
    return this.context ? this.sampleCount / this.context.sampleRate : 0;
  }

  async start(deviceId: string): Promise<void> {
    if (this.context) throw new Error('Recorder is already running.');
    const stream = await openMicrophone(deviceId);
    try {
      const context = createContext();
      if (context.state !== 'running') {
        // resume() can stall under autoplay restrictions, so never wait on it indefinitely.
        await Promise.race([
          context.resume().catch(() => undefined),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
        ]);
      }
      if (context.state !== 'running') {
        await context.close().catch(() => undefined);
        throw new Error('The audio engine could not start. Try the hotkey again.');
      }
      await context.audioWorklet.addModule(new URL('pcm-worklet.js', document.baseURI).href);

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;

      const worklet = new AudioWorkletNode(context, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => this.ingest(event.data);

      // The worklet must reach the destination to be scheduled; a silent gain node keeps it quiet.
      const silencer = context.createGain();
      silencer.gain.value = 0;

      source.connect(analyser);
      source.connect(worklet);
      worklet.connect(silencer).connect(context.destination);

      stream.getAudioTracks().forEach((track) => {
        track.addEventListener('ended', () => this.onTrackEnded?.());
      });

      this.context = context;
      this.stream = stream;
      this.source = source;
      this.analyser = analyser;
      this.worklet = worklet;
      this.silencer = silencer;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  private ingest(chunk: Float32Array): void {
    this.chunks.push(chunk);
    this.sampleCount += chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      const value = Math.abs(chunk[i]);
      if (value > this.peak) this.peak = value;
    }
  }

  /** Fills `out` with normalised, log-spaced speech-band levels in [0, 1]. */
  readLevels(out: Float32Array): void {
    out.fill(0);
    if (!this.analyser) return;
    if (this.frequency.length !== this.analyser.frequencyBinCount) {
      this.frequency = new Uint8Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getByteFrequencyData(this.frequency);
    const low = 1;
    const high = Math.max(low + 1, Math.floor(this.frequency.length * 0.75));
    const count = out.length;
    for (let i = 0; i < count; i++) {
      const start = Math.floor(low * Math.pow(high / low, i / count));
      const end = Math.max(start + 1, Math.floor(low * Math.pow(high / low, (i + 1) / count)));
      let sum = 0;
      let bins = 0;
      for (let bin = start; bin < end && bin <= high; bin++) {
        sum += this.frequency[bin];
        bins++;
      }
      const average = bins > 0 ? sum / bins / 255 : 0;
      out[i] = Math.min(1, Math.pow(average, 1.1) * 1.4);
    }
  }

  stop(): CaptureResult {
    const result: CaptureResult = {
      samples: concatFloat32(this.chunks, this.sampleCount),
      sampleRate: this.context?.sampleRate ?? TARGET_SAMPLE_RATE,
      peak: this.peak,
    };
    this.teardown();
    return result;
  }

  cancel(): void {
    this.teardown();
  }

  private teardown(): void {
    if (this.worklet) this.worklet.port.onmessage = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.worklet?.disconnect();
    this.silencer?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.worklet = null;
    this.silencer = null;
    this.chunks = [];
    this.sampleCount = 0;
    this.peak = 0;
  }
}

/** Lists audio inputs. Labels are only populated after the user has granted microphone access. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}
