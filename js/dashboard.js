/*
 * dashboard.js — 교사 대시보드
 * 학번·성명 기준 집계, 순위, 반별 통계, 분포, 필터·정렬·검색, CSV, 초기화.
 *
 * 비밀번호는 window.TEACHER_PASSWORD (firebase-config.js 에서 지정) 또는 기본값 'teacher'.
 * 주의: 클라이언트 측 게이트이므로 완전한 보안이 아니라 '학생 접근 차단' 용도입니다.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var PW = window.TEACHER_PASSWORD || 'teacher';
  var COMMON_SEED_KEY = 'fruitbox.commonSeed';

  /* ------------------------------- 게이트 ------------------------------- */
  function enter() {
    $('gate').classList.remove('active');
    $('dash').classList.add('active');
    init();
  }
  if (sessionStorage.getItem('fruitbox.teacher') === '1') {
    enter();
  }
  $('gateBtn').addEventListener('click', tryEnter);
  $('gatePw').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryEnter(); });
  function tryEnter() {
    if ($('gatePw').value === PW) {
      sessionStorage.setItem('fruitbox.teacher', '1');
      enter();
    } else {
      $('gateErr').textContent = '비밀번호가 올바르지 않습니다.';
    }
  }

  /* ------------------------------- 상태 ------------------------------- */
  var records = [];
  var sortKey = 'best';
  var sortDir = -1; // -1 내림차순, 1 오름차순

  function init() {
    Storage.ready().then(function () {
      $('dashBackend').textContent = Storage.backendName() === 'firebase'
        ? 'Firebase 연결됨 (실시간)' : '로컬 저장소 (이 기기)';
    });
    Storage.onChange(refresh);
    refresh();

    $('search').addEventListener('input', render);
    $('filterGrade').addEventListener('change', function () { populateClassFilter(); render(); });
    $('filterClass').addEventListener('change', render);
    $('btnCsv').addEventListener('click', exportCsv);
    $('btnReset').addEventListener('click', resetAll);
    $('btnCommonSeed').addEventListener('click', setCommonSeed);

    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = (k === 'name' || k === 'student_no' || k === 'classKey') ? 1 : -1; }
        render();
      });
    });
  }

  function refresh() {
    Storage.getAllRecords().then(function (all) {
      records = all || [];
      populateGradeFilter();
      populateClassFilter();
      render();
    });
  }

  /* --------------------------- 집계: 학생별 요약 --------------------------- */
  function aggregateStudents(recs) {
    var map = {};
    recs.forEach(function (r) {
      var key = r.student_no;
      if (!map[key]) {
        var p = Storage.parseStudentNo(r.student_no);
        map[key] = {
          student_no: r.student_no,
          name: r.name,
          grade: p.grade, classNo: p.classNo, number: p.number,
          classKey: p.grade * 100 + p.classNo,
          best: 0, plays: 0, last: 0, bestDuration: Infinity
        };
      }
      var s = map[key];
      s.name = r.name; // 최신 제출 이름 반영
      s.plays += 1;
      var t = new Date(r.played_at).getTime() || 0;
      if (t > s.last) s.last = t;
      if (r.score > s.best || (r.score === s.best && r.duration_sec < s.bestDuration)) {
        s.best = r.score;
        s.bestDuration = r.duration_sec;
      }
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /* ------------------------------- 필터 옵션 ------------------------------- */
  function populateGradeFilter() {
    var grades = {};
    records.forEach(function (r) { grades[Storage.parseStudentNo(r.student_no).grade] = true; });
    var sel = $('filterGrade'), cur = sel.value;
    sel.innerHTML = '<option value="">전체 학년</option>';
    Object.keys(grades).sort().forEach(function (g) {
      sel.innerHTML += '<option value="' + g + '">' + g + '학년</option>';
    });
    sel.value = cur;
  }
  function populateClassFilter() {
    var g = $('filterGrade').value;
    var classes = {};
    records.forEach(function (r) {
      var p = Storage.parseStudentNo(r.student_no);
      if (!g || String(p.grade) === g) classes[p.classNo] = true;
    });
    var sel = $('filterClass'), cur = sel.value;
    sel.innerHTML = '<option value="">전체 반</option>';
    Object.keys(classes).sort(function (a, b) { return a - b; }).forEach(function (c) {
      sel.innerHTML += '<option value="' + c + '">' + c + '반</option>';
    });
    sel.value = cur;
  }

  function applyFilters(students) {
    var q = $('search').value.trim().toLowerCase();
    var g = $('filterGrade').value;
    var c = $('filterClass').value;
    return students.filter(function (s) {
      if (g && String(s.grade) !== g) return false;
      if (c && String(s.classNo) !== c) return false;
      if (q && s.name.toLowerCase().indexOf(q) < 0 && s.student_no.indexOf(q) < 0) return false;
      return true;
    });
  }

  /* ------------------------------- 렌더 ------------------------------- */
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function render() {
    var students = aggregateStudents(records);
    var filtered = applyFilters(students);

    renderSummary(students, filtered);
    renderTable(filtered);
    renderRank(filtered);
    renderClasses(filtered);
    renderDist(filtered);
    updateSortArrows();
  }

  function renderSummary(all, filtered) {
    var totalPlays = records.length;
    var participants = all.length;
    var scores = [];
    records.forEach(function (r) { scores.push(r.score); });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : 0;
    var max = scores.length ? Math.max.apply(null, scores) : 0;
    $('summary').innerHTML =
      stat('참여 학생', participants + '명') +
      stat('총 플레이', totalPlays + '회') +
      stat('평균 점수', avg) +
      stat('최고 점수', max);
  }
  function stat(k, v) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function renderTable(students) {
    var sorted = students.slice().sort(cmp);
    var body = $('recordBody');
    body.innerHTML = '';
    $('tableEmpty').style.display = sorted.length ? 'none' : 'block';
    $('rowCount').textContent = sorted.length + '명 표시';
    sorted.forEach(function (s) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(s.student_no) + '</td>' +
        '<td>' + esc(s.name) + '</td>' +
        '<td>' + s.grade + '학년 ' + s.classNo + '반 ' + s.number + '번</td>' +
        '<td class="num">' + s.best + '</td>' +
        '<td class="num">' + s.plays + '</td>' +
        '<td>' + fmtTime(s.last) + '</td>';
      body.appendChild(tr);
    });
  }

  function cmp(a, b) {
    var va, vb;
    if (sortKey === 'last') { va = a.last; vb = b.last; }
    else if (sortKey === 'best') { va = a.best; vb = b.best; }
    else if (sortKey === 'plays') { va = a.plays; vb = b.plays; }
    else if (sortKey === 'classKey') { va = a.classKey * 100 + a.number; vb = b.classKey * 100 + b.number; }
    else { va = a[sortKey]; vb = b[sortKey]; }
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  }

  function updateSortArrows() {
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      var arrow = th.querySelector('.arrow');
      arrow.textContent = th.dataset.sort === sortKey ? (sortDir < 0 ? '▼' : '▲') : '';
    });
  }

  function renderRank(students) {
    var top = students.slice().sort(function (a, b) {
      if (b.best !== a.best) return b.best - a.best;
      return a.bestDuration - b.bestDuration; // 동점 시 빠른 순
    }).slice(0, 10);
    var ol = $('rankList');
    ol.innerHTML = '';
    if (!top.length) { ol.innerHTML = '<li class="sub">아직 기록이 없습니다.</li>'; return; }
    top.forEach(function (s, i) {
      var li = document.createElement('li');
      li.innerHTML =
        '<span class="pos">' + (i + 1) + '</span>' +
        '<span class="nm">' + esc(s.name) + ' <span class="sub">' + esc(s.student_no) + '</span></span>' +
        '<span class="sc">' + s.best + '</span>';
      ol.appendChild(li);
    });
  }

  function renderClasses(students) {
    var map = {};
    students.forEach(function (s) {
      var key = s.grade + '-' + s.classNo;
      if (!map[key]) map[key] = { grade: s.grade, classNo: s.classNo, scores: [], max: 0, count: 0 };
      map[key].scores.push(s.best);
      map[key].count += 1;
      if (s.best > map[key].max) map[key].max = s.best;
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return (a.grade - b.grade) || (a.classNo - b.classNo); });
    var body = $('classBody');
    body.innerHTML = '';
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" class="sub">—</td></tr>'; return; }
    rows.forEach(function (r) {
      var avg = Math.round(r.scores.reduce(function (a, b) { return a + b; }, 0) / r.scores.length);
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r.grade + '학년 ' + r.classNo + '반</td>' +
        '<td class="num">' + avg + '</td>' +
        '<td class="num">' + r.max + '</td>' +
        '<td class="num">' + r.count + '명</td>';
      body.appendChild(tr);
    });
  }

  function renderDist(students) {
    // 0-19, 20-39, ... 160-170 (9 구간, 20점 단위; 마지막은 170 포함)
    var buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    var labels = ['0', '20', '40', '60', '80', '100', '120', '140', '160+'];
    students.forEach(function (s) {
      var b = Math.min(8, Math.floor(s.best / 20));
      buckets[b]++;
    });
    var max = Math.max.apply(null, buckets.concat([1]));
    var dist = $('dist'), dl = $('distLabels');
    dist.innerHTML = ''; dl.innerHTML = '';
    buckets.forEach(function (n, i) {
      var bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = (n / max * 100) + '%';
      bar.innerHTML = n ? '<span>' + n + '</span>' : '';
      dist.appendChild(bar);
      var lab = document.createElement('div');
      lab.textContent = labels[i];
      dl.appendChild(lab);
    });
  }

  /* ------------------------------- 데이터 관리 ------------------------------- */
  function exportCsv() {
    var header = ['학번', '성명', '학년', '반', '번호', '점수', '소요시간(초)', '모드', '플레이시각', '차시'];
    var rows = records.slice().sort(function (a, b) {
      return (new Date(b.played_at) - new Date(a.played_at));
    }).map(function (r) {
      var p = Storage.parseStudentNo(r.student_no);
      return [r.student_no, r.name, p.grade, p.classNo, p.number,
        r.score, r.duration_sec, r.mode, r.played_at, r.session || ''];
    });
    var csv = [header].concat(rows).map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
    // 엑셀 한글 깨짐 방지 BOM
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'fruitbox_records_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function resetAll() {
    if (!confirm('모든 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    if (!confirm('정말 초기화하시겠습니까? (차시 종료 정리용)')) return;
    Storage.clearAll().then(function () {
      alert('기록이 초기화되었습니다.');
      refresh();
    }).catch(function (e) {
      alert('초기화 실패: ' + e);
    });
  }

  function setCommonSeed() {
    var cur = localStorage.getItem(COMMON_SEED_KEY) || '';
    var v = prompt('공통 보드 번호(정수)를 입력하세요.\n같은 번호 = 전체 학생 동일 보드.\n비우면 날짜 기반 자동값을 사용합니다.', cur);
    if (v === null) return;
    v = v.trim();
    if (v === '') {
      localStorage.removeItem(COMMON_SEED_KEY);
      alert('공통 보드를 날짜 기반 자동값으로 설정했습니다.');
    } else if (/^\d+$/.test(v)) {
      localStorage.setItem(COMMON_SEED_KEY, v);
      alert('공통 보드 번호 ' + v + ' 로 설정했습니다.\n(이 설정은 이 기기에 저장됩니다.)');
    } else {
      alert('정수만 입력할 수 있습니다.');
    }
  }

  /* ------------------------------- 유틸 ------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
})();
