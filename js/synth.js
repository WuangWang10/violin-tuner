/* ============================================================
 * synth.js — 小提琴近似合成音色（在线采样加载失败/离线时的回退）
 * 基音 + 泛音 + 揉弦(LFO) + 包络，Web Audio 实现，无外部资源。
 * ============================================================ */
(function (global) {
  'use strict';

  /**
   * 在指定音频时间播放一个近似小提琴音色。
   * @param {AudioContext} ctx
   * @param {number} midi MIDI 音高
   * @param {number} when 开始时间（ctx.currentTime 相对）
   * @param {number} dur 时长（秒）
   * @param {number} vol 音量 0~1
   */
  function violinTone(ctx, midi, when, dur, vol) {
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    if (freq <= 0) return;

    var master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, when);
    master.gain.exponentialRampToValueAtTime(vol, when + 0.05);
    master.gain.setValueAtTime(vol, Math.max(when + dur - 0.15, when + 0.06));
    master.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    master.connect(ctx.destination);

    // 揉弦 LFO
    var lfo = ctx.createOscillator();
    var lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 5.6;
    lfoGain.gain.value = freq * 0.005;
    lfo.connect(lfoGain);

    // 谐波叠加（小提琴音色：偶数/奇数泛音混合 + 明亮高频）
    var partials = [
      { ratio: 1, amp: 1.0 },
      { ratio: 2, amp: 0.42 },
      { ratio: 3, amp: 0.30 },
      { ratio: 4, amp: 0.16 },
      { ratio: 5, amp: 0.10 },
      { ratio: 6, amp: 0.05 }
    ];
    partials.forEach(function (p) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * p.ratio;
      if (p.ratio === 1) lfoGain.connect(osc.frequency); // 揉弦作用于基音
      g.gain.value = p.amp;
      osc.connect(g);
      g.connect(master);
      osc.start(when);
      osc.stop(when + dur + 0.1);
    });
    lfo.start(when);
    lfo.stop(when + dur + 0.1);
  }

  global.Synth = { violinTone: violinTone };
})(typeof self !== 'undefined' ? self : this);
