// Web Audio API로 합성한 효과음 (별도 음원 파일 없이 동작)
(function () {
  const STORAGE_KEY = "soundEnabled";
  let ctx = null;

  function isEnabled() {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  }

  function setEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  }

  function getContext() {
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      ctx = new AudioContextClass();
    }
    return ctx;
  }

  // 브라우저 autoplay 정책상 사용자 제스처 이후에만 재생이 허용되므로,
  // 첫 클릭/터치/키입력 때 한 번 unlock 시도.
  function unlock() {
    const audioCtx = getContext();
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  }
  ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, unlock, { passive: true });
  });

  function playTone(audioCtx, { freq, duration, type = "sine", volume = 0.2, delay = 0, freqEnd = null }) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    const startTime = audioCtx.currentTime + delay;
    const endTime = startTime + duration;

    osc.frequency.setValueAtTime(freq, startTime);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), endTime);
    }

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, endTime);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(endTime + 0.02);
  }

  function play(specs) {
    if (!isEnabled()) return;
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    specs.forEach((spec) => playTone(audioCtx, spec));
  }

  function playCardSound() {
    play([{ freq: 660, freqEnd: 880, duration: 0.12, type: "triangle", volume: 0.15 }]);
  }

  function playAttackSound() {
    play([
      { freq: 180, freqEnd: 60, duration: 0.18, type: "sawtooth", volume: 0.22 },
      { freq: 90, duration: 0.1, type: "square", volume: 0.12, delay: 0.02 },
    ]);
  }

  function playTurnEndSound() {
    play([
      { freq: 440, duration: 0.1, type: "sine", volume: 0.15 },
      { freq: 550, duration: 0.12, type: "sine", volume: 0.15, delay: 0.1 },
    ]);
  }

  function playVictorySound() {
    play([
      { freq: 523, duration: 0.14, type: "triangle", volume: 0.18, delay: 0 },
      { freq: 659, duration: 0.14, type: "triangle", volume: 0.18, delay: 0.13 },
      { freq: 784, duration: 0.22, type: "triangle", volume: 0.18, delay: 0.26 },
    ]);
  }

  function playDefeatSound() {
    play([
      { freq: 392, freqEnd: 260, duration: 0.3, type: "sawtooth", volume: 0.16, delay: 0 },
      { freq: 330, freqEnd: 220, duration: 0.35, type: "sawtooth", volume: 0.14, delay: 0.15 },
    ]);
  }

  window.GameSound = {
    playCardSound,
    playAttackSound,
    playTurnEndSound,
    playVictorySound,
    playDefeatSound,
    isEnabled,
    setEnabled,
  };
})();
