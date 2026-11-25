import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { auth, db, firebaseConfig } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, onIdTokenChanged, User } from 'firebase/auth';
import { extractGoogleVerifiedState } from '../utils/adminAuthCriterion';
import { markStartupTiming, setStartupFlag } from '../utils/startupPerf';

export { extractGoogleVerifiedState };

const AUTH_TOKEN_CLAIMS_SOFT_TIMEOUT_MS = 1200;

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isGoogleVerifiedSession: boolean;
  signInProvider: string | null;
  refreshAuthSession: (
    targetUser?: User | null,
    forceRefresh?: boolean
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
  const latestAuthUidRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const readTokenState = useCallback(async (targetUser: User | null, forceRefresh = false) => {
    if (!targetUser) {
      if (isMountedRef.current) {
        setIsGoogleVerifiedSession(false);
        setSignInProvider(null);
      }
      return { isGoogleVerified: false, signInProvider: null };
    }
    const requestedUid = targetUser.uid;
    try {
      let tokenResult;
      try {
        tokenResult = await targetUser.getIdTokenResult(forceRefresh);
      } catch {
        tokenResult = await targetUser.getIdTokenResult(false);
      }
      let next = extractGoogleVerifiedState(tokenResult, targetUser.emailVerified);

      // Android Capacitor / IndexedDB cache can briefly serve stale claims right after signInWithCredential.
      // If providerData shows google.com but cached token wasn't Google-verified yet, attempt one forced refresh.
      const hasGoogleProviderLinked = Boolean(
        Array.isArray(targetUser.providerData) &&
          targetUser.providerData.some((p) => p?.providerId === 'google.com')
      );
      if (!forceRefresh && !next.isGoogleVerified && hasGoogleProviderLinked) {
        try {
          const refreshedResult = await targetUser.getIdTokenResult(true);
          const refreshedState = extractGoogleVerifiedState(refreshedResult, targetUser.emailVerified);
          if (refreshedState.isGoogleVerified || refreshedState.signInProvider) {
            next = refreshedState;
          }
        } catch {
          // Keep non-forced result safely when offline
        }
      }

      if (isMountedRef.current && latestAuthUidRef.current === requestedUid) {
        setIsGoogleVerifiedSession(next.isGoogleVerified);
        setSignInProvider(next.signInProvider);
      }
      return next;
    } catch {
      if (isMountedRef.current && latestAuthUidRef.current === requestedUid) {
        setIsGoogleVerifiedSession(false);
        setSignInProvider(null);
      }
      return { isGoogleVerified: false, signInProvider: null };
    }
  }, []);

  const refreshAuthSession = useCallback(
    async (targetUser?: User | null, forceRefresh = true) => {
      return readTokenState(targetUser ?? auth.currentUser, forceRefresh);
    },
    [readTokenState]
  );

  useEffect(() => {
    let active = true;
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!active) return;
      markStartupTiming('firebaseAuthRestoreMs');
      latestAuthUidRef.current = currentUser?.uid ?? null;
      setUser(currentUser);
      if (currentUser) {
        let softTimer: ReturnType<typeof setTimeout> | null = null;
        const tokenStatePromise = readTokenState(currentUser, false).then((result) => {
          markStartupTiming('tokenClaimsResolvedMs');
          return result;
        });
        const timeoutPromise = new Promise<'timeout'>((resolve) => {
          softTimer = setTimeout(() => resolve('timeout'), AUTH_TOKEN_CLAIMS_SOFT_TIMEOUT_MS);
        });
        const winner = await Promise.race([tokenStatePromise, timeoutPromise]);
        if (softTimer !== null) {
          clearTimeout(softTimer);
        }
        if (winner === 'timeout') {
          // Do not block PWA startup when cached ID token needs slow network refresh;
          // isGoogleVerifiedSession stays safely false (fail-closed) until tokenStatePromise settles in background.
          setStartupFlag('tokenClaimsTimedOut', true);
        }
        // Ensure /users/{uid} metadata document exists without blocking initial session resolution
        if (firebaseConfig.projectId !== 'lazcakong-zero-cost-test') void (async () => {
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
        })();
      } else {
        setIsGoogleVerifiedSession(false);
        setSignInProvider(null);
      }
      if (active) {
        setLoading(false);
      }
    });

    const unsubscribeIdToken = onIdTokenChanged(auth, (tokenUser) => {
      if (!active) return;
      latestAuthUidRef.current = tokenUser?.uid ?? null;
      setUser(tokenUser);
      if (tokenUser) {
        void readTokenState(tokenUser, false);
      } else {
        setIsGoogleVerifiedSession(false);
        setSignInProvider(null);
      }
    });

    return () => {
      active = false;
      unsubscribeAuth();
      unsubscribeIdToken();
    };
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
