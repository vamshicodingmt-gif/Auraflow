/* AudioWorklet: forwards mono Float32 microphone frames to the page. Runs on the audio thread. */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const frames = input[0].length;
      const mono = new Float32Array(frames);
      const channels = input.length;
      for (let c = 0; c < channels; c++) {
        const data = input[c];
        for (let i = 0; i < frames; i++) mono[i] += data[i] / channels;
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
