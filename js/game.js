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
    this.sizes = opts.sizes || [2]; // 단계별 허용 묶음 크기 집합(난이도)
    this.duration = opts.duration || 120;
    this.soundOn = opts.soundOn !== false;
    this.hintLimit = opts.hintLimit != null ? opts.hintLimit : 2;
    this.seed = opts.seed; // 지정 시 공통 보드
    this.countdownEl = opts.countdownEl || null; // 시작 카운트다운 오버레이
    this._countTimer = null;
    this._starting = false; // 카운트다운 진행 중 여부

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
    this._history = []; // 되돌리기용 스냅샷 스택

    // 드래그 상태
    this._dragging = false;
    this._startCell = null;
    this._audioCtx = null;

    this._buildDom();
    this._bindInput();
  }

  FruitBoxGame.prototype.idx = function (r, c) { return r * this.cols + c; };

  // 구성형 보드 생성: 각 행을 '합이 10인 가로 묶음'들로 빈틈없이 채운다.
  // 각 묶음은 그 자체가 유효한 직사각형(1×k, 합 10)이라 항상 전부 지울 수 있고
  // (완전 클리어 보장, 타임어택 전제), 단계가 오를수록 허용 묶음 크기(this.sizes)가
  // 커져 더 큰 조합을 찾아야 하므로 복잡도가 올라간다.
  // 선택 판정은 '합이 10'이기만 하면 되므로(개수 무관), 빈칸을 가로질러 떨어져
  // 있는 사과끼리 묶는 것도 가능하다(_isValidRect 참고).
  FruitBoxGame.prototype._generateBoard = function () {
    var rand = this.seed != null ? mulberry32(this.seed) : Math.random;
    var cols = this.cols, rows = this.rows;
    var vals = new Array(cols * rows).fill(0);
    var self = this;
    var sizes = (this.sizes && this.sizes.length) ? this.sizes : [2];

    // 합이 10이 되는 k개의 값(각 1~9) 생성
    function compose(k) {
      var a = new Array(k).fill(1);
      var rem = 10 - k;
      while (rem > 0) {
        var i = Math.floor(rand() * k);
        if (a[i] < 9) { a[i]++; rem--; }
      }
      return a;
    }
    function shuffle(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
    // 길이 L 을 sizes 값들로 분할(합이 정확히 L). 랜덤 순서 + 백트래킹.
    function partition(L) {
      function build(rem) {
        if (rem === 0) return [];
        var order = shuffle(sizes.slice());
        for (var i = 0; i < order.length; i++) {
          var s = order[i];
          if (s <= rem) {
            var rest = build(rem - s);
            if (rest) return [s].concat(rest);
          }
        }
        return null;
      }
      return build(L) || [L];
    }

    for (var r = 0; r < rows; r++) {
      var seg = partition(cols);
      var c = 0;
      for (var si = 0; si < seg.length; si++) {
        var k = seg[si];
        var parts = shuffle(compose(k));
        for (var m = 0; m < k; m++) { vals[self.idx(r, c)] = parts[m]; c++; }
      }
    }
    return vals;
  };

  // 단계 전환: 보드 크기·허용 묶음 크기를 바꾸고 DOM을 다시 만든다.
  FruitBoxGame.prototype.configure = function (cols, rows, sizes) {
    this.cols = cols;
    this.rows = rows;
    this.sizes = sizes;
    this._buildDom();
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

  // 유효한 선택: 직사각형 안 남은 사과의 합이 정확히 10이면 된다(개수 무관).
  // 빈칸(지워진 칸)은 0으로 세므로, 떨어져 있는 사과끼리도 사각형으로 묶을 수 있다.
  FruitBoxGame.prototype._isValidRect = function (rect) {
    return this._sumRect(rect) === 10;
  };

  FruitBoxGame.prototype._updateSelection = function (cur) {
    var rect = this._rect(this._startCell, cur);
    var valid = this._isValidRect(rect);
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
      if (this._isValidRect(rect)) {
        this._applyClear(rect);
      }
    }
    this._clearSelectionClasses();
  };

  FruitBoxGame.prototype._applyClear = function (rect) {
    // 되돌리기용으로 지우기 직전 상태를 저장
    this._history.push({ values: this.values.slice(), score: this.score });
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
            var rect = { r0: r0, r1: r1, c0: c0, c1: c1 };
            var s = this._sumRect(rect);
            if (this._isValidRect(rect)) return rect; // 합이 10이면 유효
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

  // 되돌리기: 직전에 지운 상태로 복원(막혔을 때 다른 순서로 재시도).
  FruitBoxGame.prototype.undo = function () {
    if (!this.running || this.paused || !this._history.length) return false;
    var snap = this._history.pop();
    this.values = snap.values;
    this.score = snap.score;
    this._clearSelectionClasses();
    this._renderValues();
    this.onScore(this.score);
    return true;
  };

  FruitBoxGame.prototype.canUndo = function () {
    return this.running && !this.paused && this._history.length > 0;
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
    this._history = [];
    this.running = false; // 카운트다운 동안 입력·타이머 정지
    this.paused = false;
    this._starting = true;
    this.onScore(0);
    this.onTime(this.remaining);
    this.onHintChange(this.hintsLeft);
    var self = this;
    this._countdown(function () {
      self._starting = false;
      self.running = true;
      self._startTs = Date.now(); // 소요 시간은 카운트다운 이후부터
      self._tick();
    });
  };

  // 시작 전 3·2·1·시작! 을 크게 보여준 뒤 done() 호출.
  FruitBoxGame.prototype._countdown = function (done) {
    clearTimeout(this._countTimer);
    var el = this.countdownEl;
    if (!el) { done(); return; } // 오버레이 없으면 즉시 시작
    var seq = ['3', '2', '1', '시작!'];
    var self = this;
    var i = 0;
    el.hidden = false;
    function step() {
      if (i >= seq.length) {
        el.hidden = true;
        el.classList.remove('go');
        done();
        return;
      }
      el.textContent = seq[i];
      el.classList.toggle('go', seq[i] === '시작!');
      // 애니메이션 재시작
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      self._beep(i < 3 ? 520 : 880, 0.12);
      i++;
      self._countTimer = setTimeout(step, i <= 3 ? 700 : 500);
    }
    step();
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
    if (!this.running && !this._starting) return;
    if (this._starting) {
      // 카운트다운 중 종료(그만두기) 요청: 대기 중인 시작을 취소
      clearTimeout(this._countTimer);
      this._starting = false;
      if (this.countdownEl) { this.countdownEl.hidden = true; this.countdownEl.classList.remove('go'); }
    }
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
    this._starting = false;
    clearInterval(this._timer);
    clearTimeout(this._countTimer);
    if (this.countdownEl) { this.countdownEl.hidden = true; this.countdownEl.classList.remove('go'); }
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
