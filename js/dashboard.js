/*
 * dashboard.js — 교사 대시보드 (타임어택)
 * 학번·성명 기준 집계. 순위는 '완전 클리어 최단 시간' 기준.
 *
 * 비밀번호는 window.TEACHER_PASSWORD (firebase-config.js 에서 지정) 또는 기본값 'teacher'.
 * 주의: 클라이언트 측 게이트이므로 완전한 보안이 아니라 '학생 접근 차단' 용도입니다.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var PW = window.TEACHER_PASSWORD || 'teacher';

  function fmtSec(s) { return (Math.round(s * 10) / 10) + ''; }

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
  var sortKey = 'clearTime';
  var sortDir = 1; // 1 오름차순(빠른 순), -1 내림차순

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

    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else {
          sortKey = k;
          // 클리어 시간은 빠른 순(오름차순)이 기본, 이름/학번/학급은 오름차순,
          // 나머지(점수·횟수·최근)는 내림차순이 기본.
          sortDir = (k === 'clearTime' || k === 'name' || k === 'student_no' || k === 'classKey') ? 1 : -1;
        }
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
          bestScore: 0, plays: 0, last: 0,
          cleared: false,
          bestClearTime: null // 완전 클리어 최단 시간(초), 없으면 null
        };
      }
      var s = map[key];
      s.name = r.name; // 최신 제출 이름 반영
      s.plays += 1;
      var t = new Date(r.played_at).getTime() || 0;
      if (t > s.last) s.last = t;
      if (r.score > s.bestScore) s.bestScore = r.score;
      if (r.cleared) {
        s.cleared = true;
        if (s.bestClearTime === null || r.duration_sec < s.bestClearTime) {
          s.bestClearTime = r.duration_sec;
        }
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

    renderSummary(students);
    renderTable(filtered);
    renderRank(filtered);
    renderClasses(filtered);
    renderDist(filtered);
    updateSortArrows();
  }

  function renderSummary(all) {
    var participants = all.length;
    var clearedStudents = all.filter(function (s) { return s.cleared; });
    var fastest = null;
    clearedStudents.forEach(function (s) {
      if (fastest === null || s.bestClearTime < fastest) fastest = s.bestClearTime;
    });
    $('summary').innerHTML =
      stat('참여 학생', participants + '명') +
      stat('총 플레이', records.length + '회') +
      stat('클리어 학생', clearedStudents.length + '명') +
      stat('최단 클리어', fastest === null ? '—' : fmtSec(fastest) + '초');
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
        '<td class="num">' + (s.bestClearTime === null ? '—' : fmtSec(s.bestClearTime)) + '</td>' +
        '<td class="num">' + s.bestScore + '</td>' +
        '<td class="num">' + s.plays + '</td>' +
        '<td>' + fmtTime(s.last) + '</td>';
      body.appendChild(tr);
    });
  }

  function clearTimeOrInf(s) { return s.bestClearTime === null ? Infinity : s.bestClearTime; }

  function cmp(a, b) {
    var va, vb;
    if (sortKey === 'last') { va = a.last; vb = b.last; }
    else if (sortKey === 'clearTime') { va = clearTimeOrInf(a); vb = clearTimeOrInf(b); }
    else if (sortKey === 'best') { va = a.bestScore; vb = b.bestScore; }
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
    // 완전 클리어한 학생을 최단 시간 순으로, 그 다음 미클리어 학생을 점수 순으로.
    var cleared = students.filter(function (s) { return s.cleared; })
      .sort(function (a, b) { return a.bestClearTime - b.bestClearTime; });
    var notCleared = students.filter(function (s) { return !s.cleared; })
      .sort(function (a, b) { return b.bestScore - a.bestScore; });
    var top = cleared.concat(notCleared).slice(0, 10);

    var ol = $('rankList');
    ol.innerHTML = '';
    if (!top.length) { ol.innerHTML = '<li class="sub">아직 기록이 없습니다.</li>'; return; }
    top.forEach(function (s, i) {
      var right = s.cleared
        ? '<span class="sc">' + fmtSec(s.bestClearTime) + '초</span>'
        : '<span class="sub">' + s.bestScore + '점 · 미완</span>';
      var li = document.createElement('li');
      li.innerHTML =
        '<span class="pos">' + (i + 1) + '</span>' +
        '<span class="nm">' + esc(s.name) + ' <span class="sub">' + esc(s.student_no) + '</span></span>' +
        right;
      ol.appendChild(li);
    });
  }

  function renderClasses(students) {
    var map = {};
    students.forEach(function (s) {
      var key = s.grade + '-' + s.classNo;
      if (!map[key]) map[key] = { grade: s.grade, classNo: s.classNo, count: 0, cleared: 0, fastest: null };
      map[key].count += 1;
      if (s.cleared) {
        map[key].cleared += 1;
        if (map[key].fastest === null || s.bestClearTime < map[key].fastest) map[key].fastest = s.bestClearTime;
      }
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return (a.grade - b.grade) || (a.classNo - b.classNo); });
    var body = $('classBody');
    body.innerHTML = '';
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" class="sub">—</td></tr>'; return; }
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r.grade + '학년 ' + r.classNo + '반</td>' +
        '<td class="num">' + (r.fastest === null ? '—' : fmtSec(r.fastest)) + '</td>' +
        '<td class="num">' + r.cleared + '명</td>' +
        '<td class="num">' + r.count + '명</td>';
      body.appendChild(tr);
    });
  }

  function renderDist(students) {
    // 완전 클리어한 학생의 최단 시간 분포. 30초 단위 6구간(0~180).
    var buckets = [0, 0, 0, 0, 0, 0];
    var labels = ['<30', '30', '60', '90', '120', '150'];
    students.forEach(function (s) {
      if (!s.cleared) return;
      var b = Math.min(5, Math.floor(s.bestClearTime / 30));
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
    var header = ['학번', '성명', '학년', '반', '번호', '점수', '소요시간(초)', '완료', '모드', '플레이시각', '차시'];
    var rows = records.slice().sort(function (a, b) {
      return (new Date(b.played_at) - new Date(a.played_at));
    }).map(function (r) {
      var p = Storage.parseStudentNo(r.student_no);
      return [r.student_no, r.name, p.grade, p.classNo, p.number,
        r.score, r.duration_sec, r.cleared ? 'Y' : 'N', r.mode, r.played_at, r.session || ''];
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

  /* ------------------------------- 유틸 ------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
})();
