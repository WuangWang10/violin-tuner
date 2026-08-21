/* ============================================================
 * app.js — 小提琴音准训练器：麦克风采集、音高检测、指针表、
 *          一把位指法图、目标音、参考音、练习统计
 * ============================================================ */
(function () {
  'use strict';

  var P = window.Pitch;
  if (!P) throw new Error('pitch.js 未加载');

  /* ================= 数据 ================= */

  // 四根弦的空弦（MIDI）
  var STRINGS = {
    G: { midi: 55, name: 'G3', label: 'G弦' },
    D: { midi: 62, name: 'D4', label: 'D弦' },
    A: { midi: 69, name: 'A4', label: 'A弦' },
    E: { midi: 76, name: 'E5', label: 'E弦' }
  };

  // 一把位指法图：每弦 空弦/1指/2指/3指/4指 的 MIDI
  var CHART = [
    { str: 'G', fingers: [55, 57, 59, 60, 62] }, // G3 A3 B3 C4 D4
    { str: 'D', fingers: [62, 64, 66, 67, 69] }, // D4 E4 F#4 G4 A4
    { str: 'A', fingers: [69, 71, 73, 74, 76] }, // A4 B4 C#5 D5 E5
    { str: 'E', fingers: [76, 78, 80, 81, 83] }  // E5 F#5 G#5 A5 B5
  ];
  var FINGER_LABELS = ['空弦', '1指', '2指', '3指', '4指'];

  // MIDI → 指法位置（用于显示“检测到 X 弦 N 指”）
  var POS_BY_MIDI = {};
  CHART.forEach(function (row) {
    row.fingers.forEach(function (m, i) {
      if (!POS_BY_MIDI[m]) POS_BY_MIDI[m] = { str: row.str, finger: i };
    });
  });

  var IN_TUNE_CENTS = 5;      // 指针绿色区
  var SCORE_CENTS = 10;       // 统计计为“音准”的阈值
  var SILENCE_MS = 450;       // 无声多久后重置显示
  var NOISE_RMS = 0.0035;     // 响度阈值（2048 采样帧）
  var LOCK_CLARITY = 0.5;
  var LOCK_RMS = 0.006;

  /* ================= DOM ================= */

  function $(id) { return document.getElementById(id); }

  var statusCard = $('statusCard'),
    statusLed = $('statusLed'),
    statusText = $('statusText'),
    noteDisplay = $('noteDisplay') || document.querySelector('.note-display'),
    noteLetterEl = $('noteLetter'),
    noteOctaveEl = $('noteOctave'),
    posInfoEl = $('posInfo'),
    meterEl = $('meter'),
    meterCtx = meterEl.getContext('2d'),
    centsReadoutEl = document.querySelector('.cents-readout'),
    centsValueEl = $('centsValue'),
    centsDirEl = $('centsDir'),
    startBtn = $('startBtn'),
    stopBtn = $('stopBtn'),
    stringRow = $('stringRow'),
    targetNoteEl = $('targetNote'),
    refBtn = $('refBtn'),
    flashEl = $('flash'),
    chartEl = $('chart'),
    statTotalEl = $('statTotal'),
    statInTuneEl = $('statInTune'),
    statRateEl = $('statRate'),
    statStreakEl = $('statStreak'),
    resetStatsBtn = $('resetStatsBtn'),
    fbSvg = $('fbSvg');

  // 指板可视化元素（由 buildFingerboard 创建）
  var fbTargetG = null,
    fbDetectG = null,
    fbTargetFinger = null,
    fbDetectFinger = null;

  /* ================= 指板几何（SVG viewBox 0 0 340 500） ================= */

  var FB = {
    x0: 62,
    x1: 278,
    yNut: 40,
    yEnd: 470,
    strings: ['G', 'D', 'A', 'E'],
    // 弦列 x 坐标
    xOf: function (s) {
      return FB.x0 + (FB.strings.indexOf(s) + 0.5) * (FB.x1 - FB.x0) / FB.strings.length;
    },
    // 手指位置的 y 坐标（按半音数按物理弦长比例放置）
    yOfFinger: function (f) {
      var semitones = [0, 2, 4, 5, 7][f];
      var frac = 1 - Math.pow(2, -semitones / 12); // 实际琴弦位置比例
      var usable = FB.yEnd - FB.yNut - 28;
      return FB.yNut + 14 + frac * usable;
    }
  };

  /* ================= 状态 ================= */

  var audioCtx = null,
    analyser = null,
    sourceNode = null,
    stream = null,
    timeBuf = null,
    sampleRate = 48000,
    running = false,
    rafId = null;

  var targetMidi = 55,           // 当前目标音（默认 G3）
    currentString = 'G',
    smoothFreq = 0,
    lastGoodTime = 0;

  // 统计事件状态机
  var eventNote = null,
    pendingNote = null,
    pendingCount = 0,
    eventInTune = false;

  var stats = { total: 0, inTune: 0, streak: 0 };

  var refOsc = null,
    refGain = null,
    refTimer = null;

  var detectCell = null,
    detectCellKey = null,
    chartCells = new Map(),
    flashTimer = null;

  var currentDetected = null; // { midi, inTune } 当前稳定检测到的音

  /* ================= 工具 ================= */

  function ensureAudioCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('no-webaudio');
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function setStatus(mode, text) {
    statusCard.classList.remove('on', 'busy', 'err');
    if (mode) statusCard.classList.add(mode);
    statusText.textContent = text;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ================= 指针表绘制 ================= */

  function resizeMeter() {
    var dpr = window.devicePixelRatio || 1;
    meterEl.width = Math.max(1, Math.round(meterEl.clientWidth * dpr));
    meterEl.height = Math.max(1, Math.round(meterEl.clientHeight * dpr));
    drawMeter(null);
  }

  function drawMeter(cents, opts) {
    opts = opts || {};
    var w = meterEl.clientWidth || 600;
    var h = meterEl.clientHeight || 150;
    var ctx = meterCtx;
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var padL = 36, padR = 36;
    var barW = w - padL - padR;
    var barY = h * 0.56;
    var barH = 9;
    var xOf = function (c) { return padL + barW / 2 + (c / 50) * (barW / 2); };
    var idle = cents === null || cents === undefined;

    ctx.globalAlpha = idle ? 0.4 : 1;

    // 底槽
    ctx.fillStyle = '#0d1420';
    roundRect(ctx, padL, barY, barW, barH, barH / 2);
    ctx.fill();

    // 绿色音准区 ±5¢
    var gx0 = xOf(-IN_TUNE_CENTS), gx1 = xOf(IN_TUNE_CENTS);
    ctx.fillStyle = 'rgba(61,220,132,0.85)';
    roundRect(ctx, gx0, barY, Math.max(2, gx1 - gx0), barH, barH / 2);
    ctx.fill();

    // 刻度
    ctx.strokeStyle = 'rgba(147,161,184,0.5)';
    ctx.fillStyle = 'rgba(147,161,184,0.85)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (var c = -50; c <= 50; c += 5) {
      var x = xOf(c);
      var major = c % 10 === 0;
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, barY - (major ? 11 : 5));
      ctx.lineTo(x, barY - 2);
      ctx.stroke();
      if (major) ctx.fillText(String(c), x, barY - 13);
    }

    // 指针
    var nx = idle ? xOf(0) : Math.max(padL, Math.min(w - padR, xOf(cents)));
    var needleColor = idle ? 'rgba(147,161,184,0.6)'
      : Math.abs(cents) <= IN_TUNE_CENTS ? '#3ddc84'
        : cents > 0 ? '#ff6b6b' : '#6db3ff';
    ctx.fillStyle = needleColor;
    ctx.beginPath();
    ctx.moveTo(nx, barY - 15);
    ctx.lineTo(nx - 7, barY + barH + 11);
    ctx.lineTo(nx + 7, barY + barH + 11);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(nx, barY - 15, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  /* ================= 指法图构建 ================= */

  function buildChart() {
    // 表头行：空弦/1指/2指/3指/4指
    var headerRow = document.createElement('div');
    headerRow.className = 'chart-header';
    FINGER_LABELS.forEach(function (label) {
      var h = document.createElement('span');
      h.textContent = label;
      headerRow.appendChild(h);
    });
    chartEl.appendChild(headerRow);

    CHART.forEach(function (row) {
      row.fingers.forEach(function (midi, i) {
        var cell = document.createElement('div');
        cell.className = 'chart-cell';
        cell.dataset.str = row.str;
        cell.dataset.finger = i;
        cell.dataset.midi = String(midi);
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '0');
        cell.setAttribute('aria-label', STRINGS[row.str].label + ' ' + FINGER_LABELS[i] + ' ' + P.noteNameFromMidi(midi));

        var note = document.createElement('div');
        note.className = 'note';
        var name = P.noteNameFromMidi(midi);
        note.innerHTML = name.replace(/(\d+)$/, '<span class="oct">$1</span>');

        var finger = document.createElement('span');
        finger.className = 'finger';
        finger.textContent = String(i);

        cell.appendChild(finger);
        cell.appendChild(note);
        chartEl.appendChild(cell);
        chartCells.set(String(midi), cell);
      });
    });

    chartEl.addEventListener('click', function (e) {
      var cell = e.target.closest('.chart-cell');
      if (!cell || !cell.dataset.midi) return;
      setTarget(parseInt(cell.dataset.midi, 10), cell.dataset.str);
    });
    chartEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var cell = e.target.closest('.chart-cell');
      if (!cell || !cell.dataset.midi) return;
      e.preventDefault();
      setTarget(parseInt(cell.dataset.midi, 10), cell.dataset.str);
    });
  }

  /* ================= 指法可视化（指板 SVG） ================= */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // 某个 MIDI 音在指板上的坐标（超出把位的音会被夹到指板末端并标 ↑）
  function fbPos(midi) {
    var pos = POS_BY_MIDI[midi];
    var str;
    if (pos) {
      str = pos.str;
    } else {
      // 高把位音：归到空弦音高低于它的最近一根弦
      var best = null;
      FB.strings.forEach(function (s) {
        var diff = midi - STRINGS[s].midi;
        if (diff >= 0 && (best === null || diff < best.diff)) best = { str: s, diff: diff };
      });
      str = best ? best.str : 'G';
    }
    return {
      x: FB.xOf(str),
      y: pos ? FB.yOfFinger(pos.finger) : FB.yEnd - 10,
      finger: pos ? pos.finger : -1,
      inRange: !!pos
    };
  }

  function buildFingerboard() {
    var svg = fbSvg;
    svg.innerHTML = '';

    // 指板背景（深色木纹）
    svg.appendChild(svgEl('rect', {
      x: FB.x0 - 18, y: FB.yNut - 16,
      width: (FB.x1 - FB.x0) + 36, height: (FB.yEnd - FB.yNut) + 26,
      rx: 10, fill: '#241a10', stroke: '#3a2c1a', 'stroke-width': 1.5
    }));

    // 指位参考横线（微弱）
    for (var f = 0; f < 5; f++) {
      var yy = FB.yOfFinger(f);
      svg.appendChild(svgEl('line', {
        x1: FB.x0 - 10, y1: yy, x2: FB.x1 + 10, y2: yy,
        stroke: 'rgba(255,255,255,0.07)', 'stroke-width': 1
      }));
    }

    // 琴弦（粗细与颜色模拟真实弦）
    var strStyle = {
      G: ['#5a4632', 6], D: ['#7a5c38', 5],
      A: ['#b0a08a', 3.5], E: ['#d8d8d8', 2]
    };
    FB.strings.forEach(function (s) {
      var st = strStyle[s];
      svg.appendChild(svgEl('line', {
        x1: FB.xOf(s), y1: FB.yNut - 14, x2: FB.xOf(s), y2: FB.yEnd + 8,
        stroke: st[0], 'stroke-width': st[1], 'stroke-linecap': 'round'
      }));
    });

    // 琴枕
    svg.appendChild(svgEl('rect', {
      x: FB.x0 - 24, y: FB.yNut - 6,
      width: (FB.x1 - FB.x0) + 48, height: 8, rx: 3, fill: '#4a3820'
    }));

    // 一把位音名标记（文本 + 透明点击区）
    CHART.forEach(function (row) {
      row.fingers.forEach(function (midi, i) {
        var g = svgEl('g', { class: 'fb-pos', 'data-midi': midi, 'data-str': row.str });
        g.appendChild(svgEl('circle', { class: 'fb-hitarea', cx: 0, cy: 0, r: 17 }));
        var t = svgEl('text', { class: 'fb-note', x: 0, y: 0, dy: '0.35em' });
        t.textContent = P.noteNameFromMidi(midi);
        g.appendChild(t);
        g.setAttribute('transform', 'translate(' + FB.xOf(row.str) + ',' + FB.yOfFinger(i) + ')');
        svg.appendChild(g);
      });
    });

    // 目标指法：金色脉动圆环 + 手指徽标
    fbTargetG = svgEl('g', { class: 'fb-target', visibility: 'hidden' });
    fbTargetG.appendChild(svgEl('circle', { class: 'fb-ring', cx: 0, cy: 0, r: 17 }));
    fbTargetG.appendChild(svgEl('circle', { class: 'fb-badge', cx: 12, cy: -12, r: 8.5 }));
    fbTargetFinger = svgEl('text', { class: 'fb-finger', x: 12, y: -12, dy: '0.35em' });
    fbTargetG.appendChild(fbTargetFinger);
    svg.appendChild(fbTargetG);

    // 当前音的指法：绿色光点 + 手指徽标
    fbDetectG = svgEl('g', { class: 'fb-detect', visibility: 'hidden' });
    fbDetectG.appendChild(svgEl('circle', { class: 'fb-dot', cx: 0, cy: 0, r: 13 }));
    fbDetectG.appendChild(svgEl('circle', { class: 'fb-badge', cx: 11, cy: -11, r: 8 }));
    fbDetectFinger = svgEl('text', { class: 'fb-finger', x: 11, y: -11, dy: '0.35em' });
    fbDetectG.appendChild(fbDetectFinger);
    svg.appendChild(fbDetectG);

    // 标签：琴枕 / 弦名
    var nutLbl = svgEl('text', { class: 'fb-strlabel', x: (FB.x0 + FB.x1) / 2, y: FB.yNut - 24, dy: '0.35em' });
    nutLbl.textContent = '琴枕';
    svg.appendChild(nutLbl);
    FB.strings.forEach(function (s) {
      var lbl = svgEl('text', { class: 'fb-strlabel', x: FB.xOf(s), y: FB.yEnd + 26, dy: '0.35em' });
      lbl.textContent = s + '弦';
      svg.appendChild(lbl);
    });

    // 点击指板上的音 → 设为目标音
    svg.addEventListener('click', function (e) {
      var g = e.target.closest('.fb-pos');
      if (!g || !g.dataset.midi) return;
      setTarget(parseInt(g.dataset.midi, 10), g.dataset.str);
    });
  }

  function updateFingerboard() {
    if (!fbTargetG) return;

    // 目标指法（目标音永远在一把位内）
    var t = fbPos(targetMidi);
    fbTargetG.setAttribute('visibility', 'visible');
    fbTargetG.setAttribute('transform', 'translate(' + t.x + ',' + t.y + ')');
    fbTargetFinger.textContent = String(t.finger);
    var hit = currentDetected && currentDetected.midi === targetMidi && currentDetected.inTune;
    fbTargetG.classList.toggle('fb-hit', !!hit);

    // 当前音的指法（与目标重合时隐藏绿点，由金圈变绿表示拉准）
    if (currentDetected && currentDetected.midi !== targetMidi) {
      var d = fbPos(currentDetected.midi);
      fbDetectG.setAttribute('visibility', 'visible');
      fbDetectG.setAttribute('transform', 'translate(' + d.x + ',' + d.y + ')');
      fbDetectFinger.textContent = d.inRange ? String(d.finger) : '↑';
    } else {
      fbDetectG.setAttribute('visibility', 'hidden');
    }
  }

  /* ================= 目标音 ================= */

  function setTarget(midi, str) {
    targetMidi = midi;
    currentString = str;
    targetNoteEl.textContent = P.noteNameFromMidi(midi);

    Array.prototype.forEach.call(stringRow.querySelectorAll('.string-btn'), function (b) {
      b.classList.toggle('active', b.dataset.string === str);
    });

    chartCells.forEach(function (cell, key) {
      cell.classList.toggle('is-target', key === String(midi));
      cell.classList.toggle('row-current', cell.dataset.str === str);
    });

    // 参考音进行中则实时改频
    if (refOsc && audioCtx) {
      refOsc.frequency.setTargetAtTime(P.freqFromMidi(midi), audioCtx.currentTime, 0.02);
    }
    updateFingerboard();
    saveSettings();
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem('violin-tuner-settings');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && STRINGS[s.str]) {
          targetMidi = s.targetMidi;
          currentString = s.str;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem('violin-tuner-settings', JSON.stringify({
        targetMidi: targetMidi,
        str: currentString
      }));
    } catch (e) { /* ignore */ }
  }

  /* ================= 麦克风启停 ================= */

  function start() {
    setStatus('busy', '正在请求麦克风权限…');
    startBtn.disabled = true;
    var ctx;
    try {
      ctx = ensureAudioCtx();
    } catch (e) {
      startBtn.disabled = false;
      setStatus('err', '此浏览器不支持 Web Audio API');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      startBtn.disabled = false;
      setStatus('err', '此环境不支持麦克风采集（需 HTTPS 或 localhost）');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (s) {
      stream = s;
      sourceNode = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      sourceNode.connect(analyser);
      timeBuf = new Float32Array(analyser.fftSize);
      sampleRate = ctx.sampleRate;
      running = true;

      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      resetTunerState();
      setStatus('on', '聆听中…（请拉奏小提琴）');
      loop();

      // 权限被系统收回时提示
      var track = stream.getAudioTracks()[0];
      if (track) {
        track.addEventListener('ended', function () {
          if (running) {
            stop();
            setStatus('err', '麦克风已断开，请重新开始');
          }
        });
      }
    }).catch(function (err) {
      console.error(err);
      startBtn.disabled = false;
      var msg = '无法访问麦克风（' + (err.name || err.message || '未知错误') + '）';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = '麦克风权限被拒绝：请在浏览器地址栏/设置中允许麦克风后重试';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = '未找到麦克风设备，请检查麦克风连接';
      } else if (err.name === 'NotReadableError') {
        msg = '麦克风正被其他应用占用，请关闭后重试';
      }
      setStatus('err', msg);
    });
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} sourceNode = null; }
    analyser = null;
    stopRef();
    stopBtn.classList.add('hidden');
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    setStatus('idle', '已停止 · 点击「开始调音」重新开始');
    resetTunerState();
    drawMeter(null);
  }

  function resetTunerState() {
    smoothFreq = 0;
    lastGoodTime = 0;
    eventNote = null;
    pendingNote = null;
    pendingCount = 0;
    eventInTune = false;
    detectCellKey = null;
    if (detectCell) { detectCell.classList.remove('is-detect'); detectCell = null; }
    idleUI();
  }

  /* ================= 检测主循环 ================= */

  function loop() {
    if (!running || !analyser) return;
    rafId = requestAnimationFrame(loop);

    analyser.getFloatTimeDomainData(timeBuf);

    // 响度
    var sum = 0;
    for (var i = 0; i < timeBuf.length; i++) sum += timeBuf[i] * timeBuf[i];
    var rms = Math.sqrt(sum / timeBuf.length);

    var det = P.detectYin(timeBuf, sampleRate);
    var now = performance.now();

    if (!det || rms < NOISE_RMS) {
      if (now - lastGoodTime > SILENCE_MS) {
        // 无声：结算事件，重置显示
        if (eventNote !== null && !eventInTune) { stats.streak = 0; updateStatsUI(); }
        eventNote = null;
        pendingNote = null;
        pendingCount = 0;
        smoothFreq = 0;
        idleUI();
      }
      return;
    }

    lastGoodTime = now;
    var clarity = det.clarity;

    // 频率平滑（EMA）
    if (smoothFreq <= 0) smoothFreq = det.frequency;
    var alpha = clarity > 0.8 ? 0.45 : 0.2;
    smoothFreq += alpha * (det.frequency - smoothFreq);

    var note = Math.round(P.midiFromFreq(smoothFreq));
    var displayCents = P.centsFromFreq(smoothFreq, targetMidi); // 相对目标音
    var locked = clarity >= LOCK_CLARITY && rms >= LOCK_RMS;

    updateNoteUI(note, displayCents, locked);
    updateStatsEvent(note, displayCents, clarity);
    drawMeter(displayCents, { locked: locked });
  }

  /* ================= UI 更新 ================= */

  function idleUI() {
    noteLetterEl.textContent = '—';
    noteOctaveEl.textContent = '';
    posInfoEl.textContent = '等待输入声音…';
    noteDisplay.classList.remove('locked');
    centsValueEl.textContent = '0';
    centsDirEl.textContent = '';
    centsReadoutEl.classList.remove('cents-flat', 'cents-sharp', 'cents-ok');
    if (detectCell) { detectCell.classList.remove('is-detect'); detectCell = null; }
    detectCellKey = null;
    currentDetected = null;
    updateFingerboard();
    drawMeter(null);
  }

  function updateNoteUI(note, displayCents, locked) {
    noteLetterEl.textContent = P.noteLetter(note);
    noteOctaveEl.textContent = String(P.noteOctave(note));
    noteDisplay.classList.toggle('locked', locked);

    var pos = POS_BY_MIDI[note];
    posInfoEl.innerHTML = pos
      ? '检测到 <b>' + P.noteNameFromMidi(note) + '</b> · ' + STRINGS[pos.str].label + ' ' + FINGER_LABELS[pos.finger]
      : '检测到 <b>' + P.noteNameFromMidi(note) + '</b>';

    // 指法图高亮
    var key = String(note);
    if (detectCellKey !== key) {
      if (detectCell) detectCell.classList.remove('is-detect');
      detectCell = chartCells.get(key) || null;
      if (detectCell) detectCell.classList.add('is-detect');
      detectCellKey = key;
    }

    // 指法可视化：记录当前音并更新指板
    currentDetected = { midi: note, inTune: Math.abs(displayCents) <= IN_TUNE_CENTS };
    updateFingerboard();

    // 音分读数
    var c = Math.round(displayCents);
    centsValueEl.textContent = (c > 0 ? '+' : '') + c;
    centsReadoutEl.classList.remove('cents-flat', 'cents-sharp', 'cents-ok');
    if (Math.abs(displayCents) <= IN_TUNE_CENTS) {
      centsReadoutEl.classList.add('cents-ok');
      centsDirEl.textContent = '音准';
    } else if (displayCents > 0) {
      centsReadoutEl.classList.add('cents-sharp');
      centsDirEl.textContent = '偏高';
    } else {
      centsReadoutEl.classList.add('cents-flat');
      centsDirEl.textContent = '偏低';
    }

    setStatus('on', '聆听中 · ' + P.noteNameFromMidi(note));
  }

  /* ================= 练习统计 ================= */

  function updateStatsEvent(note, displayCents, clarity) {
    if (clarity < LOCK_CLARITY) return;

    if (eventNote === null) {
      // 新事件
      eventNote = note;
      stats.total++;
      eventInTune = false;
      updateStatsUI();
      return;
    }
    if (note !== eventNote) {
      // 换音：先做去抖（连续 3 帧才确认）
      if (pendingNote === note) {
        pendingCount++;
        if (pendingCount >= 3) {
          if (!eventInTune) stats.streak = 0; // 上一个音没拉准，连胜中断
          eventNote = note;
          pendingNote = null;
          pendingCount = 0;
          eventInTune = false;
          stats.total++;
          updateStatsUI();
        }
      } else {
        pendingNote = note;
        pendingCount = 1;
      }
      return;
    }
    pendingNote = null;
    pendingCount = 0;

    // 同一音：达到音准阈值则计数（每事件一次）
    if (!eventInTune && Math.abs(displayCents) <= SCORE_CENTS) {
      eventInTune = true;
      stats.inTune++;
      stats.streak++;
      updateStatsUI();
      flash();
    }
  }

  function updateStatsUI() {
    statTotalEl.textContent = String(stats.total);
    statInTuneEl.textContent = String(stats.inTune);
    statRateEl.textContent = stats.total > 0
      ? Math.round((stats.inTune / stats.total) * 100) + '%'
      : '—';
    statStreakEl.textContent = String(stats.streak);
  }

  function resetStats() {
    stats = { total: 0, inTune: 0, streak: 0 };
    eventNote = null;
    pendingNote = null;
    pendingCount = 0;
    eventInTune = false;
    updateStatsUI();
  }

  function flash() {
    flashEl.classList.remove('hidden');
    flashEl.style.animation = 'none';
    void flashEl.offsetWidth; // 重启动画
    flashEl.style.animation = '';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashEl.classList.add('hidden'); }, 700);
  }

  /* ================= 参考音 ================= */

  function stopRef() {
    clearTimeout(refTimer);
    if (refOsc && audioCtx) {
      try {
        refGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
        var osc = refOsc;
        setTimeout(function () { try { osc.stop(); } catch (e) {} }, 250);
      } catch (e) {}
    }
    refOsc = null;
    refGain = null;
    refBtn.textContent = '🔊 播放参考音';
  }

  function toggleRef() {
    if (refOsc) { stopRef(); return; }
    var ctx;
    try { ctx = ensureAudioCtx(); } catch (e) { return; }
    ctx.resume();

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = P.freqFromMidi(targetMidi);
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.02);

    refOsc = osc;
    refGain = gain;
    refBtn.textContent = '🔇 停止参考音';
    // 5 秒后自动停止，避免持续刺激
    refTimer = setTimeout(stopRef, 5000);
  }

  /* ================= 事件绑定 ================= */

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  refBtn.addEventListener('click', toggleRef);
  resetStatsBtn.addEventListener('click', resetStats);

  stringRow.addEventListener('click', function (e) {
    var btn = e.target.closest('.string-btn');
    if (!btn) return;
    setTarget(STRINGS[btn.dataset.string].midi, btn.dataset.string);
  });

  window.addEventListener('resize', resizeMeter);
  if (window.ResizeObserver) {
    new ResizeObserver(resizeMeter).observe(meterEl);
  }

  /* ================= 初始化 ================= */

  buildChart();
  buildFingerboard();
  loadSettings();
  setTarget(targetMidi, currentString);
  resizeMeter();
  updateStatsUI();
  setStatus('idle', '点击下方「开始调音」，允许麦克风权限后即可使用');
})();
