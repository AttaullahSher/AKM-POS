// Firebase Configuration & Initialization — AKM-POS v3.0
// Single source of truth for all Firebase instances.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { FIREBASE_CONFIG, CACHE_CONFIG } from './config.js';

// ── Init (single instance) ──────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);

const auth = getAuth(app);

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    cacheSizeBytes: CACHE_CONFIG.SIZE_BYTES,
    tabManager: CACHE_CONFIG.MULTI_TAB ? persistentMultipleTabManager() : undefined
  })
});

// Google provider locked to akm-music.com domain hint
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: 'akm-music.com' });

console.log('✅ Firebase initialised (single instance)');

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
  Timestamp
};
