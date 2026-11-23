import { CompletedWorkout } from '../types';

export function calculateFatigueScore(history: CompletedWorkout[]): { score: number; status: 'low' | 'moderate' | 'high' } {
  if (history.length < 3) return { score: 0, status: 'low' };
  const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  const last3 = sortedHistory.slice(0, 3);
  const last10 = sortedHistory.slice(0, 10);
  
  const avgLast3 = last3.reduce((sum, w) => sum + (w.totalVolumeKg || 0), 0) / last3.length;
  const avgLast10 = last10.reduce((sum, w) => sum + (w.totalVolumeKg || 0), 0) / last10.length;
  
  const ratio = avgLast3 / (avgLast10 || 1);
  
  if (ratio > 1.2) return { score: Math.min(10, ratio * 5), status: 'high' };
  if (ratio > 1.0) return { score: Math.min(10, ratio * 5), status: 'moderate' };
  return { score: Math.min(10, ratio * 5), status: 'low' };
}
