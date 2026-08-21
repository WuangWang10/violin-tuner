/* ============================================================
 * rhythm.js — 节奏练习：五线谱节奏谱 + 节拍器 + 按键/触摸触发 +
 *             实时判定（太早/准确/太晚）
 * ============================================================ */
(function () {
  'use strict';

  var N = window.Notation;
  if (!N) throw new Error('notation.js 未加载');

  /* ---------- 时值（单位：拍） ---------- */
  var DUR = {
    '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25,
    '4.': 1.5, '8.': 0.75, '8t': 1 / 3,
    '1r': 4, '2r': 2, '4r': 1, '8r': 0.5
  };

  /* ---------- 关卡模板（4/4，每轮 8 拍；运行时校验和） ---------- */
  var LEVELS = [
    { name: '四分音符', templates: [
      ['4','4','4','4','4','4','4','4'],
      ['4','4','4r','4','4','4r','4','4'],
      ['4','4r','4','4r','4','4','4r','4'],
      ['4','4','4','4r','4','4','4','4r'] ] },
    { name: '二分与四分', templates: [
      ['2','2','4','4','4','4'],
      ['2','4','4','4','2','4'],
      ['2','2r','4','4','4','4'],
      ['4','4','4','4','2','2'] ] },
    { name: '八分音符', templates: [
      ['8','8','8','8','8','8','8','8','8','8','8','8','8','8','8','8'],
      ['8','8','4','8','8','4','8','8','4','8','8','4'],
      ['8','8','8r','8','8','8','8r','8','4','4','4','4'],
      ['4','8','8','8','8','8','8','4','4','4','4'] ] },
    { name: '附点节奏', templates: [
      ['4.','8','4.','8','4.','8','4.','8'],
      ['4.','8','4','4','4.','8','4','4'],
      ['4.','8','8','8','8','8','4.','8','8','8','8','8'],
      ['4.','8','4.','8','4','4','4.','8'] ] },
    { name: '切分节奏', templates: [
      ['8','4','8','8','4','8','8','4','8','8','4','8'],
      ['8','4','8','4','4','8','4','8','4','4'],
      ['8','4','8','8','8','8','8','8','4','8','4','4'],
      ['8','8','4','8','8','4','4','8','8','4','8','8'] ] },
    { name: '三连音', templates: [
      ['8t','8t','8t','8t','8t','8t','8t','8t','8t','8t','8t','8t','4','4','4','4'],
      ['8t','8t','8t','8t','8t','8t','4','4','8t','8t','8t','8t','8t','8t','4','4'],
      ['8t','8t','8t','4','4','4','8t','8t','8t','4','4','4'],
      ['8t','8t','8t','8t','8t','8t','4','8t','8t','8t','8t','8t','8t','4','4','4'] ] }
  ];

  // 运行时校验模板总和 = 8 拍
  function sumBeats(tpl) {
    var s = 0;
    tpl.forEach(function (d) { s += DUR[d]; });
    return s;
  }
  LEVELS.forEach(function (L) {
    L.templates = L.templates.filter(function (t) { return Math.abs(sumBeats(t) - 8) < 0.001; });
  });

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var levelRow = $('levelRow'), measuresRow = $('measuresRow'),
    bpmSlider = $('bpmSlider'), bpmInput = $('bpmInput'), bpmValue = $('bpmValue'),
    metOn = $('metOn'), subOn = $('subOn'), startBtn = $('startBtn'),
    setupCard = $('setupCard'), playCard = $('playCard'), resultCard = $('resultCard'),
    rhLevelName = $('rhLevelName'), rhBpm = $('rhBpm'), rhStaff = $('rhStaff'),
    rhHint = $('rhHint'), tapBtn = $('tapBtn'), rhFeedback = $('rhFeedback'),
    rhGood = $('rhGood'), rhOff = $('rhOff'), rhMiss = $('rhMiss'), rhExtra = $('rhExtra'),
    stopBtn = $('stopBtn'), againBtn = $('againBtn'), backBtn = $('backBtn'),
    resRate = $('resRate'), resAvg = $('resAvg'), resMiss = $('resMiss'), resExtra = $('resExtra');

  /* ---------- 状态 ---------- */
  var level = 0;
  var measures = 1; // 模板重复次数（1 模板 = 2 小节）
  var state = 'idle'; // idle | counting | playing | done
  var events = [], eventTimes = [], eventEls = [];
  var t0Perf = 0, beatMs = 500;
  var stats = { good: 0, off: 0, miss: 0, extra: 0, avgAbs: 0, judged: 0 };
  var audioCtx = null, schedTimer = null, rafId = null;
  var cursorEl = null;

  /* ---------- 构建节奏事件 ---------- */
  function buildEvents(tpl) {
    var evs = [], beat = 0;
    tpl.forEach(function (s) {
      var rest = s.indexOf('r') >= 0;
      var base = rest ? s.slice(0, -1) : s;
      var dotted = base.indexOf('.') >= 0;
      var name = dotted ? base.slice(0, -1) : base;
      evs.push({ type: rest ? 'rest' : 'note', beats: DUR[s], dotted: dotted, name: name, beat: beat });
      beat += DUR[s];
    });
    return evs;
  }

  /* ---------- 渲染节奏谱 ---------- */
  var START_X = 138, BEAT_W = 44, TOP_Y = 58, PITCH = 67; // 统一 G4
  var COUNT_IN = 4; // 预备拍拍数

  function totalBeats() { return 8 * measures; }

  function renderStaff() {
    rhStaff.innerHTML = '';
    var svg = rhStaff;
    var beats = totalBeats();
    // 按总拍数动态决定谱面宽度（长谱面在容器内横向滚动）
    var totalW = START_X + beats * BEAT_W + 70;
    rhStaff.setAttribute('viewBox', '0 0 ' + totalW + ' 200');
    rhStaff.style.minWidth = totalW + 'px';

    N.drawStaff(svg, 28, TOP_Y, totalW - 40);
    N.drawClef(svg, 64, 104);
    N.drawTimeSignature(svg, 96, TOP_Y, 4, 4);

    eventEls = [];
    var barlineXs = [];
    var lastX = START_X;
    events.forEach(function (ev) {
      var x = START_X + ev.beat * BEAT_W;
      // 小节线画在前后两音间隙的中点，避免压到符头
      if (ev.beat > 0 && ev.beat % 4 === 0) barlineXs.push((lastX + x) / 2);
      var g = N.el('g', { class: 'rh-note pending' }, svg);
      var y;
      if (ev.type === 'rest') {
        if (ev.name === '1') N.drawWholeRest(g, x, TOP_Y);
        else if (ev.name === '2') N.drawHalfRest(g, x, TOP_Y);
        else if (ev.name === '4') N.drawQuarterRest(g, x, TOP_Y);
        else if (ev.name === '8') N.drawEighthRest(g, x, TOP_Y);
      } else {
        var opts = {};
        if (ev.name === '1') opts.whole = true;
        else if (ev.name === '2') opts.hollow = true;
        else if (ev.name === '8' || ev.name === '8t') opts.flag = true;
        y = N.drawNote(g, x, PITCH, TOP_Y, opts);
        if (ev.dotted) {
          N.el('circle', { cx: x + 11, cy: y + 3, r: 2.2, fill: '#e8edf6' }, g);
        }
        if (ev.name === '8t') {
          var t = N.el('text', {
            x: x, y: y - 26, 'text-anchor': 'middle', 'font-size': 12,
            fill: '#e8edf6', 'font-weight': 700
          }, g);
          t.textContent = '3';
        }
      }
      eventEls.push(g);
      lastX = x;
    });

    // 小节线与终止线
    barlineXs.forEach(function (bx) { N.drawBarline(svg, bx, TOP_Y); });
    N.drawFinalBarline(svg, START_X + beats * BEAT_W + 8, TOP_Y);

    // 节拍游标
    cursorEl = N.el('line', {
      class: 'beat-cursor', x1: START_X, y1: TOP_Y - 4,
      x2: START_X, y2: TOP_Y + N.LS * 4 + 4
    }, svg);
  }

  /* ---------- 音频（节拍器） ---------- */
  function ensureCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('no-webaudio');
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function clickAt(time, freq, vol) {
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.09);
  }

  /* ---------- 开始练习 ---------- */
  function startRound() {
    var L = LEVELS[level];
    var base = L.templates[Math.floor(Math.random() * L.templates.length)];
    // 按用户选择的小节数重复模板（1 模板 = 2 小节）
    var tpl = base.slice();
    for (var m = 1; m < measures; m++) tpl = tpl.concat(base);
    events = buildEvents(tpl);

    var ctx;
    try { ctx = ensureCtx(); } catch (e) { alert('此浏览器不支持 Web Audio API'); return; }

    bpmValue.textContent = bpmSlider.value;
    rhLevelName.textContent = '关卡 ' + (level + 1) + ' · ' + L.name + ' · ' + (measures * 2) + ' 小节';
    rhBpm.textContent = 'BPM ' + bpmSlider.value;
    beatMs = 60000 / parseInt(bpmSlider.value, 10);

    stats = { good: 0, off: 0, miss: 0, extra: 0, avgAbs: 0, judged: 0 };
    updateStats();
    rhFeedback.className = 'rh-feedback';
    rhFeedback.innerHTML = '&nbsp;';

    renderStaff();
    setupCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    playCard.classList.remove('hidden');

    // 节拍器时间线：四拍预备拍后进入练习
    var beatSec = beatMs / 1000;
    var audioStart = ctx.currentTime + 0.15;
    var useMet = metOn.checked;
    var useSub = subOn.checked;

    // 预备拍：4 响
    if (useMet) {
      for (var c = 0; c < COUNT_IN; c++) clickAt(audioStart + c * beatSec, 1200, 0.22);
      var totalK = COUNT_IN + totalBeats(); // 练习拍 + 结尾拍
      for (var k = COUNT_IN; k <= totalK; k++) {
        var beatIdx = k - COUNT_IN;
        var freq = beatIdx % 4 === 0 ? 1000 : 700;
        var vol = beatIdx % 4 === 0 ? 0.25 : 0.16;
        clickAt(audioStart + k * beatSec, freq, vol);
        if (useSub && k < totalK) clickAt(audioStart + (k + 0.5) * beatSec, 500, 0.07);
      }
    }

    // 事件时间（performance.now 基准）
    t0Perf = performance.now() + ((audioStart + COUNT_IN * beatSec) - ctx.currentTime) * 1000;
    eventTimes = events.map(function (ev) { return t0Perf + ev.beat * beatMs; });

    state = 'counting';
    rhHint.className = 'rh-hint counting';
    rhHint.textContent = '预备拍 ' + COUNT_IN + ' 拍…';
    setTimeout(function () {
      if (state === 'counting') {
        state = 'playing';
        rhHint.className = 'rh-hint playing';
        rhHint.textContent = '跟拍敲击！（空格/任意键 或 大按钮）';
      }
    }, COUNT_IN * beatMs + 260);

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(uiLoop);
  }

  /* ---------- 敲击判定 ---------- */
  function tap() {
    if (state === 'counting') return;
    if (state !== 'playing') return;
    var now = performance.now();

    var best = -1, bestAbs = Infinity;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type !== 'note' || ev.judged) continue;
      var d = Math.abs(now - eventTimes[i]);
      if (d < bestAbs) { bestAbs = d; best = i; }
    }

    if (best === -1) {
      stats.extra++;
      updateStats();
      feedback('多余敲击', 'bad');
      return;
    }

    var ev = events[best];
    var tol = Math.max(ev.beats * beatMs / 2, 120);
    if (bestAbs <= tol * 0.35) {
      judge(best, 0, bestAbs);
    } else if (bestAbs <= tol) {
      judge(best, now > eventTimes[best] ? 1 : -1, bestAbs);
    } else {
      stats.extra++;
      updateStats();
      feedback('偏差过大，未计分', 'bad');
    }
  }

  function judge(i, dir, absMs) {
    var ev = events[i];
    ev.judged = true;
    stats.judged++;
    stats.avgAbs += absMs;
    var el = eventEls[i];
    if (dir === 0) {
      stats.good++;
      el.setAttribute('class', 'rh-note hit-good');
      feedback('✓ 准确（±' + Math.round(absMs) + 'ms）', 'good');
    } else {
      stats.off++;
      el.setAttribute('class', 'rh-note ' + (dir > 0 ? 'hit-late' : 'hit-early'));
      feedback((dir > 0 ? '晚了 ' : '早了 ') + Math.round(absMs) + 'ms', dir > 0 ? 'late' : 'early');
    }
    updateStats();
    checkFinish();
  }

  function checkFinish() {
    var remaining = events.some(function (ev) { return ev.type === 'note' && !ev.judged; });
    if (!remaining) finish();
  }

  /* ---------- UI 循环（游标与待敲高亮） ---------- */
  function uiLoop() {
    if (state !== 'playing' && state !== 'counting') return;
    rafId = requestAnimationFrame(uiLoop);

    var now = performance.now();
    // 游标 + 长谱面自动跟随滚动
    if (cursorEl && state === 'playing') {
      var beatPos = (now - t0Perf) / beatMs;
      var x = START_X + Math.max(0, Math.min(totalBeats(), beatPos)) * BEAT_W;
      cursorEl.setAttribute('x1', x);
      cursorEl.setAttribute('x2', x);
      var wrap = rhStaff.parentElement;
      var targetScroll = x - wrap.clientWidth * 0.4;
      if (wrap.scrollLeft < targetScroll - 2) {
        wrap.scrollLeft += Math.min(50, (targetScroll - wrap.scrollLeft) * 0.25);
      }
    }
    // 待敲高亮 + 漏音判定
    var nextSet = false;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var el = eventEls[i];
      if (ev.type !== 'note' || ev.judged) {
        if (el && !ev.judged && ev.type === 'rest') el.setAttribute('class', 'rh-note');
        continue;
      }
      if (!nextSet) {
        el.setAttribute('class', 'rh-note next');
        nextSet = true;
      } else {
        el.setAttribute('class', 'rh-note pending');
      }
      // 漏音
      if (now - eventTimes[i] > Math.max(ev.beats * beatMs / 2, 120)) {
        ev.judged = true;
        stats.miss++;
        el.setAttribute('class', 'rh-note miss');
        updateStats();
        checkFinish();
      }
    }
  }

  function finish() {
    state = 'done';
    if (rafId) cancelAnimationFrame(rafId);
    if (schedTimer) clearInterval(schedTimer);
    rhHint.className = 'rh-hint';
    rhHint.textContent = '完成！';
    setTimeout(function () {
      playCard.classList.add('hidden');
      resultCard.classList.remove('hidden');
      var totalNotes = events.filter(function (ev) { return ev.type === 'note'; }).length;
      resRate.textContent = totalNotes > 0 ? Math.round(stats.good / totalNotes * 100) + '%' : '—';
      resAvg.textContent = stats.judged > 0 ? Math.round(stats.avgAbs / stats.judged) + 'ms' : '—';
      resMiss.textContent = String(stats.miss);
      resExtra.textContent = String(stats.extra);
    }, 400);
  }

  function stopRound() {
    state = 'idle';
    if (rafId) cancelAnimationFrame(rafId);
    playCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    setupCard.classList.remove('hidden');
  }

  /* ---------- 显示辅助 ---------- */
  function feedback(html, cls) {
    rhFeedback.className = 'rh-feedback ' + (cls || '');
    rhFeedback.innerHTML = html;
  }

  function updateStats() {
    rhGood.textContent = String(stats.good);
    rhGood.className = 'good';
    rhOff.textContent = String(stats.off);
    rhOff.className = 'off';
    rhMiss.textContent = String(stats.miss);
    rhMiss.className = stats.miss > 0 ? 'bad' : '';
    rhExtra.textContent = String(stats.extra);
    rhExtra.className = stats.extra > 0 ? 'bad' : '';
  }

  /* ---------- 事件 ---------- */
  levelRow.addEventListener('click', function (e) {
    var b = e.target.closest('.rh-level');
    if (!b) return;
    level = parseInt(b.dataset.level, 10);
    Array.prototype.forEach.call(levelRow.children, function (x) { x.classList.toggle('active', x === b); });
  });

  measuresRow.addEventListener('click', function (e) {
    var b = e.target.closest('.rh-level');
    if (!b) return;
    measures = parseInt(b.dataset.measures, 10);
    Array.prototype.forEach.call(measuresRow.children, function (x) { x.classList.toggle('active', x === b); });
  });

  function clampBpm(v) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = 90;
    return Math.max(40, Math.min(200, v));
  }
  // 滑块 → 数字框 + 标签（滑块取值恒合法）
  bpmSlider.addEventListener('input', function () {
    var v = parseInt(bpmSlider.value, 10);
    bpmValue.textContent = v;
    bpmInput.value = v;
  });
  // 数字框输入中：只跟随标签显示，不钳制（允许输入中间态，如先输 "1"）
  bpmInput.addEventListener('input', function () {
    var n = parseInt(bpmInput.value, 10);
    if (!isNaN(n)) bpmValue.textContent = n;
  });
  // 数字框结束编辑（失焦/回车）：钳制并同步滑块
  bpmInput.addEventListener('change', function () {
    var v = clampBpm(bpmInput.value);
    bpmInput.value = v;
    bpmSlider.value = v;
    bpmValue.textContent = v;
  });

  startBtn.addEventListener('click', startRound);
  stopBtn.addEventListener('click', stopRound);
  againBtn.addEventListener('click', startRound);
  backBtn.addEventListener('click', stopRound);

  tapBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    tap();
  });

  document.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'F5' || e.key === 'F12') return;
    if (e.key === ' ' || e.key === 'Spacebar') e.preventDefault();
    tap();
  });
})();
