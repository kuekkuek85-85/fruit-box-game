/*
 * firebase-config.example.js
 *
 * 여러 기기의 기록을 한 곳에 모으려면(교사 대시보드 실시간 집계):
 *   1) 이 파일을 같은 폴더에 `firebase-config.js` 라는 이름으로 복사하세요.
 *   2) 아래 값을 본인의 Firebase 프로젝트 설정으로 교체하세요.
 *      (Firebase 콘솔 → 프로젝트 설정 → 웹 앱 → SDK 설정 및 구성)
 *   3) Firestore 데이터베이스를 만들고, 테스트/수업용 보안 규칙을 설정하세요.
 *
 * 이 파일(firebase-config.js)이 없으면 앱은 자동으로 이 기기의 localStorage 에만
 * 저장합니다. 즉, Firebase 없이도 단일 기기에서 바로 동작합니다(MVP 1단계).
 *
 * window.TEACHER_PASSWORD 로 교사 대시보드 비밀번호도 바꿀 수 있습니다.
 */
window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 교사 대시보드 접근 비밀번호 (선택). 지정하지 않으면 기본값 'teacher'.
window.TEACHER_PASSWORD = "teacher";
