#!/usr/bin/env node
/*
 * gen-firebase-config.js
 *
 * 빌드 시점(예: Vercel)의 환경변수로 js/firebase-config.js 를 생성한다.
 * 이렇게 하면 Firebase 설정값을 저장소에 커밋하지 않고 환경변수로 관리할 수 있다.
 *
 * 사용 환경변수:
 *   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
 *   FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID
 *   TEACHER_PASSWORD (선택, 기본값 'teacher')
 *
 * 로컬 실행: `npm run build` 또는 `node scripts/gen-firebase-config.js`
 */
'use strict';

var fs = require('fs');
var path = require('path');

var cfg = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};
var teacherPw = process.env.TEACHER_PASSWORD || 'teacher';

var outPath = path.join(__dirname, '..', 'js', 'firebase-config.js');
var header = '/* 자동 생성 파일 (scripts/gen-firebase-config.js). 직접 수정하지 마세요.\n'
  + '   값은 배포 환경변수(FIREBASE_*, TEACHER_PASSWORD)에서 주입됩니다. */\n';

var content;
if (cfg.apiKey && cfg.projectId) {
  content = header
    + 'window.FIREBASE_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n'
    + 'window.TEACHER_PASSWORD = ' + JSON.stringify(teacherPw) + ';\n';
  console.log('[gen-firebase-config] Firebase 설정 생성 완료 (project: ' + cfg.projectId + ')');
} else {
  // 환경변수가 없으면 Firebase 없이(localStorage) 동작하도록 빈 설정을 쓴다.
  content = header
    + '/* FIREBASE_* 환경변수가 없어 Firebase 미사용(localStorage) 모드로 생성됨 */\n'
    + 'window.TEACHER_PASSWORD = ' + JSON.stringify(teacherPw) + ';\n';
  console.warn('[gen-firebase-config] FIREBASE_* 환경변수가 없습니다 → localStorage 모드로 빌드합니다.');
}

fs.writeFileSync(outPath, content);
console.log('[gen-firebase-config] 작성: ' + outPath);
