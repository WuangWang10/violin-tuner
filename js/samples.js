/* ============================================================
 * samples.js — 在线小提琴采样音色（MIDI.js Soundfonts 的 Violin）
 *  - 加载真实弦乐采样，解码后按音频时间线调度播放
 *  - 采样加载失败或超出采样范围的音 → 自动回退 Synth 合成音色
 * ============================================================ */
(function (global) {
  'use strict';

  var SF_URL = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/violin-mp3.js';
  var STATUS = { IDLE: 'idle', LOADING: 'loading', READY: 'ready', FAILED: 'failed' };

  var ctx = null;
  var status = STATUS.IDLE;
  var noteMap = null;   // midi -> dataURI
  var buffers = {};     // midi -> AudioBuffer

  function ensureCtx() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) throw new Error('no-webaudio');
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function getStatus() { return status; }

  /* ---------- 解析 soundfont 文件 ---------- */
  function parseSoundfont(text) {
    var m = text.match(/MIDI\.Soundfont\.violin\s*=\s*(\{[\s\S]*?\});/);
    if (!m) throw new Error('soundfont 解析失败');
    return JSON.parse(m[1]);
  }

  function nameToMidi(name) {
    var letter = name.charAt(0);
    var acc = name.charAt(1);
    var hasAcc = acc === '#' || acc === 'b';
    var oct = parseInt(name.slice(hasAcc ? 2 : 1), 10);
    var pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
    if (pc === undefined) return -1;
    if (acc === '#') pc += 1;
    if (acc === 'b') pc -= 1;
    return (oct + 1) * 12 + pc;
  }

  /* ---------- 加载采样库 ---------- */
  function load() {
    if (status === STATUS.READY) return Promise.resolve(true);
    if (status === STATUS.LOADING) return Promise.resolve(false); // 已在加载
    status = STATUS.LOADING;
    return Promise.resolve().then(function () {
      return fetch(SF_URL);
    }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var raw = parseSoundfont(text);
        noteMap = {};
        for (var name in raw) {
          var midi = nameToMidi(name);
          if (midi >= 0) noteMap[midi] = raw[name];
        }
        status = STATUS.READY;
        return true;
      })
      .catch(function (e) {
        console.warn('采样加载失败，回退合成音色:', e.message);
        status = STATUS.FAILED;
        return false;
      });
  }

  /* ---------- 解码并缓存单个音 ---------- */
  function getBuffer(midi) {
    if (buffers[midi]) return Promise.resolve(buffers[midi]);
    if (!noteMap || !noteMap[midi]) return Promise.resolve(null);
    var uri = noteMap[midi];
    return fetch(uri)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return ensureCtx().decodeAudioData(ab); })
      .then(function (buf) { buffers[midi] = buf; return buf; })
      .catch(function () { return null; });
  }

  /* ---------- 播放单个音（按音频时间线调度） ---------- */
  function playNote(midi, when, dur, vol) {
    vol = vol || 0.5;
    var c;
    try { c = ensureCtx(); } catch (e) { return; }

    if (!noteMap || !noteMap[midi]) {
      // 无采样（未加载或超出范围）→ 合成音色
      if (global.Synth) global.Synth.violinTone(c, midi, when, dur, vol);
      return;
    }
    getBuffer(midi).then(function (buf) {
      if (!buf) {
        if (global.Synth) global.Synth.violinTone(c, midi, when, dur, vol);
        return;
      }
      var src = c.createBufferSource();
      src.buffer = buf;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + 0.015);
      g.gain.setValueAtTime(vol, Math.max(when + dur - 0.12, when + 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      src.connect(g);
      g.connect(c.destination);
      src.start(when);
      src.stop(when + dur + 0.1);
    });
  }

  /* ---------- 播放一串音（含节奏） ---------- */
  /**
   * @param {Array<{midi:number, dur:number}>} seq
   * @param {number} startOffset 从 now 起延迟（秒）
   * @param {number} gap 音与音之间的间隔（秒）
   * @param {number} vol
   */
  function playSequence(seq, startOffset, gap, vol) {
    var c;
    try { c = ensureCtx(); } catch (e) { return; }
    var t = c.currentTime + (startOffset || 0.08);
    seq.forEach(function (n) {
      playNote(n.midi, t, Math.max(n.dur, 0.25), vol);
      t += n.dur + (gap || 0);
    });
  }

  global.Samples = {
    load: load,
    getStatus: getStatus,
    playNote: playNote,
    playSequence: playSequence,
    ensureCtx: ensureCtx,
    SF_URL: SF_URL
  };
})(typeof self !== 'undefined' ? self : this);
