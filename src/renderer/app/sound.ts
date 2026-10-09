/** Short synthesized cues so the user hears when recording starts and stops. */
export function playCue(kind: 'start' | 'stop'): Promise<void> {
  return new Promise((resolve) => {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    let context: AudioContext;
    try {
      context = new AudioCtor();
    } catch {
      resolve();
      return;
    }
    const start = context.currentTime;
    const [from, to] = kind === 'start' ? [620, 980] : [980, 520];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + 0.09);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
    window.setTimeout(() => {
      void context.close();
      resolve();
    }, 170);
  });
}
