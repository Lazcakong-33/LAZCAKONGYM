import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCoachGeneralGuidance } from '../../utils/coachLocalFallback.ts';
test('general offline guidance is explicitly labeled and bounded',()=>{
  for(const q of ['¿Cómo mejorar mi entrenamiento de hipertrofia?', '¿Qué es la sobrecarga progresiva?', '¿Cómo mejorar la recuperación?', '¿Cómo hacer un calentamiento?', '¿Cómo combinar cardio y fuerza?']) assert.match(buildCoachGeneralGuidance(q) || '', /Orientación general local/);
  assert.equal(buildCoachGeneralGuidance('¿Cuánto peso debo levantar?'), null);
  assert.equal(buildCoachGeneralGuidance('¿Cuántas calorías necesito para perder grasa?'), null);
  assert.equal(buildCoachGeneralGuidance('¿Cuál fue mi último entrenamiento?'), null);
  assert.match(buildCoachGeneralGuidance('Tengo dolor') || '', /consulta a un profesional/);
});
