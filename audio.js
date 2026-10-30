// 30-second preview player with a level meter for the background.
// If the CDN blocks CORS (no analyser possible), it falls back to a
// synthetic beat so the visuals still breathe with playback.

export class Preview {
  constructor() {
    this.audio = null; this.ctx = null; this.analyser = null; this.data = null;
    this.synthetic = false; this.onstate = () => {};
  }

  get playing() { return !!this.audio && !this.audio.paused; }

  async load(src) {
    this.stop();
    this.synthetic = false;
    this.audio = await this.#make(src, true).catch(() => null);
    if (!this.audio) { this.synthetic = true; this.audio = await this.#make(src, false); }
    this.audio.addEventListener('ended', () => this.onstate('ended'));
    this.audio.addEventListener('pause', () => this.onstate('paused'));
    this.audio.addEventListener('play', () => this.onstate('playing'));
    this.audio.addEventListener('timeupdate', () => this.onstate('time'));
  }

  #make(src, cors) {
    return new Promise((resolve, reject) => {
      const a = new Audio();
      if (cors) a.crossOrigin = 'anonymous';
      a.preload = 'auto';
      a.src = src;
      a.addEventListener('canplay', () => resolve(a), { once: true });
      a.addEventListener('error', () => reject(new Error('audio failed')), { once: true });
      a.load();
    });
  }

  async toggle() {
    if (!this.audio) return;
    if (this.playing) { this.audio.pause(); return; }
    if (!this.synthetic && !this.analyser) this.#wire();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    await this.audio.play();
  }

  #wire() {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const srcNode = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.7;
      srcNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
    } catch { this.synthetic = true; }
  }

  progress() { return this.audio && this.audio.duration ? this.audio.currentTime / this.audio.duration : 0; }

  /** {level, bass} in 0..1 for the shader */
  levels = () => {
    if (!this.playing) return null;
    if (this.synthetic || !this.analyser) {
      const t = this.audio.currentTime;
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)), 8);
      return { level: 0.35 + 0.25 * Math.sin(t * 1.3) ** 2, bass: beat };
    }
    this.analyser.getByteFrequencyData(this.data);
    let bass = 0, all = 0;
    for (let i = 0; i < this.data.length; i++) { all += this.data[i]; if (i < 8) bass += this.data[i]; }
    return { level: all / this.data.length / 255, bass: Math.pow(bass / 8 / 255, 2) };
  };

  stop() {
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
    this.audio = null; this.analyser = null; this.data = null;
  }
}
