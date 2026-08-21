/* ============================================================
 * pitch.js — 音高检测引擎（YIN 算法 + 半音换算工具）
 *
 * 纯函数、无副作用，供 app.js 调用。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 音名与频率换算 ---------- */
  var A4 = 440;
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var SEMITONE = 1.0594630943592953; // 2^(1/12)

  /** 频率 → MIDI 编号（A4 = 69） */
  function midiFromFreq(freq) {
    return 69 + 12 * Math.log2(freq / A4);
  }

  /** MIDI 编号 → 频率 */
  function freqFromMidi(midi) {
    return A4 * Math.pow(SEMITONE, midi - 69);
  }

  /** MIDI 编号 → 音名（如 A4、C#5） */
  function noteNameFromMidi(midi) {
    var n = NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12];
    var octave = Math.floor(Math.round(midi) / 12) - 1;
    return n + octave;
  }

  /** 音名字母部分（不含八度，如 "A"） */
  function noteLetter(midi) {
    return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12];
  }

  /** 八度数字 */
  function noteOctave(midi) {
    return Math.floor(Math.round(midi) / 12) - 1;
  }

  /** 频率相对某 MIDI 音的音分偏差 */
  function centsFromFreq(freq, midi) {
    return 1200 * Math.log2(freq / freqFromMidi(midi));
  }

  /** 两个频率之间的音分差 */
  function centsBetween(f1, f2) {
    return 1200 * Math.log2(f1 / f2);
  }

  /**
   * YIN 音高检测。
   * @param {Float32Array} buf 时域采样数据
   * @param {number} sampleRate 采样率
   * @param {number} [threshold=0.15] CMND 阈值，越小越严格
   * @returns {{frequency:number, clarity:number}|null}
   *          clarity 接近 1 表示信号周期性强（越像乐音），接近 0 表示噪声
   */
  function detectYin(buf, sampleRate, threshold) {
    threshold = threshold || 0.15;
    var n = buf.length;
    var minFreq = 55;              // 最低检测频率（小提琴 G3=196Hz，留余量）
    var maxFreq = 5000;            // 最高检测频率（小提琴高把位约 4kHz+）
    var maxLag = Math.min(n - 2, Math.floor(sampleRate / minFreq));
    var minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
    if (maxLag <= minLag) return null;

    // 1) 差分函数 d(tau) = sum (x[i] - x[i+tau])^2
    var d = new Float64Array(maxLag + 1);
    var limit = n - maxLag - 1;
    for (var tau = 1; tau <= maxLag; tau++) {
      var sum = 0;
      for (var i = 0; i < limit; i++) {
        var diff = buf[i] - buf[i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }

    // 2) 累计均值归一化差分 CMND(tau) = d(tau) * tau / sum(d(1..tau))
    var cmnd = new Float64Array(maxLag + 1);
    cmnd[0] = 1;
    var running = 0;
    for (var tau2 = 1; tau2 <= maxLag; tau2++) {
      running += d[tau2];
      cmnd[tau2] = running > 0 ? (d[tau2] * tau2) / running : 1;
    }

    // 3) 寻找第一个低于阈值的谷点（找不到则取全局最小）
    var tauEst = -1;
    var t = minLag;
    while (t <= maxLag) {
      if (cmnd[t] < threshold) {
        // 沿下降方向走到局部极小值
        while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
        tauEst = t;
        break;
      }
      t++;
    }
    if (tauEst === -1) {
      var minVal = Infinity;
      for (var tt = minLag; tt <= maxLag; tt++) {
        if (cmnd[tt] < minVal) { minVal = cmnd[tt]; tauEst = tt; }
      }
    }
    if (tauEst <= 0) return null;

    // 4) 抛物线插值细化周期
    var x0 = cmnd[tauEst - 1];
    var x1 = cmnd[tauEst];
    var x2 = (tauEst + 1 <= maxLag) ? cmnd[tauEst + 1] : x1;
    var denom = x0 - 2 * x1 + x2;
    var betterTau = tauEst;
    if (Math.abs(denom) > 1e-9) {
      var shift = (x0 - x2) / (2 * denom);
      if (shift > -1 && shift < 1) betterTau = tauEst + shift;
    }

    var frequency = sampleRate / betterTau;
    if (!(frequency >= minFreq && frequency <= maxFreq)) return null;

    var clarity = 1 - x1; // 1 - 归一化差分：1=完美周期，0=完全噪声
    if (clarity < 0.1) return null;

    return { frequency: frequency, clarity: clarity };
  }

  /* ---------- 导出 ---------- */
  global.Pitch = {
    A4: A4,
    midiFromFreq: midiFromFreq,
    freqFromMidi: freqFromMidi,
    noteNameFromMidi: noteNameFromMidi,
    noteLetter: noteLetter,
    noteOctave: noteOctave,
    centsFromFreq: centsFromFreq,
    centsBetween: centsBetween,
    detectYin: detectYin
  };
})(typeof self !== 'undefined' ? self : this);
