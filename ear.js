/* ============================================================
 * ear.js — 音准（听音）训练：小提琴采样播放 + 顺序听写
 * 五关难度：单音 / 三个音 / 五个音 / 七个音 / 经典旋律
 * 双答题方式：音名按钮 / 纵向指板按弦（难度梯度：一把位逐级扩展）
 * ============================================================ */
(function () {
  'use strict';

  var P = window.Pitch;
  var S = window.Samples;
  if (!P || !S) throw new Error('pitch.js / samples.js 未加载');

  /* ================= 数据 ================= */

  // 一把位音（G3–B5，17 音）
  var FIRST_POS = [55, 57, 59, 60, 62, 64, 66, 67, 69, 71, 73, 74, 76, 78, 80, 81, 83];

  var STRING_OPEN = { G: 55, D: 62, A: 69, E: 76 };
  var STRING_ORDER = ['G', 'D', 'A', 'E'];
  var OFFSET_FINGER = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4 };

  // 音在指板上的最佳弦位（偏移最小）
  function posOf(midi) {
    var best = null;
    STRING_ORDER.forEach(function (s) {
      var off = midi - STRING_OPEN[s];
      if (off >= 0 && off <= 12 && (best === null || off < best.off)) best = { str: s, off: off };
    });
    return best;
  }
  // 一把位内的指法编号（-1 = 非一把位）
  function fingerOf(midi) {
    if (FIRST_POS.indexOf(midi) < 0) return -1;
    var pos = posOf(midi);
    if (!pos || OFFSET_FINGER[pos.off] === undefined) return -1;
    return OFFSET_FINGER[pos.off];
  }
  // 一把位指法提示文本
  var FINGER_TXT = ['空弦', '1指', '2指', '3指', '4指'];
  function posHint(midi) {
    var f = fingerOf(midi);
    if (f < 0) return '';
    return '（' + posOf(midi).str + '弦 ' + FINGER_TXT[f] + '）';
  }

  function rangePool(lo, hi) {
    var a = [];
    for (var m = lo; m <= hi; m++) a.push(m);
    return a;
  }

  var LEVELS = {
    1: { name: '单音', count: 1, pool: FIRST_POS.slice() },
    2: { name: '三个音', count: 3, pool: rangePool(55, 84) },
    3: { name: '五个音', count: 5, pool: rangePool(55, 86) },
    4: { name: '七个音', count: 7, pool: rangePool(55, 88) },
    5: { name: '旋律', count: 'melody', pool: rangePool(55, 86) }
  };

  /* ================= 经典旋律库（古典/流行/ACG） ================= */
  var MELODIES = [
    { title: '欢乐颂', style: '古典 · 贝多芬', notes: [
      ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
      ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1.5], ['D4', 0.5], ['D4', 2] ] },
    { title: '小星星', style: '童谣', notes: [
      ['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1], ['G4', 2],
      ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 2] ] },
    { title: '生日快乐', style: '流行', notes: [
      ['D4', 0.75], ['D4', 0.25], ['E4', 1], ['D4', 1], ['G4', 1], ['F#4', 2],
      ['D4', 0.75], ['D4', 0.25], ['E4', 1], ['D4', 1], ['A4', 1], ['G4', 2],
      ['D4', 0.75], ['D4', 0.25], ['D5', 1], ['B4', 1], ['G4', 1], ['F#4', 1], ['E4', 2],
      ['C5', 0.75], ['C5', 0.25], ['B4', 1], ['G4', 1], ['A4', 1], ['G4', 2] ] },
    { title: '两只老虎', style: '童谣', notes: [
      ['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1],
      ['E4', 1], ['F4', 1], ['G4', 2], ['E4', 1], ['F4', 1], ['G4', 2],
      ['G4', 0.75], ['A4', 0.25], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1],
      ['G4', 0.75], ['A4', 0.25], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1],
      ['C4', 1], ['G3', 1], ['C4', 2], ['C4', 1], ['G3', 1], ['C4', 2] ] },
    { title: '铃儿响叮当', style: '流行 · 圣诞', notes: [
      ['B3', 0.5], ['B3', 0.5], ['B3', 1], ['B3', 0.5], ['B3', 0.5], ['B3', 1],
      ['B3', 0.5], ['B3', 0.5], ['D4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 2],
      ['C5', 0.5], ['C5', 0.5], ['C5', 0.5], ['C5', 0.5], ['C5', 0.5], ['B4', 0.5], ['B4', 0.5], ['B4', 0.5],
      ['B4', 0.5], ['A4', 0.5], ['A4', 0.5], ['B4', 0.5], ['A4', 0.5], ['D5', 2] ] },
    { title: '致爱丽丝', style: '古典 · 贝多芬', notes: [
      ['E5', 0.5], ['D#5', 0.5], ['E5', 0.5], ['D#5', 0.5], ['E5', 0.5], ['B4', 0.5], ['D5', 0.5], ['C5', 0.5],
      ['A4', 1], ['C4', 0.5], ['E4', 0.5], ['A4', 0.5], ['B4', 1], ['E4', 0.5], ['G#4', 0.5], ['B4', 0.5], ['C5', 1] ] },
    { title: '卡农主题', style: '古典 · 帕赫贝尔', notes: [
      ['C5', 1], ['E5', 1], ['G5', 1], ['A5', 1], ['G5', 1], ['E5', 1], ['C5', 1],
      ['D5', 1], ['F5', 1], ['A5', 1], ['B5', 1], ['A5', 1], ['F5', 1], ['D5', 1] ] },
    { title: '超级玛丽主题', style: 'ACG · 游戏', notes: [
      ['E4', 0.5], ['E4', 0.5], ['E4', 1], ['C4', 0.5], ['E4', 0.5], ['G4', 1], ['E4', 0.5], ['C4', 0.5], ['G4', 1], ['E4', 1],
      ['A4', 0.5], ['G4', 0.5], ['D4', 0.5], ['F4', 0.5], ['D4', 1], ['C4', 1] ] }
  ];

  function nameToMidi(name) {
    var letter = name.charAt(0);
    var acc = name.charAt(1);
    var hasAcc = acc === '#' || acc === 'b';
    var oct = parseInt(name.slice(hasAcc ? 2 : 1), 10);
    var pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
    if (acc === '#') pc += 1;
    if (acc === 'b') pc -= 1;
    return (oct + 1) * 12 + pc;
  }

  // 预处理旋律：转调至 G3–D6 内，转成 midi 序列，切成 8 音片段
  var MELODY_FRAGS = null;
  function prepareMelodies() {
    if (MELODY_FRAGS) return MELODY_FRAGS;
    MELODY_FRAGS = [];
    MELODIES.forEach(function (m) {
      var mids = m.notes.map(function (n) { return nameToMidi(n[0]); });
      var min = Math.min.apply(null, mids), max = Math.max.apply(null, mids);
      var shift = 0;
      if (min < 55) shift = 55 - min;
      if (max + shift > 86) shift = 86 - max;
      var seq = m.notes.map(function (n, i) { return { midi: mids[i] + shift, dur: n[1] }; });
      // 切成 8 音片段；末段不足 4 音并入前段
      var frags = [];
      for (var i = 0; i < seq.length; i += 8) frags.push(seq.slice(i, i + 8));
      if (frags.length > 1 && frags[frags.length - 1].length < 4) {
        frags[frags.length - 2] = frags[frags.length - 2].concat(frags[frags.length - 1]);
        frags.pop();
      }
      frags.forEach(function (f) {
        MELODY_FRAGS.push({ title: m.title, style: m.style, notes: f });
      });
    });
    return MELODY_FRAGS;
  }

  /* ================= 工具 ================= */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pitchClass(midi) {
    return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12];
  }

  /* ================= 题库生成 ================= */
  function buildSingleRound(pool) {
    var qs = [], last = -1, cycle = [];
    while (qs.length < 20) {
      if (cycle.length === 0) cycle = shuffle(pool.slice());
      var pick = cycle.shift();
      if (pick === last && cycle.length > 0) { cycle.push(pick); pick = cycle.shift(); }
      qs.push(pick);
      last = pick;
    }
    return qs;
  }

  function buildSeqRound(level) {
    var N = LEVELS[level].count, pool = LEVELS[level].pool;
    var lo = pool[0], hi = pool[pool.length - 1];
    var seen = {}, qs = [], guard = 0;
    while (qs.length < 20 && guard++ < 5000) {
      var seq = [];
      var cur = pool[Math.floor(Math.random() * pool.length)];
      seq.push(cur);
      for (var i = 1; i < N; i++) {
        var steps = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
        var step = steps[Math.floor(Math.random() * steps.length)];
        var next = cur + step;
        if (next < lo) next = lo + Math.abs(step);
        if (next > hi) next = hi - Math.abs(step);
        if (next === cur) next = cur + (step > 0 ? 2 : -2);
        next = Math.max(lo, Math.min(hi, next));
        seq.push(next);
        cur = next;
      }
      var key = seq.join(',');
      if (seen[key]) continue;
      seen[key] = true;
      qs.push(seq);
    }
    return qs;
  }

  function buildMelodyRound() {
    var frags = prepareMelodies();
    var qs = [], lastTitle = '', cycle = [];
    while (qs.length < 20) {
      if (cycle.length === 0) cycle = shuffle(frags.slice());
      var f = cycle.shift();
      if (f.title === lastTitle && cycle.length > 0) { cycle.push(f); f = cycle.shift(); }
      qs.push(f);
      lastTitle = f.title;
    }
    return qs;
  }

  /* ================= DOM ================= */
  var $ = function (id) { return document.getElementById(id); };
  var levelRow = $('levelRow'), answerModeRow = $('answerModeRow'),
    startBtn = $('startBtn'), setupCard = $('setupCard'),
    quizCard = $('quizCard'), resultCard = $('resultCard'),
    progressText = $('progressText'), scoreText = $('scoreText'),
    progressFill = $('progressFill'), seqInfo = $('seqInfo'),
    refBtn = $('refBtn'), replayBtn = $('replayBtn'),
    answerRow = $('answerRow'), boardWrap = $('boardWrap'), earBoard = $('earBoard'),
    btnLabel = $('btnLabel'), feedbackEl = $('feedback'), nextBtn = $('nextBtn'),
    soundStatus = $('soundStatus'), againBtn = $('againBtn'), backBtn = $('backBtn');

  /* ================= 状态 ================= */
  var level = 1, answerMode = 'buttons';
  var round = [], idx = 0, seqPos = 0;
  var right = 0, wrong = 0, streak = 0, maxStreak = 0;
  var locked = false, lastPlayAt = 0;
  var boardCells = new Map(); // midi -> group

  /* ================= 指板（纵向）构建 ================= */
  var FB = {
    x0: 66, x1: 274, yNut: 38, yEnd: 468,
    xOf: function (s) { return FB.x0 + (STRING_ORDER.indexOf(s) + 0.5) * (FB.x1 - FB.x0) / 4; },
    yOf: function (off) {
      var frac = 1 - Math.pow(2, -off / 12);
      var usable = FB.yEnd - FB.yNut - 26;
      return FB.yNut + 13 + frac * usable;
    }
  };

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildBoard() {
    earBoard.innerHTML = '';
    boardCells.clear();
    var svg = earBoard;

    // 指板背景
    svgEl('rect', {
      x: FB.x0 - 18, y: FB.yNut - 16, width: (FB.x1 - FB.x0) + 36, height: (FB.yEnd - FB.yNut) + 26,
      rx: 10, fill: '#241a10', stroke: '#3a2c1a', 'stroke-width': 1.5
    }, svg);
    // 琴枕
    svgEl('rect', {
      x: FB.x0 - 24, y: FB.yNut - 6, width: (FB.x1 - FB.x0) + 48, height: 8, rx: 3, fill: '#4a3820'
    }, svg);
    // 弦
    var strStyle = { G: ['#5a4632', 6], D: ['#7a5c38', 5], A: ['#b0a08a', 3.5], E: ['#d8d8d8', 2] };
    STRING_ORDER.forEach(function (s) {
      var st = strStyle[s];
      svgEl('line', {
        x1: FB.xOf(s), y1: FB.yNut - 14, x2: FB.xOf(s), y2: FB.yEnd + 8,
        stroke: st[0], 'stroke-width': st[1], 'stroke-linecap': 'round'
      }, svg);
    });

    // 该关卡音域内的标记
    var pool = LEVELS[level].pool;
    pool.forEach(function (midi) {
      var pos = posOf(midi);
      if (!pos) return;
      var x = FB.xOf(pos.str), y = FB.yOf(pos.off);
      var g = svgEl('g', { class: 'fb-pos', 'data-midi': midi }, svg);
      svgEl('circle', { class: 'fb-hitarea', cx: 0, cy: 0, r: 15 }, g);
      var t = svgEl('text', { class: 'fb-note', x: 0, y: 0, dy: '0.35em' }, g);
      var name = P.noteNameFromMidi(midi);
      t.innerHTML = name.replace(/(\d+)$/, '<span class="fb-oct">$1</span>');
      var f = fingerOf(midi);
      if (f >= 0) {
        svgEl('circle', { class: 'fb-badge', cx: 10, cy: -10, r: 7 }, g);
        var ft = svgEl('text', { class: 'fb-finger', x: 10, y: -10, dy: '0.35em' }, g);
        ft.textContent = String(f);
      }
      g.setAttribute('transform', 'translate(' + x + ',' + y + ')');
      boardCells.set(String(midi), g);
    });

    // 弦名
    STRING_ORDER.forEach(function (s) {
      var lbl = svgEl('text', { class: 'fb-note', x: FB.xOf(s), y: FB.yEnd + 24, dy: '0.35em' }, svg);
      lbl.textContent = s + '弦';
    });
    var nut = svgEl('text', { class: 'fb-note', x: (FB.x0 + FB.x1) / 2, y: FB.yNut - 22, dy: '0.35em' }, svg);
    nut.textContent = '琴枕';
  }

  /* ================= 播放 ================= */
  function playQuestion() {
    if (!round[idx]) return;
    var q = round[idx];
    var ctx;
    try { ctx = S.ensureCtx(); } catch (e) { return; }
    var when = ctx.currentTime + 0.08;
    if (level === 5) {
      q.notes.forEach(function (n, i) {
        var d = n.dur * 0.55;
        S.playNote(n.midi, when + i * (d + 0.07), d, 0.5);
      });
    } else {
      q.notes.forEach(function (n, i) {
        S.playNote(n.midi, when + i * (n.dur + 0.15), n.dur, 0.5);
      });
    }
    lastPlayAt = performance.now();
  }

  function playReference() {
    try { S.playNote(69, S.ensureCtx().currentTime + 0.05, 1.3, 0.45); } catch (e) {}
  }

  /* ================= 答题 ================= */
  function judge(correct, el) {
    var q = round[idx];
    var target = q.notes[seqPos].midi;
    if (correct) {
      right++; streak++; if (streak > maxStreak) maxStreak = streak;
      feedbackEl.className = 'feedback ok';
      feedbackEl.innerHTML = '✓ 正确！<b>' + P.noteNameFromMidi(target) + '</b>' + posHint(target);
    } else {
      wrong++; streak = 0;
      feedbackEl.className = 'feedback bad';
      feedbackEl.innerHTML = '✗ 这个音是 <b>' + P.noteNameFromMidi(target) + '</b>' + posHint(target);
    }
    updateScore();
    locked = true;
    seqPos++;
    if (seqPos >= q.notes.length) {
      // 本题完成：保留当前页，不自动切换下一题，由用户点「下一题」
      if (level === 5) {
        feedbackEl.innerHTML += ' <span class="mel-name">——《' + q.title + '》' + q.style + '</span>';
      }
      seqInfo.textContent = '本题完成 ✓';
      nextBtn.classList.remove('hidden');
    } else {
      setTimeout(function () {
        if (el) el.classList.remove('right', 'wrong');
        seqInfo.textContent = '第 ' + (seqPos + 1) + ' / ' + q.notes.length + ' 个音';
        locked = false;
      }, 450);
    }
  }

  /* 点击音名按钮/指板标记：始终播放该音试听；未锁定时同时作为答案提交 */
  function answerMidi(midi, el) {
    try { S.playNote(midi, S.ensureCtx().currentTime + 0.02, 0.9, 0.5); } catch (e) {}
    if (locked || !round[idx]) return;
    var target = round[idx].notes[seqPos].midi;
    judge(midi === target, el || null);
  }

  function nextQuestion() {
    locked = false;
    nextBtn.classList.add('hidden');
    feedbackEl.className = 'feedback';
    feedbackEl.innerHTML = '&nbsp;';
    Array.prototype.forEach.call(answerRow.querySelectorAll('.answer-btn:not(.answer-empty)'), function (b) {
      b.classList.remove('right', 'wrong');
    });
    idx++;
    if (idx >= round.length) { showResult(); return; }
    seqPos = 0;
    seqInfo.textContent = '第 1 / ' + round[idx].notes.length + ' 个音';
    updateProgress();
    setTimeout(playQuestion, 400); // 进入下一题并自动播放
  }

  /* ================= 进度与结果 ================= */
  function updateProgress() {
    progressText.textContent = '第 ' + (idx + 1) + ' / ' + round.length + ' 题';
    progressFill.style.width = (idx / round.length * 100) + '%';
  }
  function updateScore() {
    scoreText.textContent = '对 ' + right + ' · 错 ' + wrong;
  }
  function showResult() {
    quizCard.classList.add('hidden');
    resultCard.classList.remove('hidden');
    $('resRight').textContent = String(right);
    $('resWrong').textContent = String(wrong);
    $('resRate').textContent = Math.round(right / round.length * 100) + '%';
    $('resStreak').textContent = String(maxStreak);
  }

  /* ================= 轮次控制 ================= */
  function startRound() {
    var qs;
    if (level === 1) qs = buildSingleRound(LEVELS[1].pool);
    else if (level === 5) qs = buildMelodyRound();
    else qs = buildSeqRound(level);

    round = qs.map(function (q) {
      if (level === 5) return q; // {title, style, notes}
      var arr = (typeof q === 'number') ? [q] : q;
      return { notes: arr.map(function (m) { return { midi: m, dur: level === 1 ? 1.2 : 0.7 }; }) };
    });

    idx = 0; seqPos = 0; right = 0; wrong = 0; streak = 0; maxStreak = 0; locked = false;
    nextBtn.classList.add('hidden');
    buildAnswerButtons();
    buildBoard();
    setupCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    quizCard.classList.remove('hidden');
    updateProgress();
    updateScore();
    feedbackEl.className = 'feedback';
    feedbackEl.innerHTML = '&nbsp;';
    seqInfo.textContent = '第 1 / ' + round[0].notes.length + ' 个音';
    // 基准音 A4，随后自动播放第一题
    playReference();
    setTimeout(playQuestion, 1400);
  }

  /* 音名按钮：钢琴式八度分行，每个音高一个按钮（低→高），点击=播放试听+作答 */
  function buildAnswerButtons() {
    var PC12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var pool = LEVELS[level].pool.slice().sort(function (a, b) { return a - b; });
    answerRow.innerHTML = '';

    // 收集出现的八度（低→高）
    var octs = [];
    pool.forEach(function (m) {
      var o = Math.floor(m / 12) - 1;
      if (octs.indexOf(o) < 0) octs.push(o);
    });
    octs.sort(function (a, b) { return a - b; });

    octs.forEach(function (o) {
      var row = document.createElement('div');
      row.className = 'oct-row';
      var tag = document.createElement('div');
      tag.className = 'oct-tag';
      tag.textContent = '第 ' + o + ' 八度';
      row.appendChild(tag);

      var grid = document.createElement('div');
      grid.className = 'oct-grid';
      for (var pc = 0; pc < 12; pc++) {
        var midi = (o + 1) * 12 + pc;
        var b = document.createElement('button');
        if (pool.indexOf(midi) < 0) {
          b.className = 'answer-btn answer-empty';
          b.disabled = true;
          b.tabIndex = -1;
        } else {
          b.className = 'answer-btn';
          b.dataset.midi = String(midi);
          b.textContent = P.noteNameFromMidi(midi);
          b.setAttribute('aria-label', P.noteNameFromMidi(midi));
          b.addEventListener('click', function () {
            answerMidi(parseInt(this.dataset.midi, 10), this);
          });
        }
        grid.appendChild(b);
      }
      row.appendChild(grid);
      answerRow.appendChild(row);
    });
  }

  function backToSetup() {
    quizCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    setupCard.classList.remove('hidden');
  }

  /* ================= 事件 ================= */
  levelRow.addEventListener('click', function (e) {
    var b = e.target.closest('.rh-level');
    if (!b) return;
    level = parseInt(b.dataset.level, 10);
    Array.prototype.forEach.call(levelRow.children, function (x) { x.classList.toggle('active', x === b); });
  });
  answerModeRow.addEventListener('click', function (e) {
    var b = e.target.closest('.choice-btn');
    if (!b) return;
    answerMode = b.dataset.mode;
    Array.prototype.forEach.call(answerModeRow.children, function (x) { x.classList.toggle('active', x === b); });
    var useBoard = answerMode === 'board';
    answerRow.classList.toggle('hidden', useBoard);
    btnLabel.classList.toggle('hidden', useBoard);
    boardWrap.classList.toggle('hidden', !useBoard);
    btnLabel.textContent = useBoard ? '在指板上点出这个音的位置' : '点击音名作答（同时播放该音试听，可随时与基准音对比）';
  });
  startBtn.addEventListener('click', startRound);
  againBtn.addEventListener('click', startRound);
  backBtn.addEventListener('click', backToSetup);
  refBtn.addEventListener('click', playReference);
  replayBtn.addEventListener('click', function () {
    if (performance.now() - lastPlayAt > 300) playQuestion();
  });
  nextBtn.addEventListener('click', nextQuestion);

  // 键盘（音名按钮模式）：数字键按低→高选第 n 个音；字母键仅在音名全局唯一时作答
  document.addEventListener('keydown', function (e) {
    if (quizCard.classList.contains('hidden') || answerMode !== 'buttons') return;
    if (locked && nextBtn.classList.contains('hidden')) return; // 同题作答间隙锁定
    var btns = answerRow.querySelectorAll('.answer-btn:not(.answer-empty)');
    if (btns.length === 0) return;
    var n = (e.key >= '1' && e.key <= '9') ? parseInt(e.key, 10) : (e.key === '0' ? 10 : -1);
    if (n >= 1 && n <= btns.length) {
      e.preventDefault();
      answerMidi(parseInt(btns[n - 1].dataset.midi, 10), btns[n - 1]);
      return;
    }
    var key = e.key.toUpperCase();
    var matches = [];
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.toUpperCase().indexOf(key) === 0) matches.push(btns[i]);
    }
    if (matches.length === 1) {
      e.preventDefault();
      answerMidi(parseInt(matches[0].dataset.midi, 10), matches[0]);
    }
  });

  /* ================= 初始化 ================= */
  // 指板点击：一次性事件委托（点按=播放试听+作答）
  earBoard.addEventListener('click', function (e) {
    var g = e.target.closest('.fb-pos');
    if (!g || !g.dataset.midi) return;
    answerMidi(parseInt(g.dataset.midi, 10), g);
  });

  // 后台预载采样音色
  S.load().then(function (ok) {
    if (ok) {
      soundStatus.className = 'sound-status ok';
      soundStatus.textContent = '✓ 小提琴采样音色已就绪';
    } else {
      soundStatus.className = 'sound-status warn';
      soundStatus.textContent = '采样加载失败或网络不可用，使用合成小提琴音色';
    }
  });
})();
