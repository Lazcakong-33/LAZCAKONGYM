import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (p: string) => readFileSync(p, 'utf8');
test('training cycle appears only in Inicio and retains the existing per-athlete storage key', () => {
  const home = read('src/views/TodayView.tsx');
  const routines = read('src/views/RoutinesView.tsx');
  const card = read('src/components/ProfileTrainingCycleCard.tsx');
  assert.equal((home.match(/<ProfileTrainingCycleCard\b/g) || []).length, 1);
  assert.ok(home.includes('key={activeProfile.id} activeProfileId={activeProfile.id}'));
  assert.ok(!routines.includes('IntelligentTrainingCycleCard'));
  assert.ok(!routines.includes('active_routine_config'));
  assert.ok(card.includes('lazcakon_perfil_${activeProfileId}_active_routine_config'));
  assert.ok(!card.includes('lazcakon_active_routine_config'));
});
