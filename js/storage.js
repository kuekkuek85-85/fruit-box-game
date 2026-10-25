/*
 * storage.js — 게임 기록 저장 추상화 계층
 *
 * 기본값은 브라우저 localStorage 이며, window.FIREBASE_CONFIG 가 설정되어 있으면
 * Firebase Firestore 로 자동 전환되어 여러 기기의 기록을 한 곳에 모은다.
 *
 * 공개 API (모두 Promise 반환):
 *   Storage.saveRecord(record)        기록 1건 저장
 *   Storage.getAllRecords()           전체 기록 배열
 *   Storage.clearAll()                전체 기록 삭제(초기화)
 *   Storage.onChange(cb)              기록 변경 구독 (실시간 대시보드용)
 *   Storage.backendName()             'firebase' | 'local'
 *
 * 유틸(동기):
 *   Storage.parseStudentNo(no)        학번 → {grade, classNo, number}
 *   Storage.newId()                   기록 고유 ID
 */
(function (global) {
  'use strict';

  var LOCAL_KEY = 'fruitbox.records';
  var listeners = [];

  function newId() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // 학번 5자리 = 학년(1) + 반(2) + 번호(2). 학교별 체계가 다르면 이 함수만 교체.
  function parseStudentNo(no) {
    var s = String(no || '').padStart(5, '0');
    return {
      grade: parseInt(s.slice(0, 1), 10),
      classNo: parseInt(s.slice(1, 3), 10),
      number: parseInt(s.slice(3, 5), 10)
    };
  }

  function notify() {
    listeners.forEach(function (cb) {
      try { cb(); } catch (e) { /* 구독자 오류가 저장을 막지 않도록 */ }
    });
  }

  /* ----------------------------- localStorage 백엔드 ----------------------------- */
  var LocalBackend = {
    name: 'local',
    readRaw: function () {
      try {
        var raw = global.localStorage.getItem(LOCAL_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },
    writeRaw: function (arr) {
      try {
        global.localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
      } catch (e) {
        console.error('기록 저장 실패(localStorage):', e);
        throw e;
      }
    },
    saveRecord: function (record) {
      var arr = this.readRaw();
      arr.push(record);
      this.writeRaw(arr);
      notify();
      return Promise.resolve(record);
    },
    getAllRecords: function () {
      return Promise.resolve(this.readRaw());
    },
    clearAll: function () {
      this.writeRaw([]);
      notify();
      return Promise.resolve();
    },
    init: function () {
      // 다른 탭에서 저장되면 이 탭에도 반영 (같은 기기 교사 대시보드 대응)
      global.addEventListener('storage', function (e) {
        if (e.key === LOCAL_KEY) notify();
      });
      return Promise.resolve();
    }
  };

  /* ------------------------------ Firebase 백엔드 ------------------------------ */
  // 동적 import 로 Firebase 모듈을 불러온다. 네트워크/설정 문제 시 local 로 폴백.
  function FirebaseBackend(config) {
    this.name = 'firebase';
    this.config = config;
    this.db = null;
    this.col = null;
    this.cache = [];
    this.fns = null;
  }
  FirebaseBackend.prototype.init = function () {
    var self = this;
    var base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    return Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js')
    ]).then(function (mods) {
      var appMod = mods[0];
      var fs = mods[1];
      self.fns = fs;
      var app = appMod.initializeApp(self.config);
      self.db = fs.getFirestore(app);
      self.col = fs.collection(self.db, 'gameRecords');
      // 실시간 구독: 캐시 갱신 후 리스너 통지
      fs.onSnapshot(self.col, function (snap) {
        var out = [];
        snap.forEach(function (doc) { out.push(doc.data()); });
        self.cache = out;
        notify();
      }, function (err) {
        console.error('Firestore 구독 오류:', err);
      });
    });
  };
  FirebaseBackend.prototype.saveRecord = function (record) {
    var self = this;
    var fs = this.fns;
    return fs.setDoc(fs.doc(self.col, record.id), record).then(function () {
      return record;
    });
  };
  FirebaseBackend.prototype.getAllRecords = function () {
    // onSnapshot 캐시를 우선 사용 (실시간). 비어있으면 1회 조회.
    var self = this;
    if (self.cache.length) return Promise.resolve(self.cache.slice());
    var fs = this.fns;
    return fs.getDocs(self.col).then(function (snap) {
      var out = [];
      snap.forEach(function (doc) { out.push(doc.data()); });
      self.cache = out;
      return out.slice();
    });
  };
  FirebaseBackend.prototype.clearAll = function () {
    var self = this;
    var fs = this.fns;
    return fs.getDocs(self.col).then(function (snap) {
      var batch = fs.writeBatch(self.db);
      snap.forEach(function (doc) { batch.delete(doc.ref); });
      return batch.commit();
    });
  };

  /* -------------------------------- 백엔드 선택 -------------------------------- */
  var backend = LocalBackend;
  var readyPromise;

  function selectBackend() {
    if (global.FIREBASE_CONFIG && global.FIREBASE_CONFIG.projectId) {
      var fb = new FirebaseBackend(global.FIREBASE_CONFIG);
      return fb.init().then(function () {
        backend = fb;
        console.info('[Storage] Firebase 백엔드 사용');
      }).catch(function (e) {
        console.error('[Storage] Firebase 초기화 실패 — localStorage 로 폴백합니다.', e);
        backend = LocalBackend;
        return LocalBackend.init();
      });
    }
    console.info('[Storage] localStorage 백엔드 사용');
    return LocalBackend.init();
  }

  readyPromise = selectBackend();

  var Storage = {
    ready: function () { return readyPromise; },
    backendName: function () { return backend.name; },
    saveRecord: function (record) {
      return readyPromise.then(function () { return backend.saveRecord(record); });
    },
    getAllRecords: function () {
      return readyPromise.then(function () { return backend.getAllRecords(); });
    },
    clearAll: function () {
      return readyPromise.then(function () { return backend.clearAll(); });
    },
    onChange: function (cb) {
      listeners.push(cb);
      return function unsubscribe() {
        var i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    parseStudentNo: parseStudentNo,
    newId: newId
  };

  global.Storage = Storage;
})(window);
