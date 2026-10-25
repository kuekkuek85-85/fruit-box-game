/*
 * firebase-config.js — 실제 Firebase 프로젝트 설정
 *
 * 이 파일이 있으면 storage.js 가 자동으로 Firebase Firestore 백엔드로 전환되어
 * 여러 기기의 게임 기록이 한 곳에 모이고, 교사 대시보드가 실시간으로 집계합니다.
 *
 * 참고: Firebase 웹 apiKey 는 "비밀"이 아니라 공개용 클라이언트 식별자입니다.
 * 실제 보안은 Firestore 보안 규칙으로 걸어야 합니다(README 참고).
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDaWBgFeHXiDf_WlxF8vvDjasCedFhu2QA",
  authDomain: "fruit-box-game-f35e9.firebaseapp.com",
  projectId: "fruit-box-game-f35e9",
  storageBucket: "fruit-box-game-f35e9.firebasestorage.app",
  messagingSenderId: "671841793494",
  appId: "1:671841793494:web:e8751acaa4aeaf293ba077"
};

// 교사 대시보드 접근 비밀번호 (선택). 지정하지 않으면 기본값 'teacher'.
window.TEACHER_PASSWORD = "teacher";
