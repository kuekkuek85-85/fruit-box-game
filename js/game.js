/*
 * game.js — 사과 게임(Fruit Box) 핵심 로직
 *
 * 17열 × 10행 보드. 각 칸에 1~9 숫자. 드래그로 직사각형을 그려
 * 영역 안 남은 사과의 합이 정확히 10이면 지운다. 지운 개수만큼 득점.
 *
 * 사용:
 *   var game = new FruitBoxGame(boardEl, {
 *     cols, rows, duration, soundOn, hintLimit, seed,
 *     onScore(score), onTime(remaining), onEnd({score,duration,perfect}),
 *     onHintChange(left)
 *   });
 *   game.start();
 */
(function (global) {
  'use strict';

  var COLS = 17;
  var ROWS = 10;

  // 재현 가능한 난수 (공통 보드 모드에서 같은 seed → 같은 보드)
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function FruitBoxGame(boardEl, opts) {
    opts = opts || {};
    this.boardEl = boardEl;
    this.cols = opts.cols || COLS;
    this.rows = opts.rows || ROWS;
    this.duration = opts.duration || 120;
    this.soundOn = opts.soundOn !== false;
    this.hintLimit = opts.hintLimit != null ? opts.hintLimit : 2;
    this.seed = opts.seed; // 지정 시 공통 보드

    this.onScore = opts.onScore || function () {};
    this.onTime = opts.onTime || function () {};
    this.onEnd = opts.onEnd || function () {};
    this.onHintChange = opts.onHintChange || function () {};

    this.values = [];     // 1차원 배열, index = r*cols + c, 0 = 지워짐
    this.cells = [];      // DOM 참조
    this.score = 0;
    this.remaining = this.duration;
    this.hintsLeft = this.hintLimit;
    this.running = false;
    this.paused = false;
    this._timer = null;
    this._startTs = null;

    // 드래그 상태
    this._dragging = false;
    this._startCell = null;
    this._audioCtx = null;

    this._buildDom();
    this._bindInput();
  }

  FruitBoxGame.prototype.idx = function (r, c) { return r * this.cols + c; };

  // 구성형 보드 생성: 보드를 '합이 10인 도미노(1×2·2×1)'로 빈틈없이 덮는다.
  // 각 도미노는 두 칸이 정확히 10이므로 그 자체가 유효한 직사각형 선택이고,
  // 도미노끼리 겹치지 않으므로 어떤 순서로 지워도 전부 지울 수 있다.
  // → 모든 보드가 '완전 클리어 가능'함을 보장한다(타임어택 전제).
  // 세로(행) 길이가 짝수여야 2행 밴드로 덮을 수 있다(기본 10행).
  FruitBoxGame.prototype._generateBoard = function () {
    var rand = this.seed != null ? mulberry32(this.seed) : Math.random;
    var cols = this.cols, rows = this.rows;
    var vals = new Array(cols * rows).fill(0);
    var self = this;

    function putPair(i1, i2) {
      var a = 1 + Math.floor(rand() * 9); // 1~9
      var b = 10 - a;                     // 1~9 (보수)
      if (rand() < 0.5) { vals[i1] = a; vals[i2] = b; }
      else { vals[i1] = b; vals[i2] = a; }
    }

    for (var r = 0; r + 1 < rows; r += 2) {
      var c = 0;
      while (c < cols) {
        if (c + 1 < cols && rand() < 0.5) {
          // 가로 도미노 2개(위·아래 행)
          putPair(self.idx(r, c), self.idx(r, c + 1));
          putPair(self.idx(r + 1, c), self.idx(r + 1, c + 1));
          c += 2;
        } else {
          // 세로 도미노
          putPair(self.idx(r, c), self.idx(r + 1, c));
          c += 1;
        }
      }
    }
    // 행 수가 홀수면 마지막 한 행이 남는다(기본 10행에선 발생하지 않음).
    // 이 경우 가로 도미노로 덮되, 마지막 한 칸이 남으면 이웃과 세로로 못 묶으므로
    // 짝수 행 사용을 전제로 한다.
    return vals;
  };

  FruitBoxGame.prototype._buildDom = function () {
    this.boardEl.innerHTML = '';
    this.boardEl.style.setProperty('--cols', this.cols);
    this.boardEl.style.setProperty('--rows', this.rows);
    this.cells = [];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var cell = document.createElement('div');
        cell.className = 'apple';
        cell.dataset.r = r;
        cell.dataset.c = c;
        var span = document.createElement('span');
        cell.appendChild(span);
        this.boardEl.appendChild(cell);
        this.cells.push(cell);
      }
    }
  };

  FruitBoxGame.prototype._renderValues = function () {
    for (var i = 0; i < this.cells.length; i++) {
      var v = this.values[i];
      var cell = this.cells[i];
      cell.querySelector('span').textContent = v > 0 ? v : '';
      cell.classList.toggle('cleared', v === 0);
    }
  };

  /* --------------------------------- 입력 처리 --------------------------------- */
  FruitBoxGame.prototype._cellFromPoint = function (x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    var apple = el.closest ? el.closest('.apple') : null;
    if (!apple || apple.parentNode !== this.boardEl) return null;
    return { r: parseInt(apple.dataset.r, 10), c: parseInt(apple.dataset.c, 10) };
  };

  FruitBoxGame.prototype._bindInput = function () {
    var self = this;

    function point(ev) {
      if (ev.touches && ev.touches.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      if (ev.changedTouches && ev.changedTouches.length) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
      return { x: ev.clientX, y: ev.clientY };
    }

    function down(ev) {
      if (!self.running || self.paused) return;
      var p = point(ev);
      var cell = self._cellFromPoint(p.x, p.y);
      if (!cell) return;
      ev.preventDefault();
      self._dragging = true;
      self._startCell = cell;
      self._updateSelection(cell);
    }
    function move(ev) {
      if (!self._dragging) return;
      var p = point(ev);
      var cell = self._cellFromPoint(p.x, p.y);
      if (!cell) return;
      ev.preventDefault();
      self._updateSelection(cell);
    }
    function up(ev) {
      if (!self._dragging) return;
      ev.preventDefault();
      self._commitSelection();
      self._dragging = false;
      self._startCell = null;
    }

    this.boardEl.addEventListener('mousedown', down);
    global.addEventListener('mousemove', move);
    global.addEventListener('mouseup', up);
    this.boardEl.addEventListener('touchstart', down, { passive: false });
    this.boardEl.addEventListener('touchmove', move, { passive: false });
    global.addEventListener('touchend', up, { passive: false });
  };

  FruitBoxGame.prototype._rect = function (a, b) {
    return {
      r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r),
      c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c)
    };
  };

  FruitBoxGame.prototype._sumRect = function (rect) {
    var s = 0;
    for (var r = rect.r0; r <= rect.r1; r++) {
      for (var c = rect.c0; c <= rect.c1; c++) {
        s += this.values[this.idx(r, c)];
      }
    }
    return s;
  };

  FruitBoxGame.prototype._updateSelection = function (cur) {
    var rect = this._rect(this._startCell, cur);
    var sum = this._sumRect(rect);
    var valid = sum === 10;
    for (var i = 0; i < this.cells.length; i++) {
      var r = Math.floor(i / this.cols), c = i % this.cols;
      var inside = r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
      var cell = this.cells[i];
      cell.classList.toggle('selected', inside);
      cell.classList.toggle('valid', inside && valid);
    }
  };

  FruitBoxGame.prototype._clearSelectionClasses = function () {
    for (var i = 0; i < this.cells.length; i++) {
      this.cells[i].classList.remove('selected', 'valid');
    }
  };

  FruitBoxGame.prototype._commitSelection = function () {
    var rect = this._rect(this._startCell, this._startCell);
    // 현재 선택 사각형 재계산 (마지막 move 가 반영된 selected 클래스 기준)
    var r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity, any = false;
    for (var i = 0; i < this.cells.length; i++) {
      if (this.cells[i].classList.contains('selected')) {
        any = true;
        var r = Math.floor(i / this.cols), c = i % this.cols;
        if (r < r0) r0 = r; if (r > r1) r1 = r;
        if (c < c0) c0 = c; if (c > c1) c1 = c;
      }
    }
    if (any) {
      rect = { r0: r0, r1: r1, c0: c0, c1: c1 };
      if (this._sumRect(rect) === 10) {
        this._applyClear(rect);
      }
    }
    this._clearSelectionClasses();
  };

  FruitBoxGame.prototype._applyClear = function (rect) {
    var count = 0;
    for (var r = rect.r0; r <= rect.r1; r++) {
      for (var c = rect.c0; c <= rect.c1; c++) {
        var i = this.idx(r, c);
        if (this.values[i] > 0) {
          this.values[i] = 0;
          this.cells[i].classList.add('pop');
          var cellEl = this.cells[i];
          (function (el) { setTimeout(function () { el.classList.remove('pop'); }, 220); })(cellEl);
          count++;
        }
      }
    }
    this.score += count;
    this._renderValues();
    this.onScore(this.score);
    this._beep(660, 0.06);
    // 퍼펙트 클리어는 현재 보드에 남은 사과가 0일 때로 판정한다.
    // (누적 점수 기준이면 '새 보드'로 점수를 유지한 채 보드를 갈았을 때
    //  보드가 가득 찼는데도 게임이 끝나는 오판이 생긴다.)
    if (this._remainingCount() === 0) {
      this._end(true);
    }
  };

  FruitBoxGame.prototype._remainingCount = function () {
    var n = 0;
    for (var i = 0; i < this.values.length; i++) {
      if (this.values[i] > 0) n++;
    }
    return n;
  };

  /* --------------------------------- 보조 기능 --------------------------------- */
  // 유효한 직사각형 하나 탐색 (힌트용). 작은 영역 우선.
  FruitBoxGame.prototype.findValidRect = function () {
    for (var r0 = 0; r0 < this.rows; r0++) {
      for (var c0 = 0; c0 < this.cols; c0++) {
        // 빈칸(0)도 사각형의 좌상단 기준점이 될 수 있다. 사과가 지워진 뒤에는
        // 좌상단 모서리가 빈칸인 유효 사각형이 생길 수 있으므로 건너뛰지 않는다.
        for (var r1 = r0; r1 < this.rows; r1++) {
          for (var c1 = c0; c1 < this.cols; c1++) {
            // 사각형 (r0..r1, c0..c1) 합을 매번 계산 (보드가 작아 비용 허용)
            var s = this._sumRect({ r0: r0, r1: r1, c0: c0, c1: c1 });
            if (s === 10) return { r0: r0, r1: r1, c0: c0, c1: c1 };
            if (s > 10 && this._minRectVal(r0, r1, c0, c1) > 0) {
              // 모두 양수면 더 넓혀도 합이 줄지 않음 → 열 확장 중단
              break;
            }
          }
        }
      }
    }
    return null;
  };

  FruitBoxGame.prototype._minRectVal = function (r0, r1, c0, c1) {
    // 사각형 안에 0(빈칸)이 하나라도 있으면 0 반환, 아니면 1 이상
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        if (this.values[this.idx(r, c)] === 0) return 0;
      }
    }
    return 1;
  };

  FruitBoxGame.prototype.useHint = function () {
    if (!this.running || this.paused || this.hintsLeft <= 0) return false;
    var rect = this.findValidRect();
    if (!rect) return false;
    this.hintsLeft--;
    this.onHintChange(this.hintsLeft);
    var self = this;
    for (var r = rect.r0; r <= rect.r1; r++) {
      for (var c = rect.c0; c <= rect.c1; c++) {
        this.cells[this.idx(r, c)].classList.add('hint');
      }
    }
    setTimeout(function () {
      for (var i = 0; i < self.cells.length; i++) self.cells[i].classList.remove('hint');
    }, 1500);
    return true;
  };

  FruitBoxGame.prototype.newBoard = function () {
    this.values = this._generateBoard();
    this._renderValues();
  };

  /* --------------------------------- 타이머/상태 --------------------------------- */
  FruitBoxGame.prototype.start = function () {
    this.values = this._generateBoard();
    this._renderValues();
    this.score = 0;
    this.remaining = this.duration;
    this.hintsLeft = this.hintLimit;
    this.running = true;
    this.paused = false;
    this._startTs = Date.now();
    this.onScore(0);
    this.onTime(this.remaining);
    this.onHintChange(this.hintsLeft);
    this._tick();
  };

  FruitBoxGame.prototype._tick = function () {
    var self = this;
    clearInterval(this._timer);
    this._timer = setInterval(function () {
      if (self.paused) return;
      self.remaining--;
      self.onTime(self.remaining);
      if (self.remaining <= 0) self._end(false);
    }, 1000);
  };

  FruitBoxGame.prototype.pause = function () {
    if (!this.running) return;
    this.paused = !this.paused;
    return this.paused;
  };

  FruitBoxGame.prototype._end = function (perfect) {
    if (!this.running) return;
    this.running = false;
    clearInterval(this._timer);
    this._clearSelectionClasses();
    var elapsed = Math.min(this.duration, Math.round((Date.now() - this._startTs) / 1000));
    var durationSec = perfect ? elapsed : this.duration;
    this.onEnd({ score: this.score, duration: durationSec, perfect: perfect });
    this._beep(perfect ? 880 : 330, 0.2);
  };

  FruitBoxGame.prototype.stop = function () {
    this.running = false;
    clearInterval(this._timer);
  };

  FruitBoxGame.prototype.setSound = function (on) { this.soundOn = on; };

  /* --------------------------------- 효과음 --------------------------------- */
  FruitBoxGame.prototype._beep = function (freq, dur) {
    if (!this.soundOn) return;
    try {
      if (!this._audioCtx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        this._audioCtx = new AC();
      }
      var ctx = this._audioCtx;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.value = 0.08;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.stop(ctx.currentTime + dur);
    } catch (e) { /* 오디오 미지원 무시 */ }
  };

  FruitBoxGame.COLS = COLS;
  FruitBoxGame.ROWS = ROWS;
  global.FruitBoxGame = FruitBoxGame;
})(window);
