// Firebase Firestore Configuration & Initialization
// AKM-POS v2.1 - Centralized Configuration

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
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

// Import centralized configuration
import { FIREBASE_CONFIG, CACHE_CONFIG } from './config.js';

// Initialize Firebase
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

// Initialize Firestore with modern cache settings
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    cacheSizeBytes: CACHE_CONFIG.SIZE_BYTES,
    tabManager: CACHE_CONFIG.MULTI_TAB ? persistentMultipleTabManager() : undefined
  })
});

console.log('✅ Firestore initialized with offline persistence (modern API)');

// Export Firebase instances
export {
  app,
  auth,
  db,
  // Firestore functions
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
