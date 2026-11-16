import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import defaults from './firebase-applet-config.json' with { type: 'json' };

const firebaseConfig = {
  ...defaults,
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || defaults.projectId,
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || defaults.apiKey,
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || defaults.appId,
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || defaults.authDomain,
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || defaults.storageBucket,
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || defaults.messagingSenderId,
  firestoreDatabaseId: import.meta.env?.VITE_FIREBASE_DATABASE_ID || defaults.firestoreDatabaseId,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
export const storage = getStorage(app);
