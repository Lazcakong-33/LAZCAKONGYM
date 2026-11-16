import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { extractGoogleVerifiedState } from '../utils/adminAuthCriterion';

export { extractGoogleVerifiedState };

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isGoogleVerifiedSession: boolean;
  signInProvider: string | null;
  refreshAuthSession: (
    targetUser?: User | null
  ) => Promise<{ isGoogleVerified: boolean; signInProvider: string | null }>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isGoogleVerifiedSession: false,
  signInProvider: null,
  refreshAuthSession: async () => ({ isGoogleVerified: false, signInProvider: null }),
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGoogleVerifiedSession, setIsGoogleVerifiedSession] = useState(false);
  const [signInProvider, setSignInProvider] = useState<string | null>(null);

  const readTokenState = useCallback(async (targetUser: User | null, forceRefresh = false) => {
    if (!targetUser) {
      setIsGoogleVerifiedSession(false);
      setSignInProvider(null);
      return { isGoogleVerified: false, signInProvider: null };
    }
    try {
      let tokenResult;
      try {
        tokenResult = await targetUser.getIdTokenResult(forceRefresh);
      } catch {
        tokenResult = await targetUser.getIdTokenResult(false);
      }
      const next = extractGoogleVerifiedState(tokenResult, targetUser.emailVerified);
      setIsGoogleVerifiedSession(next.isGoogleVerified);
      setSignInProvider(next.signInProvider);
      return next;
    } catch {
      setIsGoogleVerifiedSession(false);
      setSignInProvider(null);
      return { isGoogleVerified: false, signInProvider: null };
    }
  }, []);

  const refreshAuthSession = useCallback(
    async (targetUser?: User | null) => {
      return readTokenState(targetUser ?? auth.currentUser, true);
    },
    [readTokenState]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await readTokenState(currentUser, false);
        // Ensure /users/{uid} metadata document exists with rule-compliant keys only
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userDoc = await getDoc(userRef);
          if (!userDoc.exists()) {
            const payload: Record<string, unknown> = {
              uid: currentUser.uid,
              name: currentUser.displayName || currentUser.email?.split('@')[0] || 'Atleta',
              createdAt: serverTimestamp(),
            };
            if (currentUser.email) {
              payload.email = currentUser.email;
            }
            await setDoc(userRef, payload);
          }
        } catch (err) {
          // Safe non-fatal fallback if offline
          console.warn('[AuthProvider users bootstrap]:', err instanceof Error ? err.message : err);
        }
      } else {
        setIsGoogleVerifiedSession(false);
        setSignInProvider(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [readTokenState]);

  return (
    <AuthContext.Provider
      value={{ user, loading, isGoogleVerifiedSession, signInProvider, refreshAuthSession }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
