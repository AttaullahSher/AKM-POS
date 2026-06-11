// Firebase Configuration & Initialization — AKM-POS v3.0
// Single source of truth for all Firebase instances.

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  setLogLevel,
  waitForPendingWrites,
  enableNetwork,
  disableNetwork,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

import { FIREBASE_CONFIG, CACHE_CONFIG } from './config.js';

// ── Init (single instance) ──────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);

const auth = getAuth(app);

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    cacheSizeBytes: CACHE_CONFIG.SIZE_BYTES,
    tabManager: CACHE_CONFIG.MULTI_TAB ? persistentMultipleTabManager() : undefined
  }),
  // Force long-polling: the shop's flaky internet breaks Firestore's streaming
  // WebChannel/QUIC connection. Long-polling (plain HTTP) is far more tolerant
  // of dropped/slow/changing networks and avoids the QUIC retry storms.
  experimentalForceLongPolling: true,
});

// Quiet Firestore's chatty transport warnings (the "Listen stream transport
// errored" spam when the network drops). Real errors still surface.
setLogLevel('error');

// Google provider locked to akm-music.com domain hint
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: 'akm-music.com' });

console.log('✅ Firebase initialised (single instance, offline cache on)');

export {
  app,
  auth,
  provider,
  db,
  // Auth helpers
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  // Firestore helpers
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp,
  // Offline / sync helpers
  waitForPendingWrites,
  enableNetwork,
  disableNetwork
};
