/*
 * student.js — 학생 화면 흐름: 식별 → 게임 → 결과
 */
(function () {
  'use strict';

  var LAST_KEY = 'fruitbox.lastStudent';
  var SETTINGS_KEY = 'fruitbox.settings';
  var DURATION = 180; // 타임어택: 제한 시간 180초 고정
  var MODE = '타임어택 3단계'; // 이 버전의 기록 모드(이전 버전 기록과 분리)

  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    identify: $('screen-identify'),
    ranking: $('screen-ranking'),
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
      }
    } catch (e) {}
  })();

  Storage.ready().then(function () {
    $('backendNote').textContent = Storage.backendName() === 'firebase'
      ? '저장소: Firebase (여러 기기 기록이 모입니다)'
      : '저장소: 이 기기 (localStorage) — 다른 기기 기록은 합쳐지지 않습니다';
  });

  var current = null; // { student_no, name }
  var game = null;

  function fmtSec(s) { return (Math.round(s * 10) / 10) + ''; }

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

  // 타임어택 개인 기록: 완전 클리어한 적이 있으면 그 최단 소요시간(초),
  // 없으면 null. 조회 실패 시 null 로 폴백해 저장 경로를 막지 않는다.
  function bestClearTimeFor(studentNo) {
    return Storage.getAllRecords().then(function (records) {
      var best = null;
      records.forEach(function (r) {
        if (r.student_no === studentNo && r.cleared && r.mode === MODE &&
            (best === null || r.duration_sec < best)) {
          best = r.duration_sec;
        }
      });
      return best;
    }).catch(function () { return null; });
  }

  // 3단계 구성: 단계별 보드 크기와 묶음 크기(합이 10인 칸 수)
  var STAGES = [
    { cols: 17, rows: 10, groupSize: 2 }, // 1단계: 2개
    { cols: 18, rows: 10, groupSize: 3 }, // 2단계: 3개
    { cols: 16, rows: 10, groupSize: 4 }  // 3단계: 4개
  ];

  // 한 판(run) 상태
  var stageIndex = 0;
  var runElapsed = 0; // 지금까지 단계들의 소요 시간 합(초)
  var runScore = 0;   // 지금까지 지운 사과 수 합
  var stageTimes = []; // 각 단계를 깬 소요 시간(초). index=단계-1, 깬 단계만 채워짐

  function startGame() {
    var id = validateIdentity();
    if (!id) return;
    current = { student_no: id.no, name: id.name };

    // 공용 기기 대응: 직전 입력값 기억
    try { localStorage.setItem(LAST_KEY, JSON.stringify({
      student_no: id.no, name: id.name
    })); } catch (e) {}

    $('whoName').textContent = id.name;
    $('whoNo').textContent = id.no;

    bestClearTimeFor(id.no).then(function (t) {
      $('best').textContent = t === null ? '—' : fmtSec(t) + '초';
    });

    var opts = {
      duration: DURATION,
      soundOn: settings.sound !== false,
      hintLimit: 2,
      onScore: function (s) {
        $('score').textContent = s;
        $('btnUndo').disabled = !(game && game.canUndo());
      },
      onTime: function (t) {
        $('timer').textContent = Math.max(0, t);
        $('timerStat').classList.toggle('warn', t <= 10);
      },
      onHintChange: function (left) {
        $('hintLeft').textContent = left;
        $('btnHint').disabled = left <= 0;
      },
      onEnd: onStageEnd,
      countdownEl: $('countdown') // 단계 시작 전 3·2·1 카운트다운
      // 시드 미지정 → 매 단계 랜덤 보드(구성형 생성기로 항상 완전 클리어 가능)
    };

    if (game) game.stop();
    game = new FruitBoxGame($('board'), opts);

    // 새 판 시작: 단계·누적값 초기화 후 1단계부터
    stageIndex = 0;
    runElapsed = 0;
    runScore = 0;
    stageTimes = [];
    startStage(0);

    syncSoundButton();
    show('game');
  }

  function startStage(i) {
    var s = STAGES[i];
    $('stage').textContent = i + 1;
    $('scoreTotal').textContent = s.cols * s.rows;
    game.configure(s.cols, s.rows, s.groupSize);
    game.start();
  }

  // 각 단계 종료 처리. 단계를 전부 지웠으면(perfect) 다음 단계로,
  // 마지막 단계까지 지웠으면 완전 클리어. 시간 초과면 판 종료.
  function onStageEnd(result) {
    runElapsed += result.duration;
    runScore += result.score;
    if (result.perfect) stageTimes[stageIndex] = result.duration; // 이 단계 클리어 시간 기록

    if (result.perfect && stageIndex < STAGES.length - 1) {
      stageIndex++;
      startStage(stageIndex);
      return;
    }
    var cleared = result.perfect && stageIndex === STAGES.length - 1;
    finishRun(cleared, runElapsed, runScore, stageIndex);
  }

  /* ------------------------------- 순위(학생용) ------------------------------- */
  var rankStage = 1; // 현재 보고 있는 단계(1/2/3)

  // 선택 단계를 가장 빨리 깬 순으로 집계(학생당 그 단계 최고 기록 1건).
  // stageTimes[단계-1] 이 있는 기록만 사용(그 단계를 깬 학생).
  function stageRanking(records, k) {
    var best = {};
    (records || []).forEach(function (r) {
      if (r.mode !== MODE || !r.stageTimes) return;
      var t = r.stageTimes[k - 1];
      if (t == null) return;
      var cur = best[r.student_no];
      if (!cur || t < cur.time) best[r.student_no] = { name: r.name, no: r.student_no, time: t };
    });
    return Object.keys(best).map(function (key) { return best[key]; })
      .sort(function (a, b) { return a.time - b.time; }).slice(0, 20);
  }

  function renderRanking() {
    [1, 2, 3].forEach(function (k) {
      $('rankStage' + k).classList.toggle('active', k === rankStage);
    });
    var ol = $('studentRankList');
    ol.innerHTML = '<li class="sub">불러오는 중…</li>';
    Storage.getAllRecords().then(function (records) {
      var list = stageRanking(records, rankStage);
      ol.innerHTML = '';
      if (!list.length) {
        ol.innerHTML = '<li class="sub">아직 ' + rankStage + '단계 기록이 없어요. 첫 기록의 주인공이 되어보세요!</li>';
        return;
      }
      list.forEach(function (s, i) {
        var li = document.createElement('li');
        var pos = document.createElement('span');
        pos.className = 'pos'; pos.textContent = (i + 1);
        var nm = document.createElement('span');
        nm.className = 'nm'; nm.textContent = s.name;
        var sub = document.createElement('span');
        sub.className = 'sub'; sub.textContent = ' ' + s.no;
        nm.appendChild(sub);
        var sc = document.createElement('span');
        sc.className = 'sc'; sc.textContent = fmtSec(s.time) + '초';
        li.appendChild(pos); li.appendChild(nm); li.appendChild(sc);
        ol.appendChild(li);
      });
    }).catch(function () {
      ol.innerHTML = '<li class="sub">순위를 불러오지 못했어요.</li>';
    });
  }

  [1, 2, 3].forEach(function (k) {
    $('rankStage' + k).addEventListener('click', function () {
      rankStage = k;
      renderRanking();
    });
  });

  $('btnRanking').addEventListener('click', function () {
    renderRanking();
    show('ranking');
  });
  $('btnRankBack').addEventListener('click', function () { show('identify'); });

  /* ------------------------------- 게임 컨트롤 ------------------------------- */
  $('btnStart').addEventListener('click', startGame);
  $('studentName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') startGame();
  });

  $('btnHint').addEventListener('click', function () {
    if (game && !game.useHint()) {
      // 유효한 수가 없으면 사용자에게 알림
      if (game.findValidRect() === null) alert('지금 지울 수 있는 조합이 없어요.');
    }
  });
  $('btnUndo').addEventListener('click', function () {
    if (game) game.undo();
  });
  $('btnPause').addEventListener('click', function () {
    if (!game) return;
    var paused = game.pause();
    $('btnPause').textContent = paused ? '▶ 재개' : '⏸ 일시정지';
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

  // 한 판(3단계) 종료 처리 및 기록 저장.
  function finishRun(cleared, totalSec, totalScore, reachedIdx) {
    show('result');
    $('finalLabel').textContent = cleared ? '총 클리어 시간(초)' : '시간 종료 · 점수';
    $('finalScore').textContent = cleared ? fmtSec(totalSec) : totalScore;
    $('finalDuration').textContent = fmtSec(totalSec);

    var record = {
      id: Storage.newId(),
      student_no: current.student_no,
      name: current.name,
      score: totalScore,
      duration_sec: totalSec,
      cleared: cleared,
      stage: reachedIdx + 1, // 도달(마지막으로 플레이한) 단계
      stageTimes: stageTimes.slice(), // 단계별 클리어 시간(단계별 순위용)
      mode: MODE,
      played_at: new Date().toISOString(),
      session: localStorage.getItem('fruitbox.session') || ''
    };

    bestClearTimeFor(current.student_no).then(function (prevBest) {
      var note = $('savingNote');
      note.className = 'saving';
      note.textContent = '기록 저장 중…';

      saveWithRetry(record).then(function () {
        note.className = 'saving ok';
        note.textContent = '기록이 저장되었습니다.';
        var newBest = cleared
          ? (prevBest === null ? totalSec : Math.min(prevBest, totalSec))
          : prevBest;
        $('finalBest').textContent = newBest === null ? '—' : fmtSec(newBest);
        var fb = $('feedback');
        if (cleared && (prevBest === null || totalSec < prevBest)) {
          fb.className = 'fb record';
          fb.textContent = '🏆 최단 기록 경신! 3단계를 ' + fmtSec(totalSec) + '초 만에 모두 클리어!';
        } else if (cleared) {
          fb.className = 'fb record';
          fb.textContent = '🎉 3단계 모두 클리어! 총 ' + fmtSec(totalSec) + '초 (최단 기록 ' + fmtSec(newBest) + '초)';
        } else {
          fb.className = 'fb';
          fb.textContent = (reachedIdx + 1) + '단계에서 시간 종료! 총 ' + totalScore + '개 지웠어요. 3단계까지 모두 지우면 기록이 남아요.';
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
