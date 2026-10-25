/*
 * student.js — 학생 화면 흐름: 식별 → 게임 → 결과
 */
(function () {
  'use strict';

  var LAST_KEY = 'fruitbox.lastStudent';
  var SETTINGS_KEY = 'fruitbox.settings';
  var COMMON_SEED_KEY = 'fruitbox.commonSeed'; // 교사가 대시보드에서 지정 가능

  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    identify: $('screen-identify'),
    game: $('screen-game'),
    result: $('screen-result')
  };
  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('active', k === name);
    });
  }

  /* ----------------------------- 설정(효과음/색상) ----------------------------- */
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  var settings = loadSettings();
  if (settings.soft) document.body.classList.add('soft');

  /* ------------------------------- 식별 화면 ------------------------------- */
  (function restoreLast() {
    try {
      var last = JSON.parse(localStorage.getItem(LAST_KEY));
      if (last) {
        $('studentNo').value = last.student_no || '';
        $('studentName').value = last.name || '';
        if (last.mode) $('mode').value = last.mode;
        if (last.duration) $('duration').value = String(last.duration);
      }
    } catch (e) {}
  })();

  Storage.ready().then(function () {
    $('backendNote').textContent = Storage.backendName() === 'firebase'
      ? '저장소: Firebase (여러 기기 기록이 모입니다)'
      : '저장소: 이 기기 (localStorage) — 다른 기기 기록은 합쳐지지 않습니다';
  });

  var current = null; // { student_no, name, mode, duration }
  var game = null;

  function validateIdentity() {
    var no = $('studentNo').value.trim();
    var name = $('studentName').value.trim();
    var ok = true;
    $('errNo').textContent = '';
    $('errName').textContent = '';
    if (!/^\d{5}$/.test(no)) {
      $('errNo').textContent = '학번은 숫자 5자리여야 합니다.';
      ok = false;
    }
    if (name.length === 0) {
      $('errName').textContent = '성명을 입력하세요.';
      ok = false;
    } else if (name.length > 10) {
      $('errName').textContent = '성명은 최대 10자입니다.';
      ok = false;
    }
    return ok ? { no: no, name: name } : null;
  }

  function bestScoreFor(studentNo) {
    return Storage.getAllRecords().then(function (records) {
      var best = 0;
      records.forEach(function (r) {
        if (r.student_no === studentNo && r.score > best) best = r.score;
      });
      return best;
    }).catch(function () {
      // 최고기록 조회 실패(네트워크·권한 등)가 결과 저장을 막으면 안 된다.
      // 0 으로 폴백해 saveWithRetry 경로(및 재저장 버튼)를 항상 보장한다.
      return 0;
    });
  }

  function commonSeed() {
    var saved = localStorage.getItem(COMMON_SEED_KEY);
    if (saved) return parseInt(saved, 10) >>> 0;
    // 지정값이 없으면 오늘 날짜 기반(참고 서비스의 '일일 도전'을 교실용으로)
    var d = new Date();
    return parseInt('' + d.getFullYear() + (d.getMonth() + 1) + d.getDate(), 10) >>> 0;
  }

  function startGame() {
    var id = validateIdentity();
    if (!id) return;
    var mode = $('mode').value;
    var duration = parseInt($('duration').value, 10);
    current = { student_no: id.no, name: id.name, mode: mode, duration: duration };

    // 공용 기기 대응: 직전 입력값 기억
    try { localStorage.setItem(LAST_KEY, JSON.stringify({
      student_no: id.no, name: id.name, mode: mode, duration: duration
    })); } catch (e) {}

    $('whoName').textContent = id.name;
    $('whoNo').textContent = id.no;

    bestScoreFor(id.no).then(function (best) {
      $('best').textContent = best;
    });

    var opts = {
      duration: duration,
      soundOn: settings.sound !== false,
      hintLimit: 2,
      onScore: function (s) { $('score').textContent = s; },
      onTime: function (t) {
        $('timer').textContent = Math.max(0, t);
        $('timerStat').classList.toggle('warn', t <= 10);
      },
      onHintChange: function (left) {
        $('hintLeft').textContent = left;
        $('btnHint').disabled = left <= 0;
      },
      onEnd: finishGame
    };
    if (mode === 'common') opts.seed = commonSeed();

    if (game) game.stop();
    game = new FruitBoxGame($('board'), opts);
    game.start();

    syncSoundButton();
    show('game');
  }

  /* ------------------------------- 게임 컨트롤 ------------------------------- */
  $('btnStart').addEventListener('click', startGame);
  $('studentName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') startGame();
  });

  $('btnHint').addEventListener('click', function () {
    if (game && !game.useHint()) {
      // 유효한 수가 없으면 사용자에게 알림
      if (game.findValidRect() === null) alert('지금 지울 수 있는 조합이 없어요. 새 보드를 눌러보세요!');
    }
  });
  $('btnPause').addEventListener('click', function () {
    if (!game) return;
    var paused = game.pause();
    $('btnPause').textContent = paused ? '▶ 재개' : '⏸ 일시정지';
  });
  $('btnNew').addEventListener('click', function () {
    if (game && confirm('새 보드로 바꿀까요? (점수는 유지됩니다)')) game.newBoard();
  });
  $('btnQuit').addEventListener('click', function () {
    if (game && confirm('게임을 종료하고 결과를 제출할까요?')) game._end(false);
  });

  function syncSoundButton() {
    var on = settings.sound !== false;
    $('btnSound').textContent = on ? '🔊 효과음' : '🔇 효과음';
  }
  $('btnSound').addEventListener('click', function () {
    settings.sound = settings.sound === false ? true : false;
    saveSettings(settings);
    if (game) game.setSound(settings.sound !== false);
    syncSoundButton();
  });
  $('btnSoft').addEventListener('click', function () {
    settings.soft = !document.body.classList.contains('soft');
    document.body.classList.toggle('soft', settings.soft);
    saveSettings(settings);
  });

  /* ------------------------------- 결과 처리 ------------------------------- */
  function saveWithRetry(record, attempt) {
    attempt = attempt || 0;
    return Storage.saveRecord(record).catch(function (err) {
      if (attempt >= 3) throw err;
      var delay = Math.pow(2, attempt) * 500; // 0.5s, 1s, 2s
      return new Promise(function (resolve) { setTimeout(resolve, delay); })
        .then(function () { return saveWithRetry(record, attempt + 1); });
    });
  }

  function finishGame(result) {
    show('result');
    $('finalScore').textContent = result.score;
    $('finalDuration').textContent = result.duration;

    var record = {
      id: Storage.newId(),
      student_no: current.student_no,
      name: current.name,
      score: result.score,
      duration_sec: result.duration,
      mode: current.mode === 'common' ? '공통 보드' : '클래식',
      played_at: new Date().toISOString(),
      session: localStorage.getItem('fruitbox.session') || ''
    };

    bestScoreFor(current.student_no).then(function (prevBest) {
      var note = $('savingNote');
      note.className = 'saving';
      note.textContent = '기록 저장 중…';

      saveWithRetry(record).then(function () {
        note.className = 'saving ok';
        note.textContent = '기록이 저장되었습니다.';
        var newBest = Math.max(prevBest, result.score);
        $('finalBest').textContent = newBest;
        var fb = $('feedback');
        if (result.perfect) {
          fb.className = 'fb record';
          fb.textContent = '🎉 퍼펙트 클리어! 모든 사과를 지웠어요!';
        } else if (result.score > prevBest) {
          fb.className = 'fb record';
          fb.textContent = '🏆 최고 기록 경신! (이전 ' + prevBest + '점)';
        } else {
          fb.className = 'fb';
          fb.textContent = '수고했어요! 최고 기록은 ' + newBest + '점이에요.';
        }
      }).catch(function (err) {
        console.error('기록 저장 실패:', err);
        note.className = 'saving err';
        note.textContent = '저장에 실패했습니다. 네트워크 확인 후 "다시 저장"을 눌러주세요.';
        // 재시도 버튼 제공
        if (!$('btnRetrySave')) {
          var b = document.createElement('button');
          b.id = 'btnRetrySave';
          b.textContent = '다시 저장';
          b.style.marginTop = '8px';
          b.addEventListener('click', function () {
            note.className = 'saving';
            note.textContent = '다시 저장 중…';
            saveWithRetry(record).then(function () {
              note.className = 'saving ok';
              note.textContent = '기록이 저장되었습니다.';
              b.remove();
            }).catch(function () {
              note.className = 'saving err';
              note.textContent = '여전히 저장에 실패했습니다.';
            });
          });
          note.parentNode.appendChild(b);
        }
        $('finalBest').textContent = Math.max(prevBest, result.score);
      });
    });
  }

  $('btnAgain').addEventListener('click', function () {
    $('btnPause').textContent = '⏸ 일시정지';
    startGame();
  });
  $('btnChange').addEventListener('click', function () {
    if (game) game.stop();
    show('identify');
  });
})();
