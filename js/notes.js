/* ============================================================
 * notes.js — 识谱练习：单音符/短旋律双模式 × 3 难度 × 20 题随机题库
 * ============================================================ */
(function () {
  'use strict';

  var P = window.Pitch;
  var N = window.Notation;
  if (!P || !N) throw new Error('pitch.js / notation.js 未加载');

  var PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /* ---------- 难度题库配置（高音谱号，按音域与音符数递进） ---------- */
  var LEVELS = {
    1: { name: '初级', lo: 60, hi: 71, sharps: [], melodyLen: 2 },
    2: { name: '中级', lo: 60, hi: 77, sharps: [66, 68, 70, 73, 75], melodyLen: 3 },
    3: { name: '高级', lo: 55, hi: 84, sharps: [61, 63, 66, 68, 70, 73, 75, 78, 80, 83], melodyLen: 4 }
  };

  /* ---------- 一把位指法提示（与调音器一致） ---------- */
  var CHART = [
    { str: 'G', fingers: [55, 57, 59, 60, 62] },
    { str: 'D', fingers: [62, 64, 66, 67, 69] },
    { str: 'A', fingers: [69, 71, 73, 74, 76] },
    { str: 'E', fingers: [76, 78, 80, 81, 83] }
  ];
  var POS = {};
  var FINGER_TXT = ['空弦', '1指', '2指', '3指', '4指'];
  CHART.forEach(function (r) {
    r.fingers.forEach(function (m, i) { if (!POS[m]) POS[m] = { str: r.str, finger: i }; });
  });

  function pitchClass(midi) { return PC_NAMES[midi % 12]; }
  function isNatural(midi) { return [0, 2, 4, 5, 7, 9, 11].indexOf(midi % 12) >= 0; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function getPool(level) {
    var L = LEVELS[level], pool = [];
    for (var m = L.lo; m <= L.hi; m++) {
      if (isNatural(m) || L.sharps.indexOf(m) >= 0) pool.push(m);
    }
    return pool;
  }

  /* ---------- 随机题库：单音符（整轮无相邻重复、每遍洗牌） ---------- */
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

  function nearestIn(pool, target) {
    var best = pool[0], bd = Math.abs(pool[0] - target);
    for (var i = 1; i < pool.length; i++) {
      var d = Math.abs(pool[i] - target);
      if (d < bd) { bd = d; best = pool[i]; }
    }
    return best;
  }

  /* ---------- 随机题库：短旋律（随机漫步，同轮内旋律不重复） ---------- */
  function buildMelodyRound(level) {
    var L = LEVELS[level], pool = getPool(level), len = L.melodyLen;
    var seen = {}, qs = [], guard = 0;
    while (qs.length < 20 && guard++ < 3000) {
      var m = [];
      var cur = pool[Math.floor(Math.random() * pool.length)];
      m.push(cur);
      for (var i = 1; i < len; i++) {
        var steps = [-4, -3, -2, -1, 1, 2, 3, 4][Math.floor(Math.random() * 8)];
        var next = nearestIn(pool, cur + steps);
        if (next === cur) next = nearestIn(pool, cur + (steps > 0 ? 2 : -2));
        if (next === cur) continue;
        m.push(next);
        cur = next;
      }
      var key = m.join(',');
      if (seen[key]) continue;
      seen[key] = true;
      qs.push(m);
    }
    return qs;
  }

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var modeRow = $('modeRow'), levelRow = $('levelRow'),
    startBtn = $('startBtn'), setupCard = $('setupCard'),
    quizCard = $('quizCard'), resultCard = $('resultCard'),
    progressText = $('progressText'), scoreText = $('scoreText'),
    progressFill = $('progressFill'), staff = $('staff'),
    answerRow = $('answerRow'), feedbackEl = $('feedback'),
    againBtn = $('againBtn'), backBtn = $('backBtn');

  /* ---------- 状态 ---------- */
  var mode = 'single', level = 1;
  var round = [], idx = 0;
  var right = 0, wrong = 0, streak = 0, maxStreak = 0;
  var melodyNoteIdx = 0, melodyErr = false;
  var locked = false;

  /* ---------- 渲染 ---------- */
  function renderQuestion() {
    staff.innerHTML = '';
    var topY = N.drawStaff(staff, 26, 58, 492);
    N.drawClef(staff, 60, 102);

    var q = round[idx];
    if (mode === 'single') {
      drawNoteAt(staff, 240, q, topY, true);
    } else {
      var xs = [128, 196, 264, 332];
      for (var i = 0; i < q.length; i++) {
        var isCur = (i === melodyNoteIdx);
        drawNoteAt(staff, xs[i], q[i], topY, isCur);
      }
    }
  }

  function drawNoteAt(parent, x, midi, topY, current) {
    var g = N.el('g', {}, parent);
    var y = N.drawNote(g, x, midi, topY, {});
    N.drawAccidental(g, x, y, midi);
    if (current) {
      N.el('path', {
        d: 'M0,-7 L6,0 L-6,0 Z',
        class: 'cur-marker',
        transform: 'translate(' + x + ',' + (y - 40) + ')'
      }, g);
    } else {
      g.setAttribute('opacity', '0.4');
    }
  }

  function posHint(m) {
    var p = POS[m];
    return p ? '（' + p.str + '弦 ' + FINGER_TXT[p.finger] + '）' : '';
  }

  /* ---------- 答题 ---------- */
  function answer(pc, btn) {
    if (locked) return;
    locked = true;
    var q = round[idx];
    var target = (mode === 'single') ? q : q[melodyNoteIdx];
    var correct = (pitchClass(target) === pc);

    btn.classList.add(correct ? 'right' : 'wrong');
    if (correct) {
      feedbackEl.className = 'feedback ok';
      feedbackEl.innerHTML = '✓ 正确！<b>' + P.noteNameFromMidi(target) + '</b>' + posHint(target);
    } else {
      feedbackEl.className = 'feedback bad';
      feedbackEl.innerHTML = '✗ 这个音是 <b>' + P.noteNameFromMidi(target) + '</b>' + posHint(target);
    }

    if (mode === 'single') {
      if (correct) { right++; streak++; if (streak > maxStreak) maxStreak = streak; }
      else { wrong++; streak = 0; }
      updateScore();
      setTimeout(nextQuestion, 650);
    } else {
      if (!correct) melodyErr = true;
      melodyNoteIdx++;
      if (melodyNoteIdx >= q.length) {
        if (melodyErr) { wrong++; streak = 0; }
        else { right++; streak++; if (streak > maxStreak) maxStreak = streak; }
        updateScore();
        setTimeout(nextQuestion, 650);
      } else {
        setTimeout(function () {
          btn.classList.remove('right', 'wrong');
          renderQuestion();
          locked = false;
        }, 450);
      }
    }
  }

  function nextQuestion() {
    locked = false;
    feedbackEl.className = 'feedback';
    feedbackEl.innerHTML = '&nbsp;';
    Array.prototype.forEach.call(answerRow.children, function (b) {
      b.classList.remove('right', 'wrong');
    });
    idx++;
    if (idx >= round.length) { showResult(); return; }
    if (mode === 'melody') { melodyNoteIdx = 0; melodyErr = false; }
    updateProgress();
    renderQuestion();
  }

  /* ---------- 进度与结果 ---------- */
  function updateProgress() {
    progressText.textContent = '第 ' + (idx + 1) + ' / ' + round.length + ' 题';
    progressFill.style.width = ((idx) / round.length * 100) + '%';
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

  /* ---------- 轮次控制 ---------- */
  function startRound() {
    var pool = getPool(level);
    round = (mode === 'single') ? buildSingleRound(pool) : buildMelodyRound(level);
    idx = 0; right = 0; wrong = 0; streak = 0; maxStreak = 0;
    melodyNoteIdx = 0; melodyErr = false; locked = false;
    buildAnswerButtons();
    setupCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    quizCard.classList.remove('hidden');
    updateProgress();
    updateScore();
    feedbackEl.className = 'feedback';
    feedbackEl.innerHTML = '&nbsp;';
    renderQuestion();
  }

  function buildAnswerButtons() {
    var pool = getPool(level);
    var classes = [];
    pool.forEach(function (m) {
      var pc = pitchClass(m);
      if (classes.indexOf(pc) < 0) classes.push(pc);
    });
    classes.sort(function (a, b) { return PC_NAMES.indexOf(a) - PC_NAMES.indexOf(b); });
    answerRow.innerHTML = '';
    classes.forEach(function (pc) {
      var b = document.createElement('button');
      b.className = 'answer-btn';
      b.textContent = pc;
      b.addEventListener('click', function () { answer(pc, b); });
      answerRow.appendChild(b);
    });
  }

  function backToSetup() {
    quizCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    setupCard.classList.remove('hidden');
  }

  /* ---------- 事件 ---------- */
  modeRow.addEventListener('click', function (e) {
    var b = e.target.closest('.choice-btn');
    if (!b) return;
    mode = b.dataset.mode;
    Array.prototype.forEach.call(modeRow.children, function (x) { x.classList.toggle('active', x === b); });
  });
  levelRow.addEventListener('click', function (e) {
    var b = e.target.closest('.choice-btn');
    if (!b) return;
    level = parseInt(b.dataset.level, 10);
    Array.prototype.forEach.call(levelRow.children, function (x) { x.classList.toggle('active', x === b); });
  });
  startBtn.addEventListener('click', startRound);
  againBtn.addEventListener('click', startRound);
  backBtn.addEventListener('click', backToSetup);

  // 键盘答题：1-9 对应按钮？移动端主要触摸，桌面可用字母键直接答
  document.addEventListener('keydown', function (e) {
    if (quizCard.classList.contains('hidden')) return;
    var key = e.key.toUpperCase();
    var btns = answerRow.children;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.toUpperCase() === key) {
        e.preventDefault();
        answer(btns[i].textContent, btns[i]);
        return;
      }
    }
    // 备选：数字键 1..n 选择
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= btns.length) { answer(btns[n - 1].textContent, btns[n - 1]); }
  });
})();
