import React, { useState, useEffect } from 'react';
import { X, Disc, Layers, TrendingUp } from 'lucide-react';

interface PlateCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialWeight?: number;
}

type MachineType = 'prensa' | 'barra' | 'smith' | 'custom';

const PLATE_SIZES = [25, 20, 15, 10, 5, 2.5];

const PLATE_STYLES: Record<
  number,
  { bg: string; text: string; border: string; height: string }
> = {
  25: { bg: 'bg-[#CCFF00]', text: 'text-[#090909]', border: 'border-[#CCFF00]', height: 'h-24' },
  20: { bg: 'bg-zinc-200', text: 'text-[#090909]', border: 'border-white', height: 'h-22' },
  15: { bg: 'bg-zinc-700', text: 'text-[#F5F5F5]', border: 'border-zinc-500', height: 'h-20' },
  10: { bg: 'bg-zinc-800', text: 'text-[#F5F5F5]', border: 'border-zinc-600', height: 'h-18' },
  5: { bg: 'bg-[#171717]', text: 'text-[#CCFF00]', border: 'border-[#CCFF00]/60', height: 'h-16' },
  2.5: { bg: 'bg-[#171717]', text: 'text-zinc-300', border: 'border-[#303030]', height: 'h-14' },
};

export const PlateCalculatorModal: React.FC<PlateCalculatorModalProps> = ({
  isOpen,
  onClose,
  initialWeight = 100,
}) => {
  const [machine, setMachine] = useState<MachineType>(() =>
    initialWeight && initialWeight <= 50 ? 'barra' : 'prensa'
  );
  const [totalWeight, setTotalWeight] = useState<number>(() => {
    const w = initialWeight || 100;
    return Math.round(w / 5) * 5;
  });
  const [tare, setTare] = useState<number>(() =>
    initialWeight && initialWeight <= 50 ? 20 : 50
  );

  useEffect(() => {
    if (isOpen && typeof initialWeight === 'number' && initialWeight > 0) {
      const rounded = Math.round(initialWeight / 5) * 5;
      setTotalWeight(rounded);
      if (initialWeight <= 50) {
        setMachine('barra');
        setTare(20);
      }
    }
  }, [isOpen, initialWeight]);

  if (!isOpen) return null;

  const handleSelectMachine = (type: MachineType) => {
    setMachine(type);
    if (type === 'prensa') setTare(50);
    else if (type === 'barra') setTare(20);
    else if (type === 'smith') setTare(15);
  };

  const weightPerSide = Math.max(0, totalWeight - tare) / 2;

  const platesPerSide: { weight: number; count: number }[] = [];
  let remainingPerSide = weightPerSide;

  PLATE_SIZES.forEach((plate) => {
    if (remainingPerSide >= plate) {
      const count = Math.floor(remainingPerSide / plate);
      platesPerSide.push({ weight: plate, count });
      remainingPerSide = Number((remainingPerSide - count * plate).toFixed(2));
    }
  });

  const adjustWeight = (delta: number) => {
    setTotalWeight((prev) => Math.max(tare, Math.round((prev + delta) / 5) * 5));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Plus_Jakarta_Sans',sans-serif]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#090909] border border-[#303030] rounded-3xl p-5 sm:p-6 shadow-2xl text-[#F5F5F5] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#303030]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#171717] text-[#CCFF00] border border-[#CCFF00]/40 flex items-center justify-center">
              <Disc className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-[#F5F5F5] uppercase">
                Calculadora de Discos
              </h3>
              <p className="text-xs text-zinc-400">
                Distribución exacta por lado (mínimo 2.5 kg)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Machine Apparatus Buttons */}
        <div className="grid grid-cols-3 gap-2 my-4">
          <button
            type="button"
            onClick={() => handleSelectMachine('prensa')}
            className={`min-h-[42px] py-2 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              machine === 'prensa'
                ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00] font-black'
                : 'bg-[#171717] text-zinc-300 border-[#303030] hover:border-zinc-500'
            }`}
          >
            Prensa (50kg)
          </button>
          <button
            type="button"
            onClick={() => handleSelectMachine('barra')}
            className={`min-h-[42px] py-2 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              machine === 'barra'
                ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00] font-black'
                : 'bg-[#171717] text-zinc-300 border-[#303030] hover:border-zinc-500'
            }`}
          >
            Barra (20kg)
          </button>
          <button
            type="button"
            onClick={() => handleSelectMachine('smith')}
            className={`min-h-[42px] py-2 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              machine === 'smith'
                ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00] font-black'
                : 'bg-[#171717] text-zinc-300 border-[#303030] hover:border-zinc-500'
            }`}
          >
            Smith (15kg)
          </button>
        </div>

        {/* Total Weight Input and Quick Adjustments */}
        <div className="p-4 rounded-2xl bg-[#171717] border border-[#303030] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider font-black text-[#CCFF00] flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              <span>Peso Total Objetivo</span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min={tare}
                step="5"
                value={totalWeight}
                onChange={(e) => setTotalWeight(Math.max(0, Number(e.target.value)))}
                className="w-28 text-center font-black font-mono tabular-nums text-2xl bg-[#090909] border border-[#303030] focus:border-[#CCFF00] focus:outline-none py-1.5 px-2 rounded-xl text-[#CCFF00]"
              />
              <span className="text-sm font-black text-zinc-300 font-mono">kg</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-[#303030]">
            <button
              type="button"
              onClick={() => adjustWeight(-10)}
              className="flex-1 min-h-[38px] py-1.5 px-1 bg-[#090909] hover:bg-[#222222] border border-[#303030] rounded-xl text-xs font-mono font-bold text-zinc-200 transition-colors active:scale-95 cursor-pointer"
            >
              -10 kg
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(-5)}
              className="flex-1 min-h-[38px] py-1.5 px-1 bg-[#090909] hover:bg-[#222222] border border-[#303030] rounded-xl text-xs font-mono font-bold text-zinc-200 transition-colors active:scale-95 cursor-pointer"
            >
              -5 kg
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(5)}
              className="flex-1 min-h-[38px] py-1.5 px-1 bg-[#090909] hover:bg-[#222222] border border-[#303030] rounded-xl text-xs font-mono font-bold text-[#CCFF00] transition-colors active:scale-95 cursor-pointer"
            >
              +5 kg
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(10)}
              className="flex-1 min-h-[38px] py-1.5 px-1 bg-[#090909] hover:bg-[#222222] border border-[#303030] rounded-xl text-xs font-mono font-bold text-[#CCFF00] transition-colors active:scale-95 cursor-pointer"
            >
              +10 kg
            </button>
          </div>
        </div>

        {/* Visual Barbell Representation */}
        <div className="my-4 p-4 rounded-2xl bg-[#171717] border border-[#303030] relative">
          <div className="text-center mb-3">
            <span className="text-sm font-black text-[#CCFF00] font-mono tabular-nums">
              {weightPerSide.toFixed(1)} kg por lado
            </span>
            <span className="text-[11px] text-zinc-400 block font-mono">
              Base: {tare} kg + {weightPerSide * 2} kg en discos
            </span>
          </div>

          <div className="h-28 flex items-center justify-center relative overflow-x-auto py-2">
            <div className="absolute left-0 right-0 h-4 bg-zinc-700 rounded-full z-0" />
            <div className="absolute left-2 w-3 h-16 bg-zinc-500 rounded z-10" />

            <div className="relative z-10 flex items-center gap-1 pl-6">
              {platesPerSide.length === 0 ? (
                <div className="text-xs text-zinc-500 py-6">Solo la barra / estructura base</div>
              ) : (
                platesPerSide.map((item) => {
                  const style = PLATE_STYLES[item.weight] || {
                    bg: 'bg-zinc-700',
                    text: 'text-white',
                    border: 'border-zinc-500',
                    height: 'h-16',
                  };
                  return Array.from({ length: item.count }).map((_, i) => (
                    <div
                      key={`${item.weight}-${i}`}
                      className={`w-6 ${style.height} ${style.bg} ${style.text} border ${style.border} rounded-md flex items-center justify-center font-black font-mono text-[9px] select-none shrink-0`}
                      title={`${item.weight} kg`}
                    >
                      <span className="-rotate-90 whitespace-nowrap">{item.weight}</span>
                    </div>
                  ));
                })
              )}
            </div>
          </div>
        </div>

        {/* Discos breakdown list */}
        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#CCFF00]" />
            <span>Discos por cada lado:</span>
          </span>
          {platesPerSide.length === 0 ? (
            <p className="text-xs text-zinc-500">Sin discos adicionales necesarios.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {platesPerSide.map((item) => (
                <div
                  key={item.weight}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-[#171717] border border-[#303030] text-xs font-mono tabular-nums"
                >
                  <span className="font-bold text-[#F5F5F5]">{item.weight} kg</span>
                  <span className="font-black text-[#CCFF00]">× {item.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="mt-4 pt-3 border-t border-[#303030]">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[46px] py-3 rounded-2xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};
