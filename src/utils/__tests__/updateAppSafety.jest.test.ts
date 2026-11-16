import {
  DEFERRED_UPDATE_FLAG_KEY,
  OFFLINE_SYNC_QUEUE_STORAGE_KEY,
  forceAppUpdate,
  getAppUpdateSafetyStatus,
  UpdateSafetyStorage,
} from '../updateApp';

function createMemoryStorage(initial: Record<string, string> = {}): UpdateSafetyStorage & { store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    get length() {
      return Object.keys(store).length;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    getItem(k: string) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k: string, v: string) {
      store[k] = v;
    },
    removeItem(k: string) {
      delete store[k];
    },
  };
}

describe('PWA update safety checks (active workout & offline sync queue)', () => {
  test('blocks update and avoids reload when a profile-scoped active session exists', async () => {
    const storage = createMemoryStorage({
      lazcakon_active_profile_id: 'perfil_kamilo',
      lazcakon_perfil_kamilo_active_session: JSON.stringify({
        routineId: 'rutina_lunes',
        startTime: Date.now(),
        sets: [{ weight: 100, reps: 8, completed: true }],
      }),
    });

    let reloaded = false;
    const result = await forceAppUpdate({
      storage,
      onReload: () => {
        reloaded = true;
      },
    });

    expect(result.deferred).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.status.hasActiveWorkout).toBe(true);
    expect(result.status.activeWorkoutProfileKeys).toEqual(['lazcakon_perfil_kamilo_active_session']);
    expect(reloaded).toBe(false);
    expect(storage.getItem(DEFERRED_UPDATE_FLAG_KEY)).not.toBeNull();
  });

  test('blocks update when lazcakon_pending_offline_sync_queue has queued workouts', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SYNC_QUEUE_STORAGE_KEY]: JSON.stringify([
        { profileId: 'perfil_1', data: { history: [{ id: 'w1' }] }, queuedAt: new Date().toISOString() },
      ]),
    });

    const status = getAppUpdateSafetyStatus(storage);
    expect(status.canUpdateSafely).toBe(false);
    expect(status.hasPendingOfflineSync).toBe(true);
    expect(status.pendingSyncCount).toBe(1);

    let reloaded = false;
    const result = await forceAppUpdate({
      storage,
      onReload: () => {
        reloaded = true;
      },
    });
    expect(result.deferred).toBe(true);
    expect(reloaded).toBe(false);
  });

  test('allows update when active session is removed and offline sync queue is empty', async () => {
    const storage = createMemoryStorage({
      [OFFLINE_SYNC_QUEUE_STORAGE_KEY]: '[]',
      [DEFERRED_UPDATE_FLAG_KEY]: '1700000000000',
    });

    const result = await forceAppUpdate({ storage });
    expect(result.deferred).toBe(false);
    expect(result.applied).toBe(true);
    expect(result.status.canUpdateSafely).toBe(true);
    expect(storage.getItem(DEFERRED_UPDATE_FLAG_KEY)).toBeNull();
    expect(storage.getItem('lazcakon_installed_version')).toBeTruthy();
  });
});
