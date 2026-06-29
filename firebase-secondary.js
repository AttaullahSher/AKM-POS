// Secondary Firebase app — akm-files project (write-only, customer sync)
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG_FILES } from './config.js';

const secondaryApp = initializeApp(FIREBASE_CONFIG_FILES, 'akm-files');
export const dbFiles = getFirestore(secondaryApp);
