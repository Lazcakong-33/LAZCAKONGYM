import React from 'react';
import type { LibraryExercise } from '../types';
import { getNeckMovementSpec } from '../utils/neckMovementSpec';
import './NeckMovementDemo.css';

export interface NeckMovementDemoProps {
  exercise: Pick<LibraryExercise, 'name' | 'muscleGroup' | 'equipment'> & {
    canonicalGroup16?: LibraryExercise['canonicalGroup16'];
  };
  className?: string;
  paused?: boolean;
}

/**
 * Original vector motion study of a human torso and cervical joint (not a
 * generic stock poster). Eight-stage, 4-second continuous animation.
 * Each card has its own pattern; manual/band isometrics keep head fixed.
 */
export const NeckMovementDemo: React.FC<NeckMovementDemoProps> = ({
  exercise,
  className = '',
  paused = false,
}) => {
  const spec = getNeckMovementSpec(exercise);
  if (!spec) return null;
  const isSupine = spec.kind === 'supine-tuck';
  const isProfile = ['tuck', 'wall-tuck', 'supine-tuck', 'flexion', 'extension', 'iso-front', 'iso-back'].includes(spec.kind);
  const isWall = spec.kind === 'wall-tuck';
  return (
    <div
      className={`neck-demo neck-demo--${spec.kind} neck-demo--${spec.resistance} ${className}`}
      data-paused={paused ? 'true' : 'false'}
      role="img"
      aria-label={`Demostración animada: ${exercise.name}. ${spec.label}. Bucle de 4 segundos.`}
    >
      <svg viewBox="0 0 360 220" preserveAspectRatio="xMidYMid meet" aria-hidden="true" className="w-full h-full">
        <defs>
          <radialGradient id="neckStage" cx="50%" cy="47%" r="73%">
            <stop offset="0%" stopColor="#232c23"/>
            <stop offset="60%" stopColor="#111711"/>
            <stop offset="100%" stopColor="#090909"/>
          </radialGradient>
          <linearGradient id="neckSkin" x1="0%" x2="100%" y1="0%" y2="88%">
            <stop offset="0%" stopColor="#e7b28b"/>
            <stop offset="42%" stopColor="#bc7f59"/>
            <stop offset="100%" stopColor="#82553d"/>
          </linearGradient>
          <linearGradient id="neckJersey" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#38403b"/>
            <stop offset="50%" stopColor="#1a201d"/>
            <stop offset="100%" stopColor="#0d1210"/>
          </linearGradient>
          <linearGradient id="neckHair" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#2d2c2b"/>
            <stop offset="100%" stopColor="#080b0a"/>
          </linearGradient>
          <filter id="neckGlow" x="-90%" y="-90%" width="280%" height="280%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <rect width="360" height="220" fill="url(#neckStage)"/>
        <path d="M0 185 H360" stroke="#313a30" strokeWidth="1.2"/>
        <path d="M18 14 H72 M18 14 V34 M288 14 H342 V34 M18 186 V206 H72 M288 206 H342 V186"
          fill="none" stroke="#ccff00" strokeWidth="1.5" opacity=".22"/>
        <g opacity=".27" stroke="#ccff00" fill="none" strokeWidth="1">
          <path d="M180 18 V39 M170 28 H190" />
          <circle cx="180" cy="94" r="64" strokeDasharray="4 12" />
        </g>
        {isWall && (
          <g>
            <path d="M258 20 V210" stroke="#81877b" strokeWidth="5" opacity=".8" />
            <path d="M264 24 V208" stroke="#2e362f" strokeWidth="10" />
            <rect x="250" y="89" width="9" height="21" rx="4" fill="#f5f5f5" opacity=".7"/>
          </g>
        )}
        {isSupine && (
          <g>
            <path d="M33 182 H333" stroke="#b6bcb2" strokeWidth="6" opacity=".6"/>
            <rect x="255" y="166" width="57" height="16" rx="7" fill="#d0d5d0" opacity=".3"/>
          </g>
        )}
        <g className={isSupine ? 'neck-demo-supine-layout' : ''}>
          {/* Shoulders: filled anatomical body volumes, never a stick figure. */}
          <path d="M92 220 C97 190 112 170 145 164 L157 144
            C162 151 198 151 203 144 L218 163 C252 171 268 193 272 220 Z"
            fill="url(#neckJersey)" stroke="#495148" strokeWidth="1.5"/>
          <path d="M108 220 Q105 189 135 177 L143 220 Z" fill="#101714" opacity=".9"/>
          <path d="M219 220 L227 179 Q254 190 257 220 Z" fill="#101714" opacity=".9"/>
          <path d="M147 166 Q157 178 180 181 Q202 178 213 165"
            stroke="#657166" strokeWidth="2" fill="none" opacity=".5"/>
          {/* Neck, sternocleidomastoid and clavicle */}
          <path d="M163 136 C163 147 159 155 148 165 Q180 184 212 165
            C201 155 199 144 199 136 Z" fill="url(#neckSkin)" stroke="#92664b" strokeWidth="1"/>
          <path d="M167 142 Q171 155 180 168 M194 140 Q191 156 184 166"
            stroke="#8a4e39" strokeWidth="2" fill="none" opacity=".6"/>
          <path d="M153 166 Q176 175 206 166" stroke="#e8b698" fill="none" strokeWidth="1.6" opacity=".8"/>
          <ellipse cx="180" cy="134" rx="29" ry="21" fill="#ccff00"
            opacity=".16" filter="url(#neckGlow)" className="neck-demo-neon"/>
          <g className="neck-demo-head">
            {isProfile ? (
              <>
                <path d="M149 86 C148 63 163 51 185 51 C203 52 212 67 213 82
                  L211 94 L220 100 Q222 105 215 108 L211 121
                  Q207 137 190 141 L166 137 Q150 121 149 86 Z"
                  fill="url(#neckSkin)" stroke="#87513a" strokeWidth="1.2"/>
                <path d="M148 86 C143 61 165 43 190 47
                  C211 48 215 66 212 85 L207 75 Q196 73 185 66
                  Q169 74 151 75 Z" fill="url(#neckHair)"/>
                <path d="M201 92 Q207 89 212 93" fill="none" stroke="#37251e" strokeWidth="2.5"/>
                <circle cx="207" cy="94" r="2" fill="#161716"/>
                <path d="M211 109 L219 108 M201 120 Q209 122 214 119" fill="none" stroke="#713d30" strokeWidth="1.5"/>
                <path d="M169 124 Q184 135 197 133" fill="none" stroke="#5c372a" strokeWidth="3" opacity=".32"/>
                <ellipse cx="150" cy="100" rx="7" ry="13" fill="#ad704d" stroke="#794b37" strokeWidth="1"/>
                <path d="M148 95 Q154 99 149 106" stroke="#714b37" fill="none" strokeWidth="1.4"/>
              </>
            ) : (
              <>
                <path d="M146 79 Q149 54 180 51 Q210 55 214 79
                  L211 116 Q202 141 180 143 Q156 140 148 116 Z"
                  fill="url(#neckSkin)" stroke="#87513a" strokeWidth="1.2"/>
                <path d="M145 88 Q139 56 163 48 Q191 38 208 55
                  Q220 70 214 88 L210 75 Q203 69 195 67
                  Q179 74 164 68 Q149 70 145 88 Z"
                  fill="url(#neckHair)"/>
                <ellipse cx="147" cy="101" rx="6.7" ry="12" fill="#ae7651" />
                <ellipse cx="213" cy="101" rx="6.7" ry="12" fill="#ae7651" />
                <path d="M157 95 Q164 91 171 95 M190 95 Q199 90 206 95"
                  stroke="#2d211c" strokeWidth="3.4" fill="none"/>
                <ellipse cx="165" cy="99" rx="3" ry="2" fill="#191e18"/>
                <ellipse cx="198" cy="99" rx="3" ry="2" fill="#191e18"/>
                <path d="M180 97 Q174 113 181 115 L186 113"
                  fill="none" stroke="#9e6b4e" strokeWidth="2"/>
                <path d="M172 124 Q180 127 189 123" stroke="#57362c" strokeWidth="2" fill="none"/>
                <path d="M154 121 Q180 149 206 121" stroke="#604130" strokeWidth="2.2" fill="none" opacity=".5"/>
              </>
            )}
          </g>
          {spec.resistance === 'manual' && (
            <g className="neck-demo-manual-hand">
              <path d={spec.kind === 'iso-back'
                ? 'M140 101 Q130 95 125 110 L125 132 Q138 138 143 124 L149 114 Z'
                : 'M218 87 Q231 79 238 92 L240 111 Q233 121 222 117 L213 108 Z'}
                fill="url(#neckSkin)" stroke="#aa6d4d" strokeWidth="2"/>
              <path d={spec.kind === 'iso-back'
                ? 'M130 116 Q140 114 145 117' : 'M223 95 Q230 100 233 100'}
                stroke="#86563d" strokeWidth="2" fill="none"/>
            </g>
          )}
          {spec.resistance === 'band' && (
            <g className="neck-demo-resistance">
              <path d="M156 99 Q179 86 204 98" stroke="#ccff00" strokeWidth="5.5" strokeLinecap="round" fill="none"/>
              <path d="M156 99 Q117 111 79 125 M204 98 Q245 113 278 124"
                stroke="#cbfa19" strokeWidth="3" fill="none" strokeLinecap="round"/>
              <circle cx="79" cy="125" r="8" fill="#1e241c" stroke="#ccff00" strokeWidth="2"/>
              <circle cx="278" cy="124" r="8" fill="#1e241c" stroke="#ccff00" strokeWidth="2"/>
            </g>
          )}
        </g>
        <g className="neck-demo-tension" opacity=".9">
          <path d="M140 131 Q127 120 138 109 M222 108 Q234 121 224 132"
            stroke="#ccff00" fill="none" strokeWidth="3" strokeLinecap="round"/>
          <circle cx="180" cy="135" r="20" stroke="#ccff00" strokeWidth="1.8" strokeDasharray="3 6" fill="none"/>
        </g>
        <g fontFamily="system-ui,sans-serif">
          <rect x="14" y="173" width="132" height="27" rx="13.5" fill="#10160e" stroke="#3d5021" strokeWidth=".8"/>
          <circle cx="28" cy="186.5" r="4" fill="#ccff00" className="neck-demo-status"/>
          <text x="40" y="191" fontSize="10.5" fontWeight="700" fill="#e8f2e2">
            {spec.isometric ? 'ISOMÉTRICO · SIN GIRO' : 'MOVIMIENTO CONTROLADO'}
          </text>
        </g>
      </svg>
      <span className="sr-only">{spec.label}. Reduce el rango si aparece molestia y evita movimientos bruscos.</span>
    </div>
  );
};
