/* ============================================================
 * notation.js — 五线谱（高音谱号）SVG 绘制工具
 *
 * 供识谱页(notes)与节奏页(rhythm)共用。纯函数、无状态。
 * ============================================================ */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // 几何常量
  var LS = 13;            // 相邻谱线间距(px)
  var TOP_LINE_MIDI = 77; // 高音谱表最上面一条线 = F5
  var BOTTOM_LINE_MIDI = 64; // 最下面一条线 = E4

  // MIDI 音名 → 半音序号（仅白键）
  var LETTER_INDEX = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

  // 音名（C=0 ... B=6）与八度 → 自然音阶序号（用于五线谱纵向定位）
  function diatonic(midi) {
    var pc = midi % 12;
    var letter = LETTER_INDEX[pc];
    var oct = Math.floor(midi / 12) - 1;
    return oct * 7 + letter;
  }

  /** 谱表内 y 坐标（topY = 最上一条线 F5 的 y；向下的 y 增大） */
  function yOfMidi(midi, topY) {
    return topY + (diatonic(TOP_LINE_MIDI) - diatonic(midi)) * (LS / 2);
  }
  function yOfDiatonic(d, topY) {
    return topY + (diatonic(TOP_LINE_MIDI) - d) * (LS / 2);
  }

  /** 需要绘制的加线 y 列表（超出谱表的音符） */
  function legerYs(midi, topY) {
    var d = diatonic(midi);
    var ys = [];
    if (midi < BOTTOM_LINE_MIDI) {
      for (var dd = (d % 2 === 0 ? d : d + 1); dd < diatonic(BOTTOM_LINE_MIDI); dd += 2) {
        ys.push(yOfDiatonic(dd, topY));
      }
    } else if (midi > TOP_LINE_MIDI) {
      for (var dd2 = (d % 2 === 0 ? d : d - 1); dd2 > diatonic(TOP_LINE_MIDI); dd2 -= 2) {
        ys.push(yOfDiatonic(dd2, topY));
      }
    }
    return ys;
  }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /** 画五线谱（5 条线），返回 topY（最上线 y） */
  function drawStaff(svg, x, y, width) {
    for (var i = 0; i < 5; i++) {
      var ly = y + i * LS;
      el('line', { x1: x, y1: ly, x2: x + width, y2: ly, stroke: '#6b7a99', 'stroke-width': 1.2 }, svg);
    }
    return y;
  }

  /** 高音谱号（Unicode 字形 + 字体回退） */
  function drawClef(svg, x, y) {
    var t = el('text', {
      x: x, y: y, 'text-anchor': 'middle',
      'font-family': '"Bravura","Noto Music","Segoe UI Symbol","DejaVu Sans",serif',
      'font-size': LS * 5.6, fill: '#e8edf6'
    }, svg);
    t.textContent = '\uD834\uDD1E'; // 𝄞
    return t;
  }

  /** 画一个音符（含加线与符干），whole=true 为空心全音符 */
  function drawNote(svg, x, midi, topY, opts) {
    opts = opts || {};
    var y = yOfMidi(midi, topY);
    var fill = opts.fill || '#e8edf6';

    // 加线
    legerYs(midi, topY).forEach(function (ly) {
      el('line', { x1: x - 11, y1: ly, x2: x + 11, y2: ly, stroke: '#6b7a99', 'stroke-width': 1.2 }, svg);
    });

    // 符头
    if (opts.whole) {
      el('ellipse', {
        cx: x, cy: y, rx: 7, ry: 5.2,
        fill: 'none', stroke: fill, 'stroke-width': 2,
        transform: 'rotate(-18 ' + x + ' ' + y + ')'
      }, svg);
    } else {
      var hollow = !!opts.hollow; // 二分音符：空心但带符干
      el('ellipse', {
        cx: x, cy: y, rx: 6.8, ry: 5,
        fill: hollow ? 'none' : fill,
        stroke: hollow ? fill : 'none',
        'stroke-width': 2,
        transform: 'rotate(-18 ' + x + ' ' + y + ')'
      }, svg);
      // 符干：音低于中音线(B4=71)向上，否则向下（全音符无符干）
      var up = midi < 71;
      var sx = up ? x + 6.2 : x - 6.2;
      var sy = up ? y - LS * 3.2 : y + LS * 3.2;
      el('line', { x1: sx, y1: y, x2: sx, y2: sy, stroke: fill, 'stroke-width': 2 }, svg);
      // 八分音符符尾（节奏页用时值>=0.5拍不需要，此处仅画单符尾）
      if (opts.flag) {
        var fx = sx, fy = sy;
        var fdir = up ? 1 : -1;
        var p = el('path', {
          d: 'M' + fx + ' ' + fy +
            ' C' + (fx + 9 * fdir) + ' ' + (fy + 4) +
            ' ' + (fx + 12 * fdir) + ' ' + (fy + 12) +
            ' ' + (fx + 4 * fdir) + ' ' + (fy + 20),
          fill: 'none', stroke: fill, 'stroke-width': 2.2, 'stroke-linecap': 'round'
        }, svg);
        p.setAttribute('transform', 'scale(' + fdir + ',1) translate(' + (fdir < 0 ? -2 * fx : 0) + ',0)');
      }
    }
    return y;
  }

  /** 升降号标记（画在符头左侧） */
  function drawAccidental(svg, x, y, midi) {
    var pc = midi % 12;
    var acc = '';
    if (pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10) acc = '\u266F'; // ♯
    else if (pc === 2 || pc === 4 || pc === 7 || pc === 9 || pc === 11) acc = '\u266D'; // ♭
    if (!acc) return;
    var t = el('text', {
      x: x - 12, y: y, 'text-anchor': 'middle',
      'font-size': 15, fill: '#e8edf6',
      'font-family': '"Noto Music","Segoe UI Symbol","DejaVu Sans",serif'
    }, svg);
    t.textContent = acc;
  }

  /* ---------- 休止符 ---------- */

  function drawWholeRest(svg, x, topY) {
    // 挂在第 4 线（D5=74）下方
    var y = yOfMidi(74, topY);
    el('rect', { x: x - 9, y: y, width: 18, height: 4.5, rx: 1, fill: '#e8edf6' }, svg);
  }

  function drawHalfRest(svg, x, topY) {
    // 坐在第 3 线（B4=71）上方
    var y = yOfMidi(71, topY) - 4.5;
    el('rect', { x: x - 9, y: y, width: 18, height: 4.5, rx: 1, fill: '#e8edf6' }, svg);
  }

  function drawQuarterRest(svg, x, topY) {
    var y = yOfMidi(71, topY);
    var p = el('path', {
      d: 'M7,-8 L-3,5 ' +
         'M-3,5 C0,7 3,10 4,13 C5,16 8,17 10,14',
      fill: 'none', stroke: '#e8edf6', 'stroke-width': 2.6, 'stroke-linecap': 'round'
    }, svg);
    p.setAttribute('transform', 'translate(' + x + ',' + y + ')');
  }

  function drawEighthRest(svg, x, topY) {
    var y = yOfMidi(71, topY);
    var p = el('path', {
      d: 'M-1,4 C3,1 6,0 8,1 C10,2 10,4 8,6 C4,8 -1,9 -2,12 ' +
         'M8,6 L7,16 C7,18 10,18 11,16',
      fill: 'none', stroke: '#e8edf6', 'stroke-width': 2.4, 'stroke-linecap': 'round'
    }, svg);
    p.setAttribute('transform', 'translate(' + x + ',' + y + ')');
  }

  /** 拍号（如 4/4） */
  function drawTimeSignature(svg, x, topY, num, den) {
    var mid = yOfMidi(71, topY); // B4 线为基准
    var t1 = el('text', { x: x, y: mid - 8, 'text-anchor': 'middle', 'font-size': 16, fill: '#e8edf6', 'font-weight': 700 }, svg);
    t1.textContent = String(num);
    var t2 = el('text', { x: x, y: mid + 12, 'text-anchor': 'middle', 'font-size': 16, fill: '#e8edf6', 'font-weight': 700 }, svg);
    t2.textContent = String(den);
  }

  function drawBarline(svg, x, topY) {
    el('line', { x1: x, y1: topY - 3, x2: x, y2: topY + LS * 4 + 3, stroke: '#e8edf6', 'stroke-width': 1.6 }, svg);
  }

  function drawFinalBarline(svg, x, topY) {
    el('line', { x1: x, y1: topY - 3, x2: x, y2: topY + LS * 4 + 3, stroke: '#e8edf6', 'stroke-width': 1.2 }, svg);
    el('line', { x1: x + 4, y1: topY - 3, x2: x + 4, y2: topY + LS * 4 + 3, stroke: '#e8edf6', 'stroke-width': 3 }, svg);
  }

  global.Notation = {
    LS: LS,
    yOfMidi: yOfMidi,
    diatonic: diatonic,
    legerYs: legerYs,
    drawStaff: drawStaff,
    drawClef: drawClef,
    drawNote: drawNote,
    drawAccidental: drawAccidental,
    drawWholeRest: drawWholeRest,
    drawHalfRest: drawHalfRest,
    drawQuarterRest: drawQuarterRest,
    drawEighthRest: drawEighthRest,
    drawTimeSignature: drawTimeSignature,
    drawBarline: drawBarline,
    drawFinalBarline: drawFinalBarline,
    el: el
  };
})(typeof self !== 'undefined' ? self : this);
