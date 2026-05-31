// Firebase: 익명 인증 + Firestore 점수 랭킹.
// 랭킹 단위는 "게임 × 레벨". 게임 = 학습꾸러미 id(숫자 더하기는 'numbers'로 합침).
// 한 사람(익명 uid)당 게임·레벨마다 최고점 1행만 보관(덮어쓰기).
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider,
  signInWithCredential, linkWithCredential, signInWithPopup, linkWithPopup,
  signOut, type User, type AuthError,
} from 'firebase/auth';
import {
  getFirestore, doc, collection, collectionGroup, query, orderBy, limit, where,
  getDocs, getDoc, setDoc, deleteDoc, runTransaction, getCountFromServer, serverTimestamp,
} from 'firebase/firestore';

// One Tap(자동 로그인 프롬프트)용 OAuth 웹 클라이언트 ID.
// Google Cloud 콘솔 > API 및 서비스 > 사용자 인증 정보 > "Web client (auto created by Google Service)"의 클라이언트 ID.
// 비워두면 One Tap은 건너뛰고 '구글로 로그인' 버튼(팝업)만 동작.
export const GOOGLE_CLIENT_ID = '143238657788-bq1toerl6vkfdq88nc40plfpmfelmbnj.apps.googleusercontent.com';

const firebaseConfig = {
  apiKey: 'AIzaSyAcqVtHkxYv21GVnOjend6GHjRWJIagAGg',
  authDomain: 'match-it-typostudio.web.app',
  projectId: 'match-it-typostudio',
  storageBucket: 'match-it-typostudio.firebasestorage.app',
  messagingSenderId: '143238657788',
  appId: '1:143238657788:web:4fe60306120251fcee4979',
  measurementId: 'G-MV449FFSG0',
};

const app = initializeApp(firebaseConfig);

// App Check: 정식 우리 도메인의 앱에서 온 요청인지 reCAPTCHA Enterprise 토큰으로 검증.
// 콘솔 외부(브라우저 콘솔/스크립트)의 Firestore 직접 호출을 차단해 부정 점수 등록을 막음.
// 사이트 키는 공개돼도 되는 값(apiKey와 동일 성격). enterprise.js 로드·execute 호출은
// SDK가 내부에서 자동 처리하므로 별도 스크립트 태그가 필요 없음.
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LckPgQtAAAAAK3pzWB-vvL6L9IeiOGrPuSsDcrX';
// 로컬 개발(localhost)에서는 디버그 토큰을 사용. .env.local의 VITE_APPCHECK_DEBUG_TOKEN에
// 콘솔(App Check > 앱 > 디버그 토큰 관리)에 등록한 토큰 값을 그대로 넣어 고정한다.
// (값을 지정하지 않으면 SDK가 매번 새 토큰을 생성해 콘솔 등록값과 어긋나 403이 난다.)
if (import.meta.env.DEV) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

const db = getFirestore(app);
const auth = getAuth(app);

// 첫 인증 상태 복원(기존 구글/익명 세션)을 1회 기다리는 신호.
let readyDone = false;
let resolveReady: () => void;
const authReady = new Promise<void>((r) => { resolveReady = r; });
onAuthStateChanged(auth, () => { if (!readyDone) { readyDone = true; resolveReady(); } });

// 로그인된 uid 보장: 기존 세션이 있으면 그 uid, 없으면 익명 로그인.
export async function ensureUid(): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  await authReady; // 새 익명 세션을 만들기 전에 기존 세션 복원을 기다림
  const restored = auth.currentUser as User | null;
  if (restored) return restored.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

// 인증 상태 구독(로그인/로그아웃/익명 전환).
export function onAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

// 익명으로 쌓은 순위표 기록을 이미 가입된 구글 계정(uid 다름)으로 이전한다.
// 익명 상태에서 읽고 지운 뒤 전환하고, 새 uid로 재등록 → 중복 제거 + 점수 보존.
// (전환 후엔 익명 uid 문서를 지울 권한이 없으므로 반드시 전환 전에 삭제한다.)
async function switchAndMigrate(anonUser: User, signIn: () => Promise<User>): Promise<User> {
  // 1) 익명 상태에서 기록 읽고 삭제. 인덱스/권한 문제로 실패해도 로그인은 절대 막지 않음.
  let saved: { board: string; row: ScoreRow }[] = [];
  let deleted = false;
  try {
    const q = query(collectionGroup(db, 'scores'), where('uid', '==', anonUser.uid));
    const snap = await getDocs(q);
    saved = snap.docs.map((d) => ({ board: d.ref.parent.parent!.id, row: d.data() as ScoreRow }));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    deleted = true;
  } catch (e) {
    console.warn('익명 기록 이전 준비 실패(로그인은 계속)', e);
    saved = [];
  }
  // 2) 전환
  let user: User;
  try {
    user = await signIn();
  } catch (e) {
    // 전환 실패(아직 익명 상태): 지운 기록이 있으면 원래대로 복구
    if (deleted) await Promise.all(saved.map(({ board, row }) => submitBest({ ...row, board }))).catch(() => {});
    throw e;
  }
  // 3) 전환 성공: 새 uid·인증 뱃지로 재등록(트랜잭션이 기존값보다 클 때만 점수 갱신)
  if (saved.length) {
    await Promise.all(saved.map(({ board, row }) =>
      submitBest({ ...row, uid: user.uid, verified: true, board }))).catch(() => {});
  }
  return user;
}

// One Tap에서 받은 구글 ID 토큰으로 로그인. 익명 세션이 있으면 link로 승계 시도.
export async function loginWithGoogleIdToken(idToken: string): Promise<User> {
  const credential = GoogleAuthProvider.credential(idToken);
  const cur = auth.currentUser;
  if (cur && cur.isAnonymous) {
    try {
      const res = await linkWithCredential(cur, credential);
      return res.user;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        // 이미 가입된 계정으로 전환: 익명 기록을 새 계정으로 이전해 중복 방지
        return switchAndMigrate(cur, async () => (await signInWithCredential(auth, credential)).user);
      }
      throw e;
    }
  }
  const res = await signInWithCredential(auth, credential);
  return res.user;
}

// 팝업 버튼 로그인(One Tap 미설정/거부 시 대체).
export async function loginWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const cur = auth.currentUser;
  if (cur && cur.isAnonymous) {
    try {
      const res = await linkWithPopup(cur, provider);
      return res.user;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        // 이미 가입된 계정으로 전환. 두 번째 팝업을 띄우지 않고 에러에 담긴
        // 자격증명으로 바로 로그인(없을 때만 팝업 폴백).
        const cred = GoogleAuthProvider.credentialFromError(e as AuthError);
        const signIn = cred
          ? async () => (await signInWithCredential(auth, cred)).user
          : async () => (await signInWithPopup(auth, provider)).user;
        return switchAndMigrate(cur, signIn);
      }
      throw e;
    }
  }
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export function logout(): Promise<void> {
  return signOut(auth);
}

// 클라우드 세이브(구글 로그인 시): localStorage의 matchit-* 스냅샷을 users/{uid}에 저장/복원.
export async function saveUserStore(uid: string, store: Record<string, string>): Promise<void> {
  await setDoc(doc(db, 'users', uid), { store, updatedAt: serverTimestamp() }, { merge: true });
}
export async function loadUserStore(uid: string): Promise<Record<string, string> | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? ((snap.data().store as Record<string, string>) ?? null) : null;
}

export interface ScoreRow {
  uid: string;
  nickname: string;
  score: number;
  packId: string;
  packTitle: string;
  level: number;
  gameKind: string;
  verified?: boolean; // 구글 로그인 계정 여부(순위표 인증 뱃지)
}

// Firestore 문서 ID로 안전한 보드 키. game = packId(또는 'numbers'), level 결합.
export function boardId(game: string, level: number): string {
  return `${encodeURIComponent(game)}__L${level}`;
}

// 최고점 갱신 시에만 기록(트랜잭션으로 기존값과 비교, 더 클 때만 덮어씀).
export async function submitBest(row: ScoreRow & { board: string }): Promise<boolean> {
  const ref = doc(db, 'boards', row.board, 'scores', row.uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists() ? Number(snap.data().score) || 0 : -1;
    if (row.score <= prev) return false;
    tx.set(ref, {
      uid: row.uid,
      nickname: row.nickname || '',
      score: row.score,
      packId: row.packId,
      packTitle: row.packTitle,
      level: row.level,
      gameKind: row.gameKind,
      verified: row.verified ?? false,
      updatedAt: serverTimestamp(),
    });
    return true;
  });
}

// 보드 상위 N개(점수 내림차순).
export async function fetchTop(board: string, n = 10): Promise<ScoreRow[]> {
  const q = query(collection(db, 'boards', board, 'scores'), orderBy('score', 'desc'), limit(n));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ScoreRow);
}

// 내 순위 = 나보다 높은 점수 수 + 1. (점수 0 이하면 미집계로 0 반환)
export async function fetchRank(board: string, myScore: number): Promise<number> {
  if (myScore <= 0) return 0;
  const q = query(collection(db, 'boards', board, 'scores'), where('score', '>', myScore));
  const snap = await getCountFromServer(q);
  return snap.data().count + 1;
}
