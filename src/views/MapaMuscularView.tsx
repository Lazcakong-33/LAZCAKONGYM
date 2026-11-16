import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUp,
  BarChart2,
  Bell,
  Bookmark,
  Calendar,
  ChevronRight,
  Clock,
  Crosshair,
  Dumbbell,
  Layers,
  Lightbulb,
  MapPin,
  RefreshCw,
  Settings,
  Share2,
  Target,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CompletedWorkout, Profile, Routine } from '../types';
import { TabType } from '../components/Navigation';
import {
  BiometricMuscleId,
  CanonicalMuscleId,
  computeOverallAthleteSummary,
  computePeriodHistorySummary,
  computeRealTimeRecovery,
} from '../utils/muscleRecoveryEngine';

interface MapaMuscularViewProps {
  history?: CompletedWorkout[];
  routines?: Routine[];
  activeProfile?: Profile;
  onNavigateTab: (tab: TabType) => void;
  onStartWorkout?: (routine: Routine) => void;
  initialSelectedMuscle?: string | null;
  onConsumeInitialMuscle?: () => void;
}

export type VisualizationMode = 'recuperacion' | 'exploracion';

// Identificadores de todos los músculos anatómicos individuales
export type InteractiveMuscleId =
  // VISTA FRONTAL
  | 'pectoral_superior_left'
  | 'pectoral_superior_right'
  | 'pectoral_medio_left'
  | 'pectoral_medio_right'
  | 'pectoral_inferior_left'
  | 'pectoral_inferior_right'
  | 'deltoides_anterior_left'
  | 'deltoides_anterior_right'
  | 'biceps_left'
  | 'biceps_right'
  | 'antebrazo_left'
  | 'antebrazo_right'
  | 'recto_abdominal'
  | 'oblicuos_left'
  | 'oblicuos_right'
  | 'cuadriceps_recto_left'
  | 'cuadriceps_recto_right'
  | 'cuadriceps_vasto_ext_left'
  | 'cuadriceps_vasto_ext_right'
  | 'cuadriceps_vasto_int_left'
  | 'cuadriceps_vasto_int_right'
  | 'aductores_left'
  | 'aductores_right'
  | 'tibial_anterior_left'
  | 'tibial_anterior_right'
  // VISTA POSTERIOR
  | 'trapecio_superior'
  | 'trapecio_medio_inferior'
  | 'deltoides_posterior_left'
  | 'deltoides_posterior_right'
  | 'romboides_left'
  | 'romboides_right'
  | 'dorsal_ancho_left'
  | 'dorsal_ancho_right'
  | 'erectores_espinales'
  | 'triceps_cabeza_larga_left'
  | 'triceps_cabeza_larga_right'
  | 'triceps_cabeza_lateral_left'
  | 'triceps_cabeza_lateral_right'
  | 'gluteo_mayor_left'
  | 'gluteo_mayor_right'
  | 'gluteo_medio_left'
  | 'gluteo_medio_right'
  | 'isquiotibiales_biceps_femoral_left'
  | 'isquiotibiales_biceps_femoral_right'
  | 'isquiotibiales_semitendinoso_left'
  | 'isquiotibiales_semitendinoso_right'
  | 'gastrocnemio_lateral_left'
  | 'gastrocnemio_lateral_right'
  | 'gastrocnemio_medial_left'
  | 'gastrocnemio_medial_right'
  | 'soleo_left'
  | 'soleo_right';

interface DetailedMuscleMetadata {
  id: InteractiveMuscleId;
  name: string;
  shortGroup: string;
  view: 'frontal' | 'posterior';
  parentBiometricId: BiometricMuscleId;
  cropBox: string;
  svgPath: string; // Contorno anatómico curvo con curvas Bézier cúbicas (C)
  unifiedGroupPath?: string; // Silueta orgánica continua del grupo completo para evitar costuras internas
  location: string;
  biomechanicalFunction: string;
  suggestedExercises: string[];
  secondaryMusclesList: string[];
}

// ============================================================================
// MÁSCARAS ANATÓMICAS ORGÁNICAS UNIFICADAS (Curvas Bézier suaves sin costuras)
// Utilizadas en la CAPA VISUAL cuando se ilumina el grupo muscular completo
// ============================================================================
const UNIFIED_GROUP_PATHS = {
  pectoral_left:
    'M 253 220 C 238 210, 210 208, 195 220 C 184 231, 183 258, 191 276 C 198 288, 224 291, 247 284 C 253 280, 254 252, 253 220 Z',
  pectoral_right:
    'M 259 220 C 274 210, 302 208, 317 220 C 328 231, 329 258, 321 276 C 314 288, 288 291, 265 284 C 259 280, 258 252, 259 220 Z',
  quad_left:
    'M 206 398 C 186 420, 173 465, 175 514 C 177 542, 188 556, 206 556 C 224 556, 234 542, 236 516 C 240 478, 238 434, 224 408 C 218 400, 212 396, 206 398 Z',
  quad_right:
    'M 306 398 C 326 420, 339 465, 337 514 C 335 542, 324 556, 306 556 C 288 556, 278 542, 276 516 C 272 478, 274 434, 288 408 C 294 400, 300 396, 306 398 Z',
  traps_full:
    'M 744 164 C 724 170, 710 192, 680 212 C 694 232, 718 286, 744 338 C 770 286, 794 232, 808 212 C 778 192, 764 170, 744 164 Z',
  dorsal_left:
    'M 688 242 C 674 268, 672 318, 688 386 C 706 380, 726 360, 738 336 C 728 298, 712 262, 688 242 Z',
  dorsal_right:
    'M 800 242 C 814 268, 816 318, 800 386 C 782 380, 762 360, 750 336 C 760 298, 776 262, 800 242 Z',
  triceps_left:
    'M 656 262 C 638 278, 632 308, 638 336 C 646 346, 664 344, 672 328 C 678 306, 674 276, 656 262 Z',
  triceps_right:
    'M 832 262 C 850 278, 856 308, 850 336 C 842 346, 824 344, 816 328 C 810 306, 814 276, 832 262 Z',
  glutes_left:
    'M 692 388 C 676 404, 672 436, 678 466 C 684 486, 712 492, 734 482 C 744 474, 744 452, 742 428 C 734 406, 712 392, 692 388 Z',
  glutes_right:
    'M 796 388 C 812 404, 816 436, 810 466 C 804 486, 776 492, 754 482 C 744 474, 744 452, 746 428 C 754 406, 776 392, 796 388 Z',
  hamstrings_left:
    'M 680 476 C 668 504, 668 538, 678 564 C 692 570, 714 566, 724 548 C 732 526, 734 498, 728 482 C 712 486, 694 484, 680 476 Z',
  hamstrings_right:
    'M 808 476 C 820 504, 820 538, 810 564 C 796 570, 774 566, 764 548 C 756 526, 754 498, 760 482 C 776 486, 794 484, 808 476 Z',
  calves_left:
    'M 678 560 C 660 582, 656 614, 666 644 C 670 664, 674 680, 682 686 C 692 680, 702 652, 708 624 C 714 596, 706 568, 678 560 Z',
  calves_right:
    'M 810 560 C 828 582, 832 614, 822 644 C 818 664, 814 680, 806 686 C 796 680, 786 652, 780 624 C 774 596, 782 568, 810 560 Z',
};

// Registro completo de cada músculo con contornos Bézier orgánicos calibrados a anatomia-frontal.png y anatomia-posterior.png
const DETAILED_MUSCLE_REGISTRY: Record<InteractiveMuscleId, DetailedMuscleMetadata> = {
  // =========================================================================
  // VISTA FRONTAL (viewBox: "96 88 320 652", eje central X = 256)
  // =========================================================================
  pectoral_superior_left: {
    id: 'pectoral_superior_left',
    name: 'Pectoral Superior (Haz Clavicular)',
    shortGroup: 'PECTORAL',
    view: 'frontal',
    parentBiometricId: 'chest_left',
    cropBox: '170 190 172 120',
    svgPath:
      'M 253 222 C 238 212, 212 209, 197 220 C 189 227, 187 236, 189 244 C 208 239, 232 239, 253 242 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.pectoral_left,
    location: 'Porción superior del pecho, adyacente a la clavícula.',
    biomechanicalFunction: 'Flexión anterior del brazo y aducción oblicua ascendente.',
    suggestedExercises: ['Press inclinado con mancuernas', 'Press de banca con barra', 'Aperturas en máquina'],
    secondaryMusclesList: ['Deltoides anterior', 'Tríceps braquial'],
  },
  pectoral_superior_right: {
    id: 'pectoral_superior_right',
    name: 'Pectoral Superior (Haz Clavicular)',
    shortGroup: 'PECTORAL',
    view: 'frontal',
    parentBiometricId: 'chest_right',
    cropBox: '170 190 172 120',
    svgPath:
      'M 259 222 C 274 212, 300 209, 315 220 C 323 227, 325 236, 323 244 C 304 239, 280 239, 259 242 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.pectoral_right,
    location: 'Porción superior del pecho, adyacente a la clavícula.',
    biomechanicalFunction: 'Flexión anterior del brazo y aducción oblicua ascendente.',
    suggestedExercises: ['Press inclinado con mancuernas', 'Press de banca con barra', 'Aperturas en máquina'],
    secondaryMusclesList: ['Deltoides anterior', 'Tríceps braquial'],
  },
  pectoral_medio_left: {
    id: 'pectoral_medio_left',
    name: 'Pectoral Mayor (Haz Esternal)',
    shortGroup: 'PECTORAL',
    view: 'frontal',
    parentBiometricId: 'chest_left',
    cropBox: '170 190 172 120',
    svgPath:
      'M 253 240 C 232 238, 206 239, 188 244 C 186 254, 187 264, 191 271 C 210 267, 233 266, 253 265 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.pectoral_left,
    location: 'Cuerpo central del músculo pectoral, anclado al esternón.',
    biomechanicalFunction: 'Aducción horizontal del húmero y empuje horizontal máximo.',
    suggestedExercises: ['Press de banca con barra', 'Press inclinado con mancuernas', 'Aperturas en máquina'],
    secondaryMusclesList: ['Tríceps (cabeza lateral)', 'Deltoides anterior'],
  },
  pectoral_medio_right: {
    id: 'pectoral_medio_right',
    name: 'Pectoral Mayor (Haz Esternal)',
    shortGroup: 'PECTORAL',
    view: 'frontal',
    parentBiometricId: 'chest_right',
    cropBox: '170 190 172 120',
    svgPath:
      'M 259 240 C 280 238, 306 239, 324 244 C 326 254, 325 264, 321 271 C 302 267, 279 266, 259 265 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.pectoral_right,
    location: 'Cuerpo central del músculo pectoral, anclado al esternón.',
    biomechanicalFunction: 'Aducción horizontal del húmero y empuje horizontal máximo.',
    suggestedExercises: ['Press de banca con barra', 'Press inclinado con mancuernas', 'Aperturas en máquina'],
    secondaryMusclesList: ['Tríceps (cabeza lateral)', 'Deltoides anterior'],
  },
  pectoral_inferior_left: {
    id: 'pectoral_inferior_left',
    name: 'Pectoral Inferior (Haz Abdominal)',
    shortGroup: 'PECTORAL',
    view: 'frontal',
    parentBiometricId: 'chest_left',
    cropBox: '170 190 172 120',
    svgPath:
      'M 253 263 C 232 263, 208 265, 190 270 C 196 286, 222 290, 246 283 C 252 279, 253 271, 253 263 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.pectoral_left,
    location: 'Borde inferior redondeado del pectoral mayor.',
    biomechanicalFunction: 'Depresión escapular y aducción en plano descendente.',
    suggestedExercises: ['Fondos en paralelas', 'Press declinado', 'Cruces en polea alta'],
    secondaryMusclesList: ['Tríceps braquial', 'Pectoral menor'],
  },
  pectoral_inferior_right: {
    id: 'pectoral_inferior_right',
    name: 'Pectoral Inferior (Haz Abdominal)',
    shortGroup: 'PECTORAL',
    view: 'frontal',
    parentBiometricId: 'chest_right',
    cropBox: '170 190 172 120',
    svgPath:
      'M 259 263 C 280 263, 304 265, 322 270 C 316 286, 290 290, 266 283 C 260 279, 259 271, 259 263 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.pectoral_right,
    location: 'Borde inferior redondeado del pectoral mayor.',
    biomechanicalFunction: 'Depresión escapular y aducción en plano descendente.',
    suggestedExercises: ['Fondos en paralelas', 'Press declinado', 'Cruces en polea alta'],
    secondaryMusclesList: ['Tríceps braquial', 'Pectoral menor'],
  },
  deltoides_anterior_left: {
    id: 'deltoides_anterior_left',
    name: 'Deltoides Anterior & Lateral',
    shortGroup: 'DELTOIDES',
    view: 'frontal',
    parentBiometricId: 'deltoid_front_left',
    cropBox: '140 195 232 125',
    svgPath:
      'M 206 209 C 174 210, 154 228, 154 258 C 154 276, 164 290, 174 292 C 182 276, 188 238, 206 209 Z',
    location: 'Cabeza anterior y lateral del hombro.',
    biomechanicalFunction: 'Flexión frontal y abducción del brazo en empujes verticales.',
    suggestedExercises: ['Press militar con barra', 'Elevaciones laterales', 'Press con mancuernas'],
    secondaryMusclesList: ['Tríceps braquial', 'Trapecio superior'],
  },
  deltoides_anterior_right: {
    id: 'deltoides_anterior_right',
    name: 'Deltoides Anterior & Lateral',
    shortGroup: 'DELTOIDES',
    view: 'frontal',
    parentBiometricId: 'deltoid_front_right',
    cropBox: '140 195 232 125',
    svgPath:
      'M 306 209 C 338 210, 358 228, 358 258 C 358 276, 348 290, 338 292 C 330 276, 324 238, 306 209 Z',
    location: 'Cabeza anterior y lateral del hombro.',
    biomechanicalFunction: 'Flexión frontal y abducción del brazo en empujes verticales.',
    suggestedExercises: ['Press militar con barra', 'Elevaciones laterales', 'Press con mancuernas'],
    secondaryMusclesList: ['Tríceps braquial', 'Trapecio superior'],
  },
  biceps_left: {
    id: 'biceps_left',
    name: 'Bíceps Braquial',
    shortGroup: 'BÍCEPS',
    view: 'frontal',
    parentBiometricId: 'biceps_left',
    cropBox: '132 250 248 125',
    svgPath:
      'M 181 268 C 170 266, 156 282, 151 304 C 147 322, 152 338, 162 341 C 174 340, 183 320, 184 296 C 185 280, 184 270, 181 268 Z',
    location: 'Compartimento anterior del brazo (cabezas corta y larga).',
    biomechanicalFunction: 'Flexión de codo y supinación del antebrazo.',
    suggestedExercises: ['Curl con barra Z', 'Curl inclinado con mancuernas', 'Curl martillo'],
    secondaryMusclesList: ['Braquial anterior', 'Braquiorradial'],
  },
  biceps_right: {
    id: 'biceps_right',
    name: 'Bíceps Braquial',
    shortGroup: 'BÍCEPS',
    view: 'frontal',
    parentBiometricId: 'biceps_right',
    cropBox: '132 250 248 125',
    svgPath:
      'M 331 268 C 342 266, 356 282, 361 304 C 365 322, 360 338, 350 341 C 338 340, 329 320, 328 296 C 327 280, 328 270, 331 268 Z',
    location: 'Compartimento anterior del brazo (cabezas corta y larga).',
    biomechanicalFunction: 'Flexión de codo y supinación del antebrazo.',
    suggestedExercises: ['Curl con barra Z', 'Curl inclinado con mancuernas', 'Curl martillo'],
    secondaryMusclesList: ['Braquial anterior', 'Braquiorradial'],
  },
  antebrazo_left: {
    id: 'antebrazo_left',
    name: 'Antebrazos (Braquiorradial & Flexores)',
    shortGroup: 'ANTEBRAZOS',
    view: 'frontal',
    parentBiometricId: 'biceps_left',
    cropBox: '115 325 282 130',
    svgPath:
      'M 145 332 C 131 355, 124 394, 124 430 C 130 436, 140 436, 145 430 C 158 396, 171 364, 167 342 C 160 335, 151 331, 145 332 Z',
    location: 'Compartimento anterolateral e interno del antebrazo.',
    biomechanicalFunction: 'Flexión de muñeca, pronosupinación y fuerza de agarre.',
    suggestedExercises: ['Paseo del granjero', 'Curl de muñeca', 'Curl inverso con barra'],
    secondaryMusclesList: ['Flexores profundos de los dedos'],
  },
  antebrazo_right: {
    id: 'antebrazo_right',
    name: 'Antebrazos (Braquiorradial & Flexores)',
    shortGroup: 'ANTEBRAZOS',
    view: 'frontal',
    parentBiometricId: 'biceps_right',
    cropBox: '115 325 282 130',
    svgPath:
      'M 367 332 C 381 355, 388 394, 388 430 C 382 436, 372 436, 367 430 C 354 396, 341 364, 345 342 C 352 335, 361 331, 367 332 Z',
    location: 'Compartimento anterolateral e interno del antebrazo.',
    biomechanicalFunction: 'Flexión de muñeca, pronosupinación y fuerza de agarre.',
    suggestedExercises: ['Paseo del granjero', 'Curl de muñeca', 'Curl inverso con barra'],
    secondaryMusclesList: ['Flexores profundos de los dedos'],
  },
  recto_abdominal: {
    id: 'recto_abdominal',
    name: 'Recto Abdominal (Core)',
    shortGroup: 'ABDOMINALES',
    view: 'frontal',
    parentBiometricId: 'abs',
    cropBox: '185 270 142 180',
    svgPath:
      'M 232 284 C 239 280, 248 281, 253 286 C 254 295, 254 305, 252 312 C 244 314, 234 313, 229 308 C 228 299, 229 290, 232 284 Z ' +
      'M 280 284 C 273 280, 264 281, 259 286 C 258 295, 258 305, 260 312 C 268 314, 278 313, 283 308 C 284 299, 283 290, 280 284 Z ' +
      'M 229 318 C 236 316, 246 316, 252 319 C 254 328, 254 338, 252 346 C 244 348, 234 347, 228 342 C 227 333, 227 324, 229 318 Z ' +
      'M 283 318 C 276 316, 266 316, 260 319 C 258 328, 258 338, 260 346 C 268 348, 278 347, 284 342 C 285 333, 285 324, 283 318 Z ' +
      'M 230 352 C 237 350, 246 350, 252 353 C 254 361, 254 371, 252 379 C 244 381, 235 380, 230 375 C 229 367, 229 358, 230 352 Z ' +
      'M 282 352 C 275 350, 266 350, 260 353 C 258 361, 258 371, 260 379 C 268 381, 277 380, 282 375 C 283 367, 283 358, 282 352 Z ' +
      'M 232 385 C 239 384, 247 385, 252 388 C 254 406, 253 426, 250 440 C 242 430, 234 408, 232 385 Z ' +
      'M 280 385 C 273 384, 265 385, 260 388 C 258 406, 259 426, 262 440 C 270 430, 278 408, 280 385 Z',
    location: 'Cara anterior del abdomen dividida por intersecciones tendinosas.',
    biomechanicalFunction: 'Flexión de columna lumbar y estabilidad del core.',
    suggestedExercises: ['Elevación de piernas colgado', 'Rueda abdominal', 'Crunch en polea alta'],
    secondaryMusclesList: ['Transverso abdominal', 'Oblicuo interno'],
  },
  oblicuos_left: {
    id: 'oblicuos_left',
    name: 'Oblicuos Externos & Serrato',
    shortGroup: 'OBLICUOS',
    view: 'frontal',
    parentBiometricId: 'abs',
    cropBox: '185 270 142 180',
    svgPath:
      'M 224 288 C 212 292, 203 310, 202 334 C 201 364, 210 398, 228 418 C 228 388, 226 338, 224 288 Z',
    location: 'Pared anterolateral del torso entre costillas y cresta ilíaca.',
    biomechanicalFunction: 'Rotación e inclinación lateral del tronco, estabilidad antirotacional.',
    suggestedExercises: ['Press Pallof', 'Leñador en polea', 'Plancha lateral'],
    secondaryMusclesList: ['Recto abdominal', 'Serrato anterior'],
  },
  oblicuos_right: {
    id: 'oblicuos_right',
    name: 'Oblicuos Externos & Serrato',
    shortGroup: 'OBLICUOS',
    view: 'frontal',
    parentBiometricId: 'abs',
    cropBox: '185 270 142 180',
    svgPath:
      'M 288 288 C 300 292, 309 310, 310 334 C 311 364, 302 398, 284 418 C 284 388, 286 338, 288 288 Z',
    location: 'Pared anterolateral del torso entre costillas y cresta ilíaca.',
    biomechanicalFunction: 'Rotación e inclinación lateral del tronco, estabilidad antirotacional.',
    suggestedExercises: ['Press Pallof', 'Leñador en polea', 'Plancha lateral'],
    secondaryMusclesList: ['Recto abdominal', 'Serrato anterior'],
  },
  cuadriceps_recto_left: {
    id: 'cuadriceps_recto_left',
    name: 'Cuádriceps (Recto Femoral)',
    shortGroup: 'CUÁDRICEPS',
    view: 'frontal',
    parentBiometricId: 'quad_left',
    cropBox: '162 395 188 175',
    svgPath:
      'M 208 400 C 197 436, 194 484, 199 528 C 203 542, 210 542, 214 528 C 221 484, 221 436, 208 400 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.quad_left,
    location: 'Vientre fusiforme central y anterior del muslo.',
    biomechanicalFunction: 'Extensión de rodilla y flexión de cadera.',
    suggestedExercises: ['Sentadilla con barra', 'Prensa 45°', 'Extensiones de cuádriceps'],
    secondaryMusclesList: ['Vasto lateral', 'Vasto medial'],
  },
  cuadriceps_recto_right: {
    id: 'cuadriceps_recto_right',
    name: 'Cuádriceps (Recto Femoral)',
    shortGroup: 'CUÁDRICEPS',
    view: 'frontal',
    parentBiometricId: 'quad_right',
    cropBox: '162 395 188 175',
    svgPath:
      'M 304 400 C 315 436, 318 484, 313 528 C 309 542, 302 542, 298 528 C 291 484, 291 436, 304 400 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.quad_right,
    location: 'Vientre fusiforme central y anterior del muslo.',
    biomechanicalFunction: 'Extensión de rodilla y flexión de cadera.',
    suggestedExercises: ['Sentadilla con barra', 'Prensa 45°', 'Extensiones de cuádriceps'],
    secondaryMusclesList: ['Vasto lateral', 'Vasto medial'],
  },
  cuadriceps_vasto_ext_left: {
    id: 'cuadriceps_vasto_ext_left',
    name: 'Cuádriceps (Vasto Lateral)',
    shortGroup: 'CUÁDRICEPS',
    view: 'frontal',
    parentBiometricId: 'quad_left',
    cropBox: '162 395 188 175',
    svgPath:
      'M 202 406 C 184 428, 174 468, 176 512 C 178 536, 186 550, 194 544 C 191 504, 194 450, 202 406 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.quad_left,
    location: 'Arco lateral externo del muslo.',
    biomechanicalFunction: 'Extensión de rodilla de alta fuerza.',
    suggestedExercises: ['Sentadilla Hack', 'Prensa de piernas', 'Zancadas búlgaras'],
    secondaryMusclesList: ['Recto femoral', 'Glúteo mayor'],
  },
  cuadriceps_vasto_ext_right: {
    id: 'cuadriceps_vasto_ext_right',
    name: 'Cuádriceps (Vasto Lateral)',
    shortGroup: 'CUÁDRICEPS',
    view: 'frontal',
    parentBiometricId: 'quad_right',
    cropBox: '162 395 188 175',
    svgPath:
      'M 310 406 C 328 428, 338 468, 336 512 C 334 536, 326 550, 318 544 C 321 504, 318 450, 310 406 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.quad_right,
    location: 'Arco lateral externo del muslo.',
    biomechanicalFunction: 'Extensión de rodilla de alta fuerza.',
    suggestedExercises: ['Sentadilla Hack', 'Prensa de piernas', 'Zancadas búlgaras'],
    secondaryMusclesList: ['Recto femoral', 'Glúteo mayor'],
  },
  cuadriceps_vasto_int_left: {
    id: 'cuadriceps_vasto_int_left',
    name: 'Cuádriceps (Vasto Medial)',
    shortGroup: 'CUÁDRICEPS',
    view: 'frontal',
    parentBiometricId: 'quad_left',
    cropBox: '162 395 188 175',
    svgPath:
      'M 222 472 C 216 494, 212 522, 214 544 C 218 554, 228 552, 232 536 C 236 514, 232 486, 222 472 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.quad_left,
    location: 'Gota anatómica anteromedial sobre la articulación de la rodilla.',
    biomechanicalFunction: 'Bloqueo terminal de rodilla y estabilización rotuliana.',
    suggestedExercises: ['Sentadilla profunda', 'Prensa pies bajos', 'Extensiones de cuádriceps'],
    secondaryMusclesList: ['Recto femoral', 'Aductores'],
  },
  cuadriceps_vasto_int_right: {
    id: 'cuadriceps_vasto_int_right',
    name: 'Cuádriceps (Vasto Medial)',
    shortGroup: 'CUÁDRICEPS',
    view: 'frontal',
    parentBiometricId: 'quad_right',
    cropBox: '162 395 188 175',
    svgPath:
      'M 290 472 C 296 494, 300 522, 298 544 C 294 554, 284 552, 280 536 C 276 514, 280 486, 290 472 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.quad_right,
    location: 'Gota anatómica anteromedial sobre la articulación de la rodilla.',
    biomechanicalFunction: 'Bloqueo terminal de rodilla y estabilización rotuliana.',
    suggestedExercises: ['Sentadilla profunda', 'Prensa pies bajos', 'Extensiones de cuádriceps'],
    secondaryMusclesList: ['Recto femoral', 'Aductores'],
  },
  aductores_left: {
    id: 'aductores_left',
    name: 'Aductores de Cadera',
    shortGroup: 'ADUCTORES',
    view: 'frontal',
    parentBiometricId: 'quad_left',
    cropBox: '175 405 162 150',
    svgPath:
      'M 222 414 C 218 438, 218 464, 223 480 C 232 474, 241 452, 245 428 C 239 418, 230 414, 222 414 Z',
    location: 'Compartimento medial interno del muslo.',
    biomechanicalFunction: 'Aducción y estabilización pélvica en sentadillas.',
    suggestedExercises: ['Máquina de aductores', 'Sentadilla Sumo', 'Zancadas laterales'],
    secondaryMusclesList: ['Grácil', 'Pectíneo'],
  },
  aductores_right: {
    id: 'aductores_right',
    name: 'Aductores de Cadera',
    shortGroup: 'ADUCTORES',
    view: 'frontal',
    parentBiometricId: 'quad_right',
    cropBox: '175 405 162 150',
    svgPath:
      'M 290 414 C 294 438, 294 464, 289 480 C 280 474, 271 452, 267 428 C 273 418, 282 414, 290 414 Z',
    location: 'Compartimento medial interno del muslo.',
    biomechanicalFunction: 'Aducción y estabilización pélvica en sentadillas.',
    suggestedExercises: ['Máquina de aductores', 'Sentadilla Sumo', 'Zancadas laterales'],
    secondaryMusclesList: ['Grácil', 'Pectíneo'],
  },
  tibial_anterior_left: {
    id: 'tibial_anterior_left',
    name: 'Tibial Anterior & Pierna Frontal',
    shortGroup: 'TIBIALES',
    view: 'frontal',
    parentBiometricId: 'calves_front_left',
    cropBox: '160 555 192 145',
    svgPath:
      'M 184 568 C 172 588, 170 626, 178 666 C 184 672, 190 666, 193 644 C 196 614, 193 584, 184 568 Z ' +
      'M 204 574 C 198 594, 198 624, 202 652 C 210 644, 216 618, 214 592 C 212 580, 208 574, 204 574 Z',
    location: 'Compartimento anterolateral y medial de la pierna inferior.',
    biomechanicalFunction: 'Dorsiflexión del tobillo y estabilidad dinámica.',
    suggestedExercises: ['Elevación tibial', 'Elevación de talones de pie'],
    secondaryMusclesList: ['Gastrocnemio medial', 'Sóleo'],
  },
  tibial_anterior_right: {
    id: 'tibial_anterior_right',
    name: 'Tibial Anterior & Pierna Frontal',
    shortGroup: 'TIBIALES',
    view: 'frontal',
    parentBiometricId: 'calves_front_right',
    cropBox: '160 555 192 145',
    svgPath:
      'M 328 568 C 340 588, 342 626, 334 666 C 328 672, 322 666, 319 644 C 316 614, 319 584, 328 568 Z ' +
      'M 308 574 C 314 594, 314 624, 310 652 C 302 644, 296 618, 298 592 C 300 580, 304 574, 308 574 Z',
    location: 'Compartimento anterolateral y medial de la pierna inferior.',
    biomechanicalFunction: 'Dorsiflexión del tobillo y estabilidad dinámica.',
    suggestedExercises: ['Elevación tibial', 'Elevación de talones de pie'],
    secondaryMusclesList: ['Gastrocnemio medial', 'Sóleo'],
  },

  // =========================================================================
  // VISTA POSTERIOR (viewBox: "584 88 320 652", eje central X = 744)
  // =========================================================================
  trapecio_superior: {
    id: 'trapecio_superior',
    name: 'Trapecio Superior',
    shortGroup: 'TRAPECIOS',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    cropBox: '650 155 188 150',
    svgPath:
      'M 744 166 C 726 172, 712 194, 682 212 C 705 220, 725 226, 744 228 C 763 226, 783 220, 806 212 C 776 194, 762 172, 744 166 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.traps_full,
    location: 'Base occipital y cuello posterior hacia las clavículas.',
    biomechanicalFunction: 'Elevación escapular y soporte cervical.',
    suggestedExercises: ['Encogimientos con barra', 'Encogimientos con mancuernas', 'Paseo del granjero'],
    secondaryMusclesList: ['Elevador de la escápula'],
  },
  trapecio_medio_inferior: {
    id: 'trapecio_medio_inferior',
    name: 'Trapecio Medio & Inferior',
    shortGroup: 'TRAPECIOS',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    cropBox: '650 190 188 165',
    svgPath:
      'M 744 214 C 722 216, 702 224, 694 234 C 708 262, 728 302, 744 338 C 760 302, 780 262, 794 234 C 786 224, 766 216, 744 214 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.traps_full,
    location: 'Región interescapular media e inferior de la espalda alta.',
    biomechanicalFunction: 'Retracción y depresión escapular.',
    suggestedExercises: ['Face pull en polea', 'Remo con barra', 'Tirones en Y'],
    secondaryMusclesList: ['Romboides', 'Deltoides posterior'],
  },
  deltoides_posterior_left: {
    id: 'deltoides_posterior_left',
    name: 'Deltoides Posterior',
    shortGroup: 'DELTOIDES POST.',
    view: 'posterior',
    parentBiometricId: 'deltoid_front_left',
    cropBox: '630 195 228 135',
    svgPath:
      'M 692 214 C 664 216, 644 234, 644 262 C 646 274, 658 278, 672 268 C 684 256, 694 234, 692 214 Z',
    location: 'Cara posterior del hombro sobre la espina escapular.',
    biomechanicalFunction: 'Abducción horizontal y extensión posterior del húmero.',
    suggestedExercises: ['Pájaros con mancuernas', 'Face pull en polea', 'Aperturas inversas en máquina'],
    secondaryMusclesList: ['Infraespinoso', 'Redondo menor'],
  },
  deltoides_posterior_right: {
    id: 'deltoides_posterior_right',
    name: 'Deltoides Posterior',
    shortGroup: 'DELTOIDES POST.',
    view: 'posterior',
    parentBiometricId: 'deltoid_front_right',
    cropBox: '630 195 228 135',
    svgPath:
      'M 796 214 C 824 216, 844 234, 844 262 C 842 274, 830 278, 816 268 C 804 256, 794 234, 796 214 Z',
    location: 'Cara posterior del hombro sobre la espina escapular.',
    biomechanicalFunction: 'Abducción horizontal y extensión posterior del húmero.',
    suggestedExercises: ['Pájaros con mancuernas', 'Face pull en polea', 'Aperturas inversas en máquina'],
    secondaryMusclesList: ['Infraespinoso', 'Redondo menor'],
  },
  romboides_left: {
    id: 'romboides_left',
    name: 'Romboides & Redondo Mayor',
    shortGroup: 'ROMBOIDES',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    cropBox: '650 205 188 145',
    svgPath:
      'M 694 236 C 682 250, 672 266, 674 280 C 688 286, 710 286, 722 280 C 714 262, 704 246, 694 236 Z',
    location: 'Región escapular posteromedial y axilar superior.',
    biomechanicalFunction: 'Retracción escapular y tracción dorsal.',
    suggestedExercises: ['Remo con barra T', 'Remo con mancuerna', 'Jalón al pecho'],
    secondaryMusclesList: ['Trapecio medio', 'Dorsal ancho'],
  },
  romboides_right: {
    id: 'romboides_right',
    name: 'Romboides & Redondo Mayor',
    shortGroup: 'ROMBOIDES',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    cropBox: '650 205 188 145',
    svgPath:
      'M 794 236 C 806 250, 816 266, 814 280 C 800 286, 778 286, 766 280 C 774 262, 784 246, 794 236 Z',
    location: 'Región escapular posteromedial y axilar superior.',
    biomechanicalFunction: 'Retracción escapular y tracción dorsal.',
    suggestedExercises: ['Remo con barra T', 'Remo con mancuerna', 'Jalón al pecho'],
    secondaryMusclesList: ['Trapecio medio', 'Dorsal ancho'],
  },
  dorsal_ancho_left: {
    id: 'dorsal_ancho_left',
    name: 'Dorsal Ancho (Latissimus Dorsi)',
    shortGroup: 'DORSALES',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    cropBox: '645 235 198 175',
    svgPath:
      'M 674 280 C 674 318, 682 356, 692 388 C 708 380, 724 362, 734 342 C 726 314, 716 292, 674 280 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.dorsal_left,
    location: 'Abanico lateral de la espalda desde la fascia toracolumbar al húmero.',
    biomechanicalFunction: 'Aducción, extensión y tracción vertical/horizontal del brazo.',
    suggestedExercises: ['Dominadas pronas', 'Jalón en polea alta', 'Remo con barra'],
    secondaryMusclesList: ['Redondo mayor', 'Bíceps braquial'],
  },
  dorsal_ancho_right: {
    id: 'dorsal_ancho_right',
    name: 'Dorsal Ancho (Latissimus Dorsi)',
    shortGroup: 'DORSALES',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    cropBox: '645 235 198 175',
    svgPath:
      'M 814 280 C 814 318, 806 356, 796 388 C 780 380, 764 362, 754 342 C 762 314, 772 292, 814 280 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.dorsal_right,
    location: 'Abanico lateral de la espalda desde la fascia toracolumbar al húmero.',
    biomechanicalFunction: 'Aducción, extensión y tracción vertical/horizontal del brazo.',
    suggestedExercises: ['Dominadas pronas', 'Jalón en polea alta', 'Remo con barra'],
    secondaryMusclesList: ['Redondo mayor', 'Bíceps braquial'],
  },
  erectores_espinales: {
    id: 'erectores_espinales',
    name: 'Erectores Espinales (Zona Lumbar)',
    shortGroup: 'ERECTORES',
    view: 'posterior',
    parentBiometricId: 'hamstrings_left',
    cropBox: '660 315 168 135',
    svgPath:
      'M 744 335 C 730 352, 718 374, 720 398 C 722 414, 734 426, 744 428 C 754 426, 766 414, 768 398 C 770 374, 758 352, 744 335 Z',
    location: 'Columnas paravertebrales de la región toracolumbar.',
    biomechanicalFunction: 'Extensión y estabilización isométrica de la columna vertebral.',
    suggestedExercises: ['Peso muerto convencional', 'Hiperextensiones 45°', 'Buenos días'],
    secondaryMusclesList: ['Glúteo mayor', 'Isquiotibiales'],
  },
  triceps_cabeza_larga_left: {
    id: 'triceps_cabeza_larga_left',
    name: 'Tríceps Braquial (Cabeza Larga)',
    shortGroup: 'TRÍCEPS',
    view: 'posterior',
    parentBiometricId: 'triceps_back_left',
    cropBox: '615 235 258 140',
    svgPath:
      'M 668 270 C 658 292, 654 318, 658 340 C 666 342, 674 324, 674 298 C 674 284, 672 274, 668 270 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.triceps_left,
    location: 'Porción posteromedial biarticular del brazo.',
    biomechanicalFunction: 'Extensión de codo y estabilización retroversa del hombro.',
    suggestedExercises: ['Press francés con barra Z', 'Extensiones en polea', 'Fondos en paralelas'],
    secondaryMusclesList: ['Cabeza lateral del tríceps', 'Ancóneo'],
  },
  triceps_cabeza_larga_right: {
    id: 'triceps_cabeza_larga_right',
    name: 'Tríceps Braquial (Cabeza Larga)',
    shortGroup: 'TRÍCEPS',
    view: 'posterior',
    parentBiometricId: 'triceps_back_right',
    cropBox: '615 235 258 140',
    svgPath:
      'M 820 270 C 830 292, 834 318, 830 340 C 822 342, 814 324, 814 298 C 814 284, 816 274, 820 270 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.triceps_right,
    location: 'Porción posteromedial biarticular del brazo.',
    biomechanicalFunction: 'Extensión de codo y estabilización retroversa del hombro.',
    suggestedExercises: ['Press francés con barra Z', 'Extensiones en polea', 'Fondos en paralelas'],
    secondaryMusclesList: ['Cabeza lateral del tríceps', 'Ancóneo'],
  },
  triceps_cabeza_lateral_left: {
    id: 'triceps_cabeza_lateral_left',
    name: 'Tríceps Braquial (Cabeza Lateral)',
    shortGroup: 'TRÍCEPS',
    view: 'posterior',
    parentBiometricId: 'triceps_lateral_left',
    cropBox: '615 235 258 140',
    svgPath:
      'M 648 266 C 636 286, 632 312, 638 334 C 646 334, 654 316, 658 292 C 660 278, 654 268, 648 266 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.triceps_left,
    location: 'Porción externa de la herradura del tríceps.',
    biomechanicalFunction: 'Extensión explosiva y bloqueo del codo.',
    suggestedExercises: ['Extensiones en polea con cuerda', 'Press cerrado', 'Fondos'],
    secondaryMusclesList: ['Pectoral mayor', 'Deltoides'],
  },
  triceps_cabeza_lateral_right: {
    id: 'triceps_cabeza_lateral_right',
    name: 'Tríceps Braquial (Cabeza Lateral)',
    shortGroup: 'TRÍCEPS',
    view: 'posterior',
    parentBiometricId: 'triceps_lateral_right',
    cropBox: '615 235 258 140',
    svgPath:
      'M 840 266 C 852 286, 856 312, 850 334 C 842 334, 834 316, 830 292 C 828 278, 834 268, 840 266 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.triceps_right,
    location: 'Porción externa de la herradura del tríceps.',
    biomechanicalFunction: 'Extensión explosiva y bloqueo del codo.',
    suggestedExercises: ['Extensiones en polea con cuerda', 'Press cerrado', 'Fondos'],
    secondaryMusclesList: ['Pectoral mayor', 'Deltoides'],
  },
  gluteo_mayor_left: {
    id: 'gluteo_mayor_left',
    name: 'Glúteo Mayor',
    shortGroup: 'GLÚTEOS',
    view: 'posterior',
    parentBiometricId: 'glutes',
    cropBox: '655 380 178 125',
    svgPath:
      'M 714 402 C 692 412, 676 436, 678 462 C 680 482, 704 490, 728 484 C 740 480, 744 464, 744 436 C 736 418, 726 406, 714 402 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.glutes_left,
    location: 'Región posterior principal de la cadera.',
    biomechanicalFunction: 'Extensión potente de cadera y rotación externa.',
    suggestedExercises: ['Hip Thrust con barra', 'Sentadilla profunda', 'Peso muerto rumano'],
    secondaryMusclesList: ['Isquiotibiales', 'Glúteo medio'],
  },
  gluteo_mayor_right: {
    id: 'gluteo_mayor_right',
    name: 'Glúteo Mayor',
    shortGroup: 'GLÚTEOS',
    view: 'posterior',
    parentBiometricId: 'glutes',
    cropBox: '655 380 178 125',
    svgPath:
      'M 774 402 C 796 412, 812 436, 810 462 C 808 482, 784 490, 760 484 C 748 480, 744 464, 744 436 C 752 418, 762 406, 774 402 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.glutes_right,
    location: 'Región posterior principal de la cadera.',
    biomechanicalFunction: 'Extensión potente de cadera y rotación externa.',
    suggestedExercises: ['Hip Thrust con barra', 'Sentadilla profunda', 'Peso muerto rumano'],
    secondaryMusclesList: ['Isquiotibiales', 'Glúteo medio'],
  },
  gluteo_medio_left: {
    id: 'gluteo_medio_left',
    name: 'Glúteo Medio',
    shortGroup: 'GLÚTEOS',
    view: 'posterior',
    parentBiometricId: 'glutes',
    cropBox: '655 380 178 125',
    svgPath:
      'M 692 388 C 680 398, 674 416, 676 436 C 684 424, 696 408, 712 402 C 706 394, 698 390, 692 388 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.glutes_left,
    location: 'Borde superolateral de la pelvis.',
    biomechanicalFunction: 'Abducción de cadera y estabilidad pélvica.',
    suggestedExercises: ['Abducción en máquina', 'Patada lateral en polea', 'Caminata con banda'],
    secondaryMusclesList: ['Glúteo mayor', 'Tensor de la fascia lata'],
  },
  gluteo_medio_right: {
    id: 'gluteo_medio_right',
    name: 'Glúteo Medio',
    shortGroup: 'GLÚTEOS',
    view: 'posterior',
    parentBiometricId: 'glutes',
    cropBox: '655 380 178 125',
    svgPath:
      'M 796 388 C 808 398, 814 416, 812 436 C 804 424, 792 408, 776 402 C 782 394, 790 390, 796 388 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.glutes_right,
    location: 'Borde superolateral de la pelvis.',
    biomechanicalFunction: 'Abducción de cadera y estabilidad pélvica.',
    suggestedExercises: ['Abducción en máquina', 'Patada lateral en polea', 'Caminata con banda'],
    secondaryMusclesList: ['Glúteo mayor', 'Tensor de la fascia lata'],
  },
  isquiotibiales_biceps_femoral_left: {
    id: 'isquiotibiales_biceps_femoral_left',
    name: 'Isquiotibiales (Bíceps Femoral)',
    shortGroup: 'ISQUIOTIBIALES',
    view: 'posterior',
    parentBiometricId: 'hamstrings_left',
    cropBox: '655 465 178 125',
    svgPath:
      'M 678 476 C 668 504, 668 536, 676 562 C 686 558, 696 534, 700 486 C 692 484, 684 480, 678 476 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.hamstrings_left,
    location: 'Compartimento posterolateral del muslo.',
    biomechanicalFunction: 'Flexión de rodilla y extensión de cadera.',
    suggestedExercises: ['Curl femoral tumbado', 'Peso muerto rumano', 'Curl femoral sentado'],
    secondaryMusclesList: ['Glúteo mayor', 'Semitendinoso'],
  },
  isquiotibiales_biceps_femoral_right: {
    id: 'isquiotibiales_biceps_femoral_right',
    name: 'Isquiotibiales (Bíceps Femoral)',
    shortGroup: 'ISQUIOTIBIALES',
    view: 'posterior',
    parentBiometricId: 'hamstrings_right',
    cropBox: '655 465 178 125',
    svgPath:
      'M 810 476 C 820 504, 820 536, 812 562 C 802 558, 792 534, 788 486 C 796 484, 804 480, 810 476 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.hamstrings_right,
    location: 'Compartimento posterolateral del muslo.',
    biomechanicalFunction: 'Flexión de rodilla y extensión de cadera.',
    suggestedExercises: ['Curl femoral tumbado', 'Peso muerto rumano', 'Curl femoral sentado'],
    secondaryMusclesList: ['Glúteo mayor', 'Semitendinoso'],
  },
  isquiotibiales_semitendinoso_left: {
    id: 'isquiotibiales_semitendinoso_left',
    name: 'Isquiotibiales (Semitendinoso & Semimembranoso)',
    shortGroup: 'ISQUIOTIBIALES',
    view: 'posterior',
    parentBiometricId: 'hamstrings_left',
    cropBox: '655 465 178 125',
    svgPath:
      'M 702 486 C 698 524, 698 552, 706 564 C 718 556, 728 524, 732 486 C 722 488, 710 488, 702 486 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.hamstrings_left,
    location: 'Compartimento posteromedial del muslo.',
    biomechanicalFunction: 'Flexión de rodilla y extensión de cadera.',
    suggestedExercises: ['Curl femoral sentado', 'Peso muerto rumano', 'Nordic curls'],
    secondaryMusclesList: ['Bíceps femoral', 'Glúteo mayor'],
  },
  isquiotibiales_semitendinoso_right: {
    id: 'isquiotibiales_semitendinoso_right',
    name: 'Isquiotibiales (Semitendinoso & Semimembranoso)',
    shortGroup: 'ISQUIOTIBIALES',
    view: 'posterior',
    parentBiometricId: 'hamstrings_right',
    cropBox: '655 465 178 125',
    svgPath:
      'M 786 486 C 790 524, 790 552, 782 564 C 770 556, 760 524, 756 486 C 766 488, 778 488, 786 486 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.hamstrings_right,
    location: 'Compartimento posteromedial del muslo.',
    biomechanicalFunction: 'Flexión de rodilla y extensión de cadera.',
    suggestedExercises: ['Curl femoral sentado', 'Peso muerto rumano', 'Nordic curls'],
    secondaryMusclesList: ['Bíceps femoral', 'Glúteo mayor'],
  },
  gastrocnemio_lateral_left: {
    id: 'gastrocnemio_lateral_left',
    name: 'Gemelos (Gastrocnemio Lateral)',
    shortGroup: 'GEMELOS',
    view: 'posterior',
    parentBiometricId: 'calves_back_left',
    cropBox: '645 555 198 145',
    svgPath:
      'M 674 562 C 660 584, 656 612, 666 634 C 676 636, 684 618, 686 592 C 686 576, 680 566, 674 562 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.calves_left,
    location: 'Cabeza externa de la pantorrilla.',
    biomechanicalFunction: 'Flexión plantar del tobillo e impulso en carrera y salto.',
    suggestedExercises: ['Elevación de talones de pie', 'Gemelos en prensa'],
    secondaryMusclesList: ['Gastrocnemio medial', 'Sóleo'],
  },
  gastrocnemio_lateral_right: {
    id: 'gastrocnemio_lateral_right',
    name: 'Gemelos (Gastrocnemio Lateral)',
    shortGroup: 'GEMELOS',
    view: 'posterior',
    parentBiometricId: 'calves_back_right',
    cropBox: '645 555 198 145',
    svgPath:
      'M 814 562 C 828 584, 832 612, 822 634 C 812 636, 804 618, 802 592 C 802 576, 808 566, 814 562 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.calves_right,
    location: 'Cabeza externa de la pantorrilla.',
    biomechanicalFunction: 'Flexión plantar del tobillo e impulso en carrera y salto.',
    suggestedExercises: ['Elevación de talones de pie', 'Gemelos en prensa'],
    secondaryMusclesList: ['Gastrocnemio medial', 'Sóleo'],
  },
  gastrocnemio_medial_left: {
    id: 'gastrocnemio_medial_left',
    name: 'Gemelos (Gastrocnemio Medial)',
    shortGroup: 'GEMELOS',
    view: 'posterior',
    parentBiometricId: 'calves_back_left',
    cropBox: '645 555 198 145',
    svgPath:
      'M 698 564 C 690 576, 686 592, 688 618 C 690 634, 700 636, 708 618 C 714 598, 710 574, 698 564 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.calves_left,
    location: 'Cabeza interna de la pantorrilla.',
    biomechanicalFunction: 'Flexión plantar de alta potencia.',
    suggestedExercises: ['Elevación de talones de pie', 'Elevación en máquina'],
    secondaryMusclesList: ['Gastrocnemio lateral', 'Sóleo'],
  },
  gastrocnemio_medial_right: {
    id: 'gastrocnemio_medial_right',
    name: 'Gemelos (Gastrocnemio Medial)',
    shortGroup: 'GEMELOS',
    view: 'posterior',
    parentBiometricId: 'calves_back_right',
    cropBox: '645 555 198 145',
    svgPath:
      'M 790 564 C 798 576, 802 592, 800 618 C 798 634, 788 636, 780 618 C 774 598, 778 574, 790 564 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.calves_right,
    location: 'Cabeza interna de la pantorrilla.',
    biomechanicalFunction: 'Flexión plantar de alta potencia.',
    suggestedExercises: ['Elevación de talones de pie', 'Elevación en máquina'],
    secondaryMusclesList: ['Gastrocnemio lateral', 'Sóleo'],
  },
  soleo_left: {
    id: 'soleo_left',
    name: 'Sóleo',
    shortGroup: 'GEMELOS',
    view: 'posterior',
    parentBiometricId: 'calves_back_left',
    cropBox: '645 555 198 145',
    svgPath:
      'M 668 632 C 668 654, 672 674, 678 688 C 686 688, 692 668, 698 634 C 688 638, 678 638, 668 632 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.calves_left,
    location: 'Porción inferior profunda de la pantorrilla.',
    biomechanicalFunction: 'Flexión plantar con rodilla flexionada y sostén postural.',
    suggestedExercises: ['Elevación de talones sentado'],
    secondaryMusclesList: ['Gastrocnemios'],
  },
  soleo_right: {
    id: 'soleo_right',
    name: 'Sóleo',
    shortGroup: 'GEMELOS',
    view: 'posterior',
    parentBiometricId: 'calves_back_right',
    cropBox: '645 555 198 145',
    svgPath:
      'M 820 632 C 820 654, 816 674, 810 688 C 802 688, 796 668, 790 634 C 800 638, 810 638, 820 632 Z',
    unifiedGroupPath: UNIFIED_GROUP_PATHS.calves_right,
    location: 'Porción inferior profunda de la pantorrilla.',
    biomechanicalFunction: 'Flexión plantar con rodilla flexionada y sostén postural.',
    suggestedExercises: ['Elevación de talones sentado'],
    secondaryMusclesList: ['Gastrocnemios'],
  },
};

// Grupos anatómicos principales para la renderización de la CAPA VISUAL sin costuras geométricas
interface VisualAnatomicalRegion {
  regionKey: string;
  view: 'frontal' | 'posterior';
  parentBiometricId: BiometricMuscleId;
  memberIds: InteractiveMuscleId[];
  unifiedPath: string;
}

const VISUAL_ANATOMICAL_REGIONS: VisualAnatomicalRegion[] = [
  // FRONTAL
  {
    regionKey: 'pec_left',
    view: 'frontal',
    parentBiometricId: 'chest_left',
    memberIds: ['pectoral_superior_left', 'pectoral_medio_left', 'pectoral_inferior_left'],
    unifiedPath: UNIFIED_GROUP_PATHS.pectoral_left,
  },
  {
    regionKey: 'pec_right',
    view: 'frontal',
    parentBiometricId: 'chest_right',
    memberIds: ['pectoral_superior_right', 'pectoral_medio_right', 'pectoral_inferior_right'],
    unifiedPath: UNIFIED_GROUP_PATHS.pectoral_right,
  },
  {
    regionKey: 'delt_front_left',
    view: 'frontal',
    parentBiometricId: 'deltoid_front_left',
    memberIds: ['deltoides_anterior_left'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.deltoides_anterior_left.svgPath,
  },
  {
    regionKey: 'delt_front_right',
    view: 'frontal',
    parentBiometricId: 'deltoid_front_right',
    memberIds: ['deltoides_anterior_right'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.deltoides_anterior_right.svgPath,
  },
  {
    regionKey: 'biceps_left',
    view: 'frontal',
    parentBiometricId: 'biceps_left',
    memberIds: ['biceps_left'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.biceps_left.svgPath,
  },
  {
    regionKey: 'biceps_right',
    view: 'frontal',
    parentBiometricId: 'biceps_right',
    memberIds: ['biceps_right'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.biceps_right.svgPath,
  },
  {
    regionKey: 'forearm_left',
    view: 'frontal',
    parentBiometricId: 'biceps_left',
    memberIds: ['antebrazo_left'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.antebrazo_left.svgPath,
  },
  {
    regionKey: 'forearm_right',
    view: 'frontal',
    parentBiometricId: 'biceps_right',
    memberIds: ['antebrazo_right'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.antebrazo_right.svgPath,
  },
  {
    regionKey: 'abs_rectus',
    view: 'frontal',
    parentBiometricId: 'abs',
    memberIds: ['recto_abdominal'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.recto_abdominal.svgPath,
  },
  {
    regionKey: 'obliques_left',
    view: 'frontal',
    parentBiometricId: 'abs',
    memberIds: ['oblicuos_left'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.oblicuos_left.svgPath,
  },
  {
    regionKey: 'obliques_right',
    view: 'frontal',
    parentBiometricId: 'abs',
    memberIds: ['oblicuos_right'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.oblicuos_right.svgPath,
  },
  {
    regionKey: 'quad_left',
    view: 'frontal',
    parentBiometricId: 'quad_left',
    memberIds: [
      'cuadriceps_recto_left',
      'cuadriceps_vasto_ext_left',
      'cuadriceps_vasto_int_left',
      'aductores_left',
    ],
    unifiedPath: UNIFIED_GROUP_PATHS.quad_left,
  },
  {
    regionKey: 'quad_right',
    view: 'frontal',
    parentBiometricId: 'quad_right',
    memberIds: [
      'cuadriceps_recto_right',
      'cuadriceps_vasto_ext_right',
      'cuadriceps_vasto_int_right',
      'aductores_right',
    ],
    unifiedPath: UNIFIED_GROUP_PATHS.quad_right,
  },
  {
    regionKey: 'tibial_left',
    view: 'frontal',
    parentBiometricId: 'calves_front_left',
    memberIds: ['tibial_anterior_left'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.tibial_anterior_left.svgPath,
  },
  {
    regionKey: 'tibial_right',
    view: 'frontal',
    parentBiometricId: 'calves_front_right',
    memberIds: ['tibial_anterior_right'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.tibial_anterior_right.svgPath,
  },
  // POSTERIOR
  {
    regionKey: 'traps_full',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    memberIds: ['trapecio_superior', 'trapecio_medio_inferior'],
    unifiedPath: UNIFIED_GROUP_PATHS.traps_full,
  },
  {
    regionKey: 'delt_post_left',
    view: 'posterior',
    parentBiometricId: 'deltoid_front_left',
    memberIds: ['deltoides_posterior_left'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.deltoides_posterior_left.svgPath,
  },
  {
    regionKey: 'delt_post_right',
    view: 'posterior',
    parentBiometricId: 'deltoid_front_right',
    memberIds: ['deltoides_posterior_right'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.deltoides_posterior_right.svgPath,
  },
  {
    regionKey: 'rhomboid_left',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    memberIds: ['romboides_left'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.romboides_left.svgPath,
  },
  {
    regionKey: 'rhomboid_right',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    memberIds: ['romboides_right'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.romboides_right.svgPath,
  },
  {
    regionKey: 'dorsal_left',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    memberIds: ['dorsal_ancho_left'],
    unifiedPath: UNIFIED_GROUP_PATHS.dorsal_left,
  },
  {
    regionKey: 'dorsal_right',
    view: 'posterior',
    parentBiometricId: 'traps_lats',
    memberIds: ['dorsal_ancho_right'],
    unifiedPath: UNIFIED_GROUP_PATHS.dorsal_right,
  },
  {
    regionKey: 'erectors',
    view: 'posterior',
    parentBiometricId: 'hamstrings_left',
    memberIds: ['erectores_espinales'],
    unifiedPath: DETAILED_MUSCLE_REGISTRY.erectores_espinales.svgPath,
  },
  {
    regionKey: 'triceps_left',
    view: 'posterior',
    parentBiometricId: 'triceps_back_left',
    memberIds: ['triceps_cabeza_larga_left', 'triceps_cabeza_lateral_left'],
    unifiedPath: UNIFIED_GROUP_PATHS.triceps_left,
  },
  {
    regionKey: 'triceps_right',
    view: 'posterior',
    parentBiometricId: 'triceps_back_right',
    memberIds: ['triceps_cabeza_larga_right', 'triceps_cabeza_lateral_right'],
    unifiedPath: UNIFIED_GROUP_PATHS.triceps_right,
  },
  {
    regionKey: 'glutes_left',
    view: 'posterior',
    parentBiometricId: 'glutes',
    memberIds: ['gluteo_mayor_left', 'gluteo_medio_left'],
    unifiedPath: UNIFIED_GROUP_PATHS.glutes_left,
  },
  {
    regionKey: 'glutes_right',
    view: 'posterior',
    parentBiometricId: 'glutes',
    memberIds: ['gluteo_mayor_right', 'gluteo_medio_right'],
    unifiedPath: UNIFIED_GROUP_PATHS.glutes_right,
  },
  {
    regionKey: 'hamstrings_left',
    view: 'posterior',
    parentBiometricId: 'hamstrings_left',
    memberIds: ['isquiotibiales_biceps_femoral_left', 'isquiotibiales_semitendinoso_left'],
    unifiedPath: UNIFIED_GROUP_PATHS.hamstrings_left,
  },
  {
    regionKey: 'hamstrings_right',
    view: 'posterior',
    parentBiometricId: 'hamstrings_right',
    memberIds: ['isquiotibiales_biceps_femoral_right', 'isquiotibiales_semitendinoso_right'],
    unifiedPath: UNIFIED_GROUP_PATHS.hamstrings_right,
  },
  {
    regionKey: 'calves_left',
    view: 'posterior',
    parentBiometricId: 'calves_back_left',
    memberIds: ['gastrocnemio_lateral_left', 'gastrocnemio_medial_left', 'soleo_left'],
    unifiedPath: UNIFIED_GROUP_PATHS.calves_left,
  },
  {
    regionKey: 'calves_right',
    view: 'posterior',
    parentBiometricId: 'calves_back_right',
    memberIds: ['gastrocnemio_lateral_right', 'gastrocnemio_medial_right', 'soleo_right'],
    unifiedPath: UNIFIED_GROUP_PATHS.calves_right,
  },
];

const ALL_MUSCLE_IDS = Object.keys(DETAILED_MUSCLE_REGISTRY) as InteractiveMuscleId[];

const BicepHeaderIcon: React.FC<{ className?: string }> = ({ className = 'w-11 h-11' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    stroke="#CCFF00"
    strokeWidth="3.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M20 38c-3-6 0-16 6.5-21 3.2-2.5 7.5-2 9.5 1.2 1.5 2.4 0 5.8-2.8 6.8-2.4 1-3.8 0-4.8-1.6" />
    <path d="M25.5 24c-2.5 3.8-3 9-1 13 2.8-3.8 8-5.8 14-4.8 6 1 10 5.2 10 11 0 7-6.5 11-15.5 11-8.5 0-16.5-2.2-20.5-7-3.2-3.8-3.8-9-1-14.2" />
    <path d="M34 38.5c2.8 0.6 5.2 2.2 6.5 4.2" />
  </svg>
);

const BodySilhouetteIcon: React.FC<{ active: boolean; isBack?: boolean }> = ({
  active,
  isBack = false,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? '#090909' : '#F5F5F5'}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4 shrink-0"
    aria-hidden="true"
  >
    <circle cx="12" cy="4.5" r="2.3" fill={active ? '#090909' : 'none'} />
    <path d="M7.5 9.5c1.2-.8 2.8-1.2 4.5-1.2s3.3.4 4.5 1.2l1.5 4.5-2 .6-.9-2.8v9.7h-2.2v-5h-1.8v5H8.9v-9.7L8 14.6l-2-.6 1.5-4.5Z" />
    {isBack && <line x1="12" y1="8.5" x2="12" y2="15" />}
  </svg>
);

// Ilustración vectorial minimalista de ejecución biomecánica proporcionada para las tarjetas de ejercicios asociados
const ExerciseSilhouetteGraphic: React.FC<{ index: number }> = ({ index }) => (
  <svg
    viewBox="0 0 140 62"
    fill="none"
    className="w-full h-14 sm:h-16 opacity-95"
    aria-hidden="true"
  >
    <rect x="0" y="0" width="140" height="62" rx="10" fill="#0D0D0D" />
    <line x1="16" y1="51" x2="124" y2="51" stroke="#262626" strokeWidth="1.5" />
    {index % 3 === 0 ? (
      <>
        {/* Press con barra */}
        <rect x="42" y="38" width="56" height="5" rx="2" fill="#303030" />
        <line x1="50" y1="43" x2="50" y2="51" stroke="#303030" strokeWidth="3" />
        <line x1="90" y1="43" x2="90" y2="51" stroke="#303030" strokeWidth="3" />
        <line x1="26" y1="20" x2="114" y2="20" stroke="#A1A1AA" strokeWidth="2.5" />
        <rect x="30" y="12" width="5.5" height="16" rx="1.5" fill="#CCFF00" />
        <rect x="104.5" y="12" width="5.5" height="16" rx="1.5" fill="#CCFF00" />
        <circle cx="70" cy="32" r="5" fill="#71717A" />
        <path d="M52 37 C59 30, 81 30, 88 37" stroke="#A1A1AA" strokeWidth="4" strokeLinecap="round" />
        <line x1="54" y1="34" x2="46" y2="20" stroke="#D4D4D8" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="86" y1="34" x2="94" y2="20" stroke="#D4D4D8" strokeWidth="2.5" strokeLinecap="round" />
      </>
    ) : index % 3 === 1 ? (
      <>
        {/* Press inclinado / mancuernas */}
        <path d="M48 49 L76 28 L88 49" stroke="#303030" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="67" cy="24" r="4.5" fill="#71717A" />
        <line x1="42" y1="15" x2="62" y2="15" stroke="#CCFF00" strokeWidth="3.2" strokeLinecap="round" />
        <line x1="76" y1="15" x2="96" y2="15" stroke="#CCFF00" strokeWidth="3.2" strokeLinecap="round" />
        <line x1="58" y1="30" x2="52" y2="15" stroke="#D4D4D8" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="76" y1="30" x2="86" y2="15" stroke="#D4D4D8" strokeWidth="2.5" strokeLinecap="round" />
      </>
    ) : (
      <>
        {/* Máquina / Poleas */}
        <rect x="28" y="9" width="4" height="42" fill="#262626" />
        <rect x="108" y="9" width="4" height="42" fill="#262626" />
        <line x1="30" y1="11" x2="110" y2="11" stroke="#303030" strokeWidth="2.5" />
        <circle cx="70" cy="23" r="4.5" fill="#71717A" />
        <path d="M60 30 L80 30 L76 46 L64 46 Z" fill="#52525B" />
        <path d="M32 18 Q48 28 60 32" stroke="#CCFF00" strokeWidth="2" fill="none" />
        <path d="M108 18 Q92 28 80 32" stroke="#CCFF00" strokeWidth="2" fill="none" />
      </>
    )}
  </svg>
);

const resolveInitialMuscleTarget = (
  muscleName: string
): { id: InteractiveMuscleId; angle: 'frontal' | 'posterior' } | null => {
  const norm = muscleName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!norm) return null;

  if (norm.includes('pector') || norm.includes('pecho') || norm.includes('chest')) {
    return { id: 'pectoral_medio_left', angle: 'frontal' };
  }
  if (norm.includes('dorsal') || norm.includes('espalda') || norm.includes('back')) {
    return { id: 'dorsal_ancho_left', angle: 'posterior' };
  }
  if (norm.includes('cuadricep') || norm.includes('pierna') || norm.includes('quad')) {
    return { id: 'cuadriceps_recto_left', angle: 'frontal' };
  }
  if (norm.includes('isquio') || norm.includes('femoral') || norm.includes('hamstring')) {
    return { id: 'isquiotibiales_biceps_femoral_left', angle: 'posterior' };
  }
  if (norm.includes('gluteo') || norm.includes('glute')) {
    return { id: 'gluteo_mayor_left', angle: 'posterior' };
  }
  if (norm.includes('hombro') || norm.includes('deltoid') || norm.includes('shoulder')) {
    return { id: 'deltoides_anterior_left', angle: 'frontal' };
  }
  if (norm.includes('bicep') || norm.includes('brazo')) {
    return { id: 'biceps_left', angle: 'frontal' };
  }
  if (norm.includes('tricep')) {
    return { id: 'triceps_cabeza_larga_left', angle: 'posterior' };
  }
  if (norm.includes('gemelo') || norm.includes('pantorrilla') || norm.includes('calf')) {
    return { id: 'gastrocnemio_lateral_left', angle: 'posterior' };
  }
  if (norm.includes('core') || norm.includes('abdom') || norm.includes('abs')) {
    return { id: 'recto_abdominal', angle: 'frontal' };
  }
  return null;
};

export const MapaMuscularView: React.FC<MapaMuscularViewProps> = ({
  history = [],
  routines = [],
  onNavigateTab,
  initialSelectedMuscle = null,
  onConsumeInitialMuscle,
}) => {
  // 1. MODO DE VISUALIZACIÓN: 'recuperacion' vs 'exploracion' (Prioridad 2)
  const [visualizationMode, setVisualizationMode] = useState<VisualizationMode>('recuperacion');

  // 2. VISTA ANATÓMICA: 'frontal' vs 'posterior'
  const [selectedViewAngle, setSelectedViewAngle] = useState<'frontal' | 'posterior'>('frontal');
  const [timePeriodFilter, setTimePeriodFilter] = useState<'hoy' | '7dias' | '30dias' | '90dias'>('7dias');

  // Zoom interactivo de la barra lateral izquierda
  const [anatomyZoom, setAnatomyZoom] = useState<number>(1);
  const [isBookmarked, setIsBookmarked] = useState<boolean>(false);

  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [showAllDetailsModal, setShowAllDetailsModal] = useState<boolean>(false);
  const [detailStatusFilter, setDetailStatusFilter] = useState<'ALL' | 'LISTO' | 'PROCESO' | 'DESCANSO'>('ALL');

  const [isMultiSelectMode, setIsMultiSelectMode] = useState<boolean>(false);
  const [selectedMuscleIds, setSelectedMuscleIds] = useState<InteractiveMuscleId[]>([
    'pectoral_medio_left',
    'pectoral_medio_right',
    'pectoral_superior_left',
    'pectoral_superior_right',
    'pectoral_inferior_left',
    'pectoral_inferior_right',
  ]);
  const [lastSelectedMuscleId, setLastSelectedMuscleId] =
    useState<InteractiveMuscleId>('pectoral_medio_left');
  const [hoveredMuscleId, setHoveredMuscleId] = useState<InteractiveMuscleId | null>(null);
  const [clockTick, setClockTick] = useState<number>(Date.now());

  const anatomyRef = useRef<HTMLDivElement | null>(null);
  const detailCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const hasAnyWorkoutHistory = Array.isArray(history) && history.length > 0;

  // Motor de recuperación existente (única fuente de verdad)
  const recoveryReport = useMemo(() => {
    return computeRealTimeRecovery(history, clockTick, routines, 'ALL');
  }, [history, routines, clockTick]);

  const athleteSummary = useMemo(() => {
    return computeOverallAthleteSummary(recoveryReport, history, clockTick);
  }, [recoveryReport, history, clockTick]);

  const periodHistorySummary = useMemo(() => {
    return computePeriodHistorySummary(history, timePeriodFilter, clockTick);
  }, [history, timePeriodFilter, clockTick]);

  const primaryActiveMeta =
    DETAILED_MUSCLE_REGISTRY[lastSelectedMuscleId] || DETAILED_MUSCLE_REGISTRY.pectoral_medio_left;
  const primaryActiveRecovery =
    recoveryReport[primaryActiveMeta.parentBiometricId] || recoveryReport.chest_left;

  const hasSelectedMuscleData = Boolean(primaryActiveRecovery?.hasHistoricalData);

  // Conteo de grupos musculares entrenados y arcos proporcionales para el gráfico circular de ESTADO MUSCULAR
  const trainedMusclesRingStats = useMemo(() => {
    const allCanonical = athleteSummary.readyMuscles
      .concat(athleteSummary.inRecoveryMuscles)
      .concat(athleteSummary.highFatigueMuscles);

    const trainedList = allCanonical.filter((m) => m.statusColor !== '#71717A');
    const trainedCount = trainedList.length;
    const highCount = trainedList.filter((m) => m.statusColor === '#EF4444').length;
    const modCount = trainedList.filter((m) => m.statusColor === '#F97316').length;
    const progCount = trainedList.filter((m) => m.statusColor === '#FACC15').length;
    const readyCount = trainedList.filter((m) => m.statusColor === '#CCFF00').length;

    // Circunferencia para r=40: 2 * PI * 40 ≈ 251.2
    const circumference = 251.2;
    const counts =
      trainedCount > 0
        ? [
            { color: '#EF4444', count: highCount },
            { color: '#F97316', count: modCount },
            { color: '#FACC15', count: progCount },
            { color: '#CCFF00', count: readyCount },
          ].filter((s) => s.count > 0)
        : [];

    let accOffset = 0;
    const gap = counts.length > 1 ? 5 : 0;
    const usableCircumference = Math.max(0, circumference - gap * counts.length);
    const arcs = counts.map((seg) => {
      const length = (seg.count / trainedCount) * usableCircumference;
      const arc = {
        color: seg.color,
        dashArray: `${length.toFixed(1)} ${circumference}`,
        dashOffset: -accOffset,
      };
      accOffset += length + gap;
      return arc;
    });

    return {
      trainedCount,
      highCount,
      modCount,
      progCount,
      readyCount,
      totalCanonical: allCanonical.length || 10,
      arcs,
    };
  }, [athleteSummary]);

  // Pares bilaterales para iluminar el grupo muscular simétrico en selección simple
  const getSymmetricGroupIds = (muscleId: InteractiveMuscleId): InteractiveMuscleId[] => {
    if (muscleId.startsWith('pectoral_')) {
      return [
        'pectoral_superior_left',
        'pectoral_superior_right',
        'pectoral_medio_left',
        'pectoral_medio_right',
        'pectoral_inferior_left',
        'pectoral_inferior_right',
      ];
    }
    if (muscleId.startsWith('cuadriceps_') || muscleId.startsWith('aductores_')) {
      return [
        'cuadriceps_recto_left',
        'cuadriceps_recto_right',
        'cuadriceps_vasto_ext_left',
        'cuadriceps_vasto_ext_right',
        'cuadriceps_vasto_int_left',
        'cuadriceps_vasto_int_right',
        'aductores_left',
        'aductores_right',
      ];
    }
    if (muscleId.startsWith('trapecio_')) {
      return ['trapecio_superior', 'trapecio_medio_inferior'];
    }
    if (muscleId.startsWith('dorsal_ancho_')) {
      return ['dorsal_ancho_left', 'dorsal_ancho_right'];
    }
    if (muscleId.startsWith('triceps_')) {
      return [
        'triceps_cabeza_larga_left',
        'triceps_cabeza_larga_right',
        'triceps_cabeza_lateral_left',
        'triceps_cabeza_lateral_right',
      ];
    }
    if (muscleId.startsWith('gluteo_')) {
      return ['gluteo_mayor_left', 'gluteo_mayor_right', 'gluteo_medio_left', 'gluteo_medio_right'];
    }
    if (muscleId.startsWith('isquiotibiales_')) {
      return [
        'isquiotibiales_biceps_femoral_left',
        'isquiotibiales_biceps_femoral_right',
        'isquiotibiales_semitendinoso_left',
        'isquiotibiales_semitendinoso_right',
      ];
    }
    if (muscleId.startsWith('gastrocnemio_') || muscleId.startsWith('soleo_')) {
      return [
        'gastrocnemio_lateral_left',
        'gastrocnemio_lateral_right',
        'gastrocnemio_medial_left',
        'gastrocnemio_medial_right',
        'soleo_left',
        'soleo_right',
      ];
    }
    if (muscleId.endsWith('_left')) {
      const rightCandidate = muscleId.replace('_left', '_right') as InteractiveMuscleId;
      if (DETAILED_MUSCLE_REGISTRY[rightCandidate]) {
        return [muscleId, rightCandidate];
      }
    }
    if (muscleId.endsWith('_right')) {
      const leftCandidate = muscleId.replace('_right', '_left') as InteractiveMuscleId;
      if (DETAILED_MUSCLE_REGISTRY[leftCandidate]) {
        return [leftCandidate, muscleId];
      }
    }
    return [muscleId];
  };

  useEffect(() => {
    if (!initialSelectedMuscle) return;
    const target = resolveInitialMuscleTarget(initialSelectedMuscle);
    if (target) {
      setIsMultiSelectMode(false);
      setSelectedViewAngle(target.angle);
      setLastSelectedMuscleId(target.id);
      setSelectedMuscleIds(getSymmetricGroupIds(target.id));
    }
    if (onConsumeInitialMuscle) {
      onConsumeInitialMuscle();
    }
  }, [initialSelectedMuscle]);

  // Estadísticas agregadas cuando hay múltiples músculos seleccionados en modo multi-selección
  const multiSelectStats = useMemo(() => {
    if (!isMultiSelectMode || selectedMuscleIds.length <= 1) return null;
    const uniqueParentIds = Array.from(
      new Set(
        selectedMuscleIds
          .map((id) => DETAILED_MUSCLE_REGISTRY[id]?.parentBiometricId)
          .filter(Boolean)
      )
    );

    const byCanonical = new Map<
      CanonicalMuscleId,
      { volume: number; sets: number; floatH: number; hasData: boolean }
    >();

    uniqueParentIds.forEach((pId) => {
      const rec = recoveryReport[pId];
      if (!rec) return;
      const floatH = rec.remainingHours + rec.remainingMinutes / 60;
      const existing = byCanonical.get(rec.canonicalId);
      if (!existing) {
        byCanonical.set(rec.canonicalId, {
          volume: rec.volume,
          sets: rec.sets,
          floatH,
          hasData: Boolean(rec.hasHistoricalData),
        });
      } else {
        byCanonical.set(rec.canonicalId, {
          volume: Math.max(existing.volume, rec.volume),
          sets: Math.max(existing.sets, rec.sets),
          floatH: Math.max(existing.floatH, floatH),
          hasData: Boolean(existing.hasData || rec.hasHistoricalData),
        });
      }
    });

    let totalVolume = 0;
    let totalSets = 0;
    let maxRemainingH = 0;
    let musclesWithData = 0;

    byCanonical.forEach((group) => {
      if (group.hasData) musclesWithData += 1;
      totalVolume += group.volume;
      totalSets += group.sets;
      if (group.floatH > maxRemainingH) {
        maxRemainingH = group.floatH;
      }
    });

    const maxH = Math.floor(maxRemainingH);
    const maxM = Math.round((maxRemainingH - maxH) * 60);

    let levelLabel = 'Sin datos';
    if (musclesWithData > 0) {
      if (maxRemainingH > 36) levelLabel = 'Alta';
      else if (maxRemainingH >= 24) levelLabel = 'Moderada';
      else if (maxRemainingH >= 6) levelLabel = 'En progreso';
      else levelLabel = 'Suficiente';
    }

    return {
      levelLabel,
      totalVolume,
      totalSets,
      maxH,
      maxM,
      musclesWithData,
      count: byCanonical.size,
    };
  }, [isMultiSelectMode, selectedMuscleIds, recoveryReport]);

  // Selección táctil sobre cualquier región anatómica
  const handleMuscleClick = (muscleId: InteractiveMuscleId, e?: React.MouseEvent) => {
    const meta = DETAILED_MUSCLE_REGISTRY[muscleId];
    if (!meta) return;

    setLastSelectedMuscleId(muscleId);

    if (selectedViewAngle !== meta.view) {
      setSelectedViewAngle(meta.view);
    }

    const isMulti = isMultiSelectMode || e?.shiftKey || e?.ctrlKey || e?.metaKey;

    if (isMulti) {
      setSelectedMuscleIds((prev) => {
        if (prev.includes(muscleId)) {
          return prev.filter((id) => id !== muscleId);
        }
        return [...prev, muscleId];
      });
    } else {
      setSelectedMuscleIds(getSymmetricGroupIds(muscleId));
    }
  };

  // Cambiar entre Vista Frontal y Vista Posterior
  const handleSwitchViewAngle = (angle: 'frontal' | 'posterior') => {
    setSelectedViewAngle(angle);
    if (!isMultiSelectMode && selectedMuscleIds.length > 0) {
      const currentMeta = DETAILED_MUSCLE_REGISTRY[lastSelectedMuscleId];
      if (currentMeta && currentMeta.view !== angle) {
        const defaultTarget: InteractiveMuscleId =
          angle === 'frontal' ? 'pectoral_medio_left' : 'dorsal_ancho_left';
        setLastSelectedMuscleId(defaultTarget);
        setSelectedMuscleIds(getSymmetricGroupIds(defaultTarget));
      }
    }
  };

  // Etiqueta corta para el badge de Fatiga estimada (100% coherente con el estado muscular y tiempo restante)
  const fatigueLevelBadge = useMemo(() => {
    if (!hasSelectedMuscleData || primaryActiveRecovery.status === 'Sin datos suficientes') {
      return { label: 'Sin datos', color: '#A1A1AA', bg: '#262626', textColor: '#F5F5F5' };
    }
    if (primaryActiveRecovery.status === 'Fatiga alta' || primaryActiveRecovery.statusColor === '#EF4444') {
      return { label: 'Alta', color: '#EF4444', bg: '#EF4444', textColor: '#090909' };
    }
    if (primaryActiveRecovery.status === 'Fatiga moderada' || primaryActiveRecovery.statusColor === '#F97316') {
      return { label: 'Moderada', color: '#F97316', bg: '#F59E0B', textColor: '#090909' };
    }
    if (
      primaryActiveRecovery.status === 'Recuperación en progreso' ||
      primaryActiveRecovery.statusColor === '#FACC15'
    ) {
      return { label: 'En progreso', color: '#FACC15', bg: '#FACC15', textColor: '#090909' };
    }
    return { label: 'Suficiente', color: '#CCFF00', bg: '#CCFF00', textColor: '#090909' };
  }, [hasSelectedMuscleData, primaryActiveRecovery]);

  // Recomendación prudente y coherente con Fatiga estimada, Tiempo restante y Estado muscular (sin inventar porcentajes clínicos)
  const recommendationText = useMemo(() => {
    const groupLower = primaryActiveMeta.shortGroup.toLowerCase();

    if (!hasSelectedMuscleData || primaryActiveRecovery.status === 'Sin datos suficientes') {
      return `Aún no hay entrenamientos registrados para ${groupLower}. Las estimaciones de fatiga y recuperación son orientativas y se calcularán automáticamente al registrar tus sesiones.`;
    }

    const remH = primaryActiveRecovery.remainingHours;
    const remM = primaryActiveRecovery.remainingMinutes;
    const remFloat = remH + remM / 60;
    const remText = remM > 0 ? `${remH} h ${remM} min` : `${remH} h`;

    if (primaryActiveRecovery.status === 'Fatiga alta' || remFloat > 36) {
      return `Estimación orientativa: restan aproximadamente ${remText} para completar la ventana de recuperación de tu ${groupLower} tras la carga registrada. Este valor sugiere fatiga acumulada importante; se aconseja prudencia y priorizar el descanso o entrenar otros grupos musculares antes de volver a aplicar alta exigencia.`;
    }

    if (primaryActiveRecovery.status === 'Fatiga moderada' || remFloat >= 24) {
      return `Estimación orientativa: restan aproximadamente ${remText} de recuperación para tu ${groupLower}. Este resultado indica que el músculo aún asimila el estímulo reciente; evalúa con prudencia tus sensaciones y considera postergar cargas intensas o priorizar otros grupos musculares.`;
    }

    if (primaryActiveRecovery.status === 'Recuperación en progreso' || remFloat >= 6) {
      return `Estimación orientativa: tu ${groupLower} se encuentra con recuperación en progreso (~${remText} restantes). Aunque la fatiga estimada va disminuyendo, interpreta este dato como una referencia orientativa y ajusta el volumen o la intensidad según tu percepción real de rigidez y energía.`;
    }

    if (remFloat > 0) {
      return `Estimación orientativa: restan cerca de ${remText} para finalizar la ventana estimada de tu ${groupLower}. La recuperación estimada es amplia, pero conviene progresar gradualmente en el calentamiento antes de decidir trabajar con cargas altas.`;
    }

    return `Estimación orientativa: según los entrenamientos registrados, tu ${groupLower} ha completado su ventana estimada de recuperación (0 h restantes). Recuerda que es una referencia de carga y conviene validar tus sensaciones durante la aproximación inicial.`;
  }, [hasSelectedMuscleData, primaryActiveRecovery, primaryActiveMeta]);

  // Lista de ejercicios asociados para desplazamiento horizontal en la ficha
  const associatedExercisesList = useMemo(() => {
    if (hasSelectedMuscleData && primaryActiveRecovery.exercisesTriggered.length > 0) {
      return primaryActiveRecovery.exercisesTriggered.slice(0, 6).map((trig) => ({
        name: trig.exerciseName,
        sublabel: `${trig.sets} series × ${trig.reps} rep`,
        detail: trig.weightKg > 0 ? `${trig.weightKg} kg` : undefined,
      }));
    }
    return primaryActiveMeta.suggestedExercises.map((exName) => ({
      name: exName,
      sublabel: 'Sin registros aún',
      detail: undefined,
    }));
  }, [hasSelectedMuscleData, primaryActiveRecovery, primaryActiveMeta]);

  // Músculos de la vista activa (frontal o posterior)
  const currentViewMuscles = useMemo(
    () => ALL_MUSCLE_IDS.filter((id) => DETAILED_MUSCLE_REGISTRY[id].view === selectedViewAngle),
    [selectedViewAngle]
  );

  // Regiones visuales unificadas de la vista activa
  const currentVisualRegions = useMemo(
    () => VISUAL_ANATOMICAL_REGIONS.filter((r) => r.view === selectedViewAngle),
    [selectedViewAngle]
  );

  // Coordenadas y recursos exactos de cada vista
  const mainSvgViewBox = selectedViewAngle === 'frontal' ? '96 88 320 652' : '584 88 320 652';
  const imageX = selectedViewAngle === 'frontal' ? 96 : 584;
  const bodyCenterX = selectedViewAngle === 'frontal' ? 256 : 744;
  const activeAnatomyImageSrc =
    selectedViewAngle === 'frontal'
      ? '/images/anatomia-frontal.png'
      : '/images/anatomia-posterior.png';
  const activeFiberMaskUrl =
    selectedViewAngle === 'frontal'
      ? 'url(#frontal-fiber-mask)'
      : 'url(#posterior-fiber-mask)';

  // Etiqueta cualitativa para el modal de 10 grupos musculares (sin inventar mediciones clínicas)
  const getQualitativeStatusLabel = (statusColor: string) => {
    if (statusColor === '#71717A') return 'Sin datos';
    if (statusColor === '#EF4444') return 'Alta (> 36 h)';
    if (statusColor === '#F97316') return 'Moderada (24 – 36 h)';
    if (statusColor === '#FACC15') return 'En progreso (6 – 24 h)';
    return 'Suficiente (0 – 6 h)';
  };

  return (
    <div className="w-full min-h-screen bg-[#090909] text-[#F5F5F5] pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] font-['Plus_Jakarta_Sans',sans-serif] selection:bg-[#CCFF00] selection:text-[#090909] overflow-x-hidden">
      <div className="w-full max-w-5xl mx-auto px-3.5 sm:px-5 pt-2.5 space-y-3.5">
        {/* =========================================================================
            1. CABECERA DE MARCA LAZCAKONG GYM – ELITE PERFORMANCE
           ========================================================================= */}
        <header className="flex items-center justify-between gap-2.5 pt-1 pb-1">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#090909] border-2 border-[#CCFF00] flex items-center justify-center overflow-hidden shrink-0 shadow-[0_0_16px_rgba(204,255,0,0.28)]">
              <img
                src="/assets/gorilla_head.png"
                alt="LAZCAKONG GYM"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover scale-110"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl xs:text-[22px] sm:text-[28px] font-black italic uppercase tracking-tight text-[#F5F5F5] flex items-center gap-1.5 leading-none">
                <span>LAZCAKONG</span>
                <span className="text-[#CCFF00]">GYM</span>
              </h1>
              <span className="text-[9.5px] xs:text-[10px] sm:text-[11px] font-extrabold italic tracking-[0.24em] sm:tracking-[0.28em] text-[#F5F5F5]/90 uppercase block mt-1">
                ELITE PERFORMANCE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setDetailStatusFilter('ALL');
                setShowAllDetailsModal(true);
              }}
              className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#171717] border border-[#303030] hover:border-[#CCFF00] flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
              title="Resumen de los 10 grupos musculares"
              aria-label="Resumen de grupos musculares"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#CCFF00] shadow-[0_0_6px_#CCFF00]" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('cloud')}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#171717] border border-[#303030] hover:border-[#CCFF00] flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
              title="Perfil de Atleta"
              aria-label="Perfil de Atleta"
            >
              <User className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('cloud')}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#171717] border border-[#303030] hover:border-[#CCFF00] flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
              title="Configuración y Sincronización"
              aria-label="Configuración"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* =========================================================================
            2. BANNER TÍTULO + SELECTOR DE 2 MODOS (RECUPERACIÓN / EXPLORACIÓN)
           ========================================================================= */}
        <section className="relative overflow-hidden rounded-[22px] bg-gradient-to-r from-[#171717] via-[#13170b] to-[#171717] border border-[#CCFF00]/50 px-3.5 sm:px-4 py-3.5 shadow-[0_0_24px_rgba(204,255,0,0.1)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BicepHeaderIcon className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 drop-shadow-[0_0_8px_rgba(204,255,0,0.35)]" />
            <div className="min-w-0">
              <h2 className="text-[17px] xs:text-lg sm:text-2xl font-black italic uppercase tracking-tight text-[#F5F5F5] leading-snug break-words">
                MAPA MUSCULAR INTELIGENTE
              </h2>
              <p className="text-xs sm:text-sm text-[#F5F5F5]/80 leading-snug">
                Fatiga, recuperación y detalle de tus músculos
              </p>
            </div>
          </div>

          {/* Caja Modo de visualización: Recuperación vs Exploración */}
          <div className="w-full sm:w-auto bg-[#111111]/95 border border-[#CCFF00]/40 rounded-2xl px-3 py-2 shrink-0 space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-semibold text-[#F5F5F5]/85">
                Modo de visualización
              </span>
              <button
                type="button"
                onClick={() => {
                  setDetailStatusFilter('ALL');
                  setShowAllDetailsModal(true);
                }}
                className="w-4 h-4 rounded-full border border-[#CCFF00] text-[#CCFF00] flex items-center justify-center text-[10px] font-black cursor-pointer hover:bg-[#CCFF00]/15 transition-colors"
                title="Ver resumen de todos los grupos musculares"
                aria-label="Información de modos"
              >
                i
              </button>
            </div>

            <div className="grid grid-cols-2 bg-[#171717] p-0.5 rounded-full border border-[#303030]">
              <button
                type="button"
                onClick={() => setVisualizationMode('recuperacion')}
                style={
                  visualizationMode === 'recuperacion'
                    ? { backgroundColor: '#CCFF00', color: '#090909' }
                    : undefined
                }
                className={`px-3 py-1.5 sm:py-1 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  visualizationMode === 'recuperacion'
                    ? 'bg-[#CCFF00] text-[#090909] shadow-[0_0_12px_rgba(204,255,0,0.4)]'
                    : 'text-[#F5F5F5]/85 hover:text-[#CCFF00]'
                }`}
              >
                <Activity className="w-3.5 h-3.5 shrink-0" />
                <span>Recuperación</span>
              </button>

              <button
                type="button"
                onClick={() => setVisualizationMode('exploracion')}
                style={
                  visualizationMode === 'exploracion'
                    ? { backgroundColor: '#CCFF00', color: '#090909' }
                    : undefined
                }
                className={`px-3 py-1.5 sm:py-1 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  visualizationMode === 'exploracion'
                    ? 'bg-[#CCFF00] text-[#090909] shadow-[0_0_12px_rgba(204,255,0,0.4)]'
                    : 'text-[#F5F5F5]/85 hover:text-[#CCFF00]'
                }`}
              >
                <Target className="w-3.5 h-3.5 shrink-0" />
                <span>Exploración</span>
              </button>
            </div>
          </div>
        </section>

        {/* =========================================================================
            3. SELECTOR SEGMENTADO: VISTA FRONTAL / VISTA POSTERIOR + MULTI-SELECCIÓN
           ========================================================================= */}
        <section className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="w-full sm:flex-1 sm:max-w-md grid grid-cols-2 bg-[#141414] p-1 rounded-full border border-[#303030] shadow-inner">
            <button
              type="button"
              onClick={() => handleSwitchViewAngle('frontal')}
              style={
                selectedViewAngle === 'frontal'
                  ? { backgroundColor: '#CCFF00', color: '#090909' }
                  : undefined
              }
              className={`min-h-[42px] px-3 py-2 rounded-full text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                selectedViewAngle === 'frontal'
                  ? 'bg-[#CCFF00] text-[#090909] shadow-[0_0_18px_rgba(204,255,0,0.45)]'
                  : 'text-[#F5F5F5] hover:text-[#CCFF00]'
              }`}
            >
              <BodySilhouetteIcon active={selectedViewAngle === 'frontal'} />
              <span>Vista Frontal</span>
            </button>

            <button
              type="button"
              onClick={() => handleSwitchViewAngle('posterior')}
              style={
                selectedViewAngle === 'posterior'
                  ? { backgroundColor: '#CCFF00', color: '#090909' }
                  : undefined
              }
              className={`min-h-[42px] px-3 py-2 rounded-full text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                selectedViewAngle === 'posterior'
                  ? 'bg-[#CCFF00] text-[#090909] shadow-[0_0_18px_rgba(204,255,0,0.45)]'
                  : 'text-[#F5F5F5] hover:text-[#CCFF00]'
              }`}
            >
              <BodySilhouetteIcon active={selectedViewAngle === 'posterior'} isBack />
              <span>Vista Posterior</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsMultiSelectMode((prev) => !prev)}
            className={`min-h-[42px] px-4 py-2 rounded-full bg-[#141414] border flex items-center justify-between sm:justify-start gap-2.5 text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              isMultiSelectMode
                ? 'border-[#CCFF00] text-[#CCFF00] shadow-[0_0_12px_rgba(204,255,0,0.2)]'
                : 'border-[#303030] text-[#F5F5F5]/90'
            }`}
            aria-pressed={isMultiSelectMode}
          >
            <span className="whitespace-nowrap sm:order-2">Selección múltiple</span>
            <div
              className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center sm:order-1 ${
                isMultiSelectMode ? 'bg-[#CCFF00] justify-end' : 'bg-[#303030] justify-start'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full shadow transition-transform ${
                  isMultiSelectMode ? 'bg-[#090909]' : 'bg-[#F5F5F5]'
                }`}
              />
            </div>
          </button>
        </section>

        {/* =========================================================================
            4. ESCENARIO PRINCIPAL: ANATOMÍA PROTAGONISTA (IZQ) + ESTADÍSTICAS (DER)
           ========================================================================= */}
        <div
          ref={anatomyRef}
          className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start pt-1"
        >
          {/* COLUMNA IZQUIERDA: Anatomía Protagonista + Barra de Herramientas Vertical */}
          <div className="md:col-span-5 lg:col-span-5 flex flex-col items-center justify-center relative">
            {/* Barra vertical flotante de herramientas anatómicas (Zoom +, Zoom -, Alternar Vista, Limpiar/Enfocar) */}
            <div className="absolute left-1 sm:left-2 top-16 z-20 bg-[#141414]/90 backdrop-blur-md border border-[#CCFF00]/35 rounded-2xl p-1.5 flex flex-col gap-2 shadow-[0_0_16px_rgba(0,0,0,0.7)]">
              <button
                type="button"
                onClick={() => setAnatomyZoom((z) => Math.min(1.35, Number((z + 0.15).toFixed(2))))}
                className="w-8 h-8 rounded-xl bg-[#171717] hover:bg-[#262626] border border-[#303030] hover:border-[#CCFF00] flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
                title="Acercar anatomía"
                aria-label="Acercar anatomía"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setAnatomyZoom((z) => Math.max(1, Number((z - 0.15).toFixed(2))))}
                className="w-8 h-8 rounded-xl bg-[#171717] hover:bg-[#262626] border border-[#303030] hover:border-[#CCFF00] flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
                title="Alejar anatomía"
                aria-label="Alejar anatomía"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSwitchViewAngle(selectedViewAngle === 'frontal' ? 'posterior' : 'frontal')
                }
                className="w-8 h-8 rounded-xl bg-[#171717] hover:bg-[#262626] border border-[#303030] hover:border-[#CCFF00] flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
                title="Alternar Vista Frontal / Posterior"
                aria-label="Alternar vista"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setAnatomyZoom(1);
                  if (selectedMuscleIds.length > 0) {
                    setSelectedMuscleIds([]);
                  } else {
                    const defId: InteractiveMuscleId =
                      selectedViewAngle === 'frontal' ? 'pectoral_medio_left' : 'dorsal_ancho_left';
                    setLastSelectedMuscleId(defId);
                    setSelectedMuscleIds(getSymmetricGroupIds(defId));
                  }
                }}
                className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                  selectedMuscleIds.length === 0
                    ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00]'
                    : 'bg-[#171717] hover:bg-[#262626] text-[#F5F5F5] border-[#303030] hover:border-[#CCFF00]'
                }`}
                title={
                  selectedMuscleIds.length > 0
                    ? 'Ver anatomía limpia sin resaltados'
                    : 'Restaurar selección muscular'
                }
                aria-label="Alternar resaltado muscular"
              >
                <Crosshair className="w-4 h-4" />
              </button>
            </div>

            {/* Contenedor Anatómico: Aprovecha el ancho móvil manteniendo proporción exacta 320:652 */}
            <div className="relative w-[80%] sm:w-[75%] md:w-[94%] max-w-[335px] sm:max-w-[360px] aspect-[320/652] mx-auto flex items-center justify-center select-none overflow-hidden">
              <svg
                className="w-full h-full overflow-visible transition-transform duration-300"
                style={{
                  transform: `scale(${anatomyZoom})`,
                  transformOrigin: 'center center',
                }}
                viewBox={mainSvgViewBox}
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  {/* 1. Filtro de extracción de luminancia de fibras reales de la ilustración */}
                  <filter id="extract-muscle-fibers" colorInterpolationFilters="sRGB">
                    <feColorMatrix
                      type="matrix"
                      values="0.33 0.33 0.33 0 0
                              0.33 0.33 0.33 0 0
                              0.33 0.33 0.33 0 0
                              0    0    0    1 0"
                      result="luma"
                    />
                    <feComponentTransfer in="luma">
                      <feFuncR type="gamma" amplitude="1.45" exponent="1.55" offset="-0.06" />
                      <feFuncG type="gamma" amplitude="1.45" exponent="1.55" offset="-0.06" />
                      <feFuncB type="gamma" amplitude="1.45" exponent="1.55" offset="-0.06" />
                    </feComponentTransfer>
                  </filter>

                  {/* 2. Máscaras de fibras reales a nivel de píxel: mantienen oscuros los surcos e intersecciones tendinosas */}
                  <mask id="frontal-fiber-mask">
                    <image
                      href="/images/anatomia-frontal.png"
                      x="96"
                      y="88"
                      width="320"
                      height="652"
                      preserveAspectRatio="none"
                      filter="url(#extract-muscle-fibers)"
                    />
                  </mask>
                  <mask id="posterior-fiber-mask">
                    <image
                      href="/images/anatomia-posterior.png"
                      x="584"
                      y="88"
                      width="320"
                      height="652"
                      preserveAspectRatio="none"
                      filter="url(#extract-muscle-fibers)"
                    />
                  </mask>

                  {/* 3. Desenfoque Gaussiano orgánico para bordes suaves sin ningún polígono duro */}
                  <filter id="anatomical-feather" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="4.2" />
                  </filter>

                  {/* 4. Resplandor suave exterior */}
                  <filter id="anatomical-aura" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="8" />
                  </filter>

                  {/* Máscara elíptica suave para fundir los bordes de la ilustración en #090909 */}
                  <radialGradient id="body-vignette-grad" cx="50%" cy="50%" r="50%">
                    <stop offset="76%" stopColor="white" stopOpacity="1" />
                    <stop offset="94%" stopColor="white" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="black" stopOpacity="0" />
                  </radialGradient>

                  <mask id="frontal-vignette-mask">
                    <ellipse cx="256" cy="414" rx="156" ry="322" fill="url(#body-vignette-grad)" />
                  </mask>
                  <mask id="posterior-vignette-mask">
                    <ellipse cx="744" cy="414" rx="156" ry="322" fill="url(#body-vignette-grad)" />
                  </mask>

                  {/* Halo neón ambiental detrás del torso */}
                  <radialGradient id="torso-aura-grad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#CCFF00" stopOpacity="0.22" />
                    <stop offset="60%" stopColor="#CCFF00" stopOpacity="0.06" />
                    <stop offset="100%" stopColor="#CCFF00" stopOpacity="0" />
                  </radialGradient>

                  {/* Plataforma neón bajo los pies */}
                  <radialGradient id="pedestal-grad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#CCFF00" stopOpacity="0.45" />
                    <stop offset="55%" stopColor="#CCFF00" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#CCFF00" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* Anillos de energía verde lima detrás del torso */}
                <circle
                  cx={bodyCenterX}
                  cy="275"
                  r="136"
                  fill="url(#torso-aura-grad)"
                  pointerEvents="none"
                />
                <circle
                  cx={bodyCenterX}
                  cy="275"
                  r="116"
                  fill="none"
                  stroke="#CCFF00"
                  strokeOpacity="0.25"
                  strokeWidth="1.2"
                  pointerEvents="none"
                />
                <circle
                  cx={bodyCenterX}
                  cy="275"
                  r="140"
                  fill="none"
                  stroke="#CCFF00"
                  strokeOpacity="0.12"
                  strokeWidth="1"
                  pointerEvents="none"
                />

                {/* Plataforma de energía verde lima bajo los pies */}
                <ellipse
                  cx={bodyCenterX}
                  cy="718"
                  rx="132"
                  ry="18"
                  fill="url(#pedestal-grad)"
                  pointerEvents="none"
                />
                <ellipse
                  cx={bodyCenterX}
                  cy="718"
                  rx="108"
                  ry="10"
                  fill="none"
                  stroke="#CCFF00"
                  strokeOpacity="0.65"
                  strokeWidth="1.6"
                  pointerEvents="none"
                />
                <ellipse
                  cx={bodyCenterX}
                  cy="718"
                  rx="134"
                  ry="16"
                  fill="none"
                  stroke="#CCFF00"
                  strokeOpacity="0.28"
                  strokeWidth="1"
                  pointerEvents="none"
                />

                {/* =====================================================================
                    ILUSTRACIÓN ANATÓMICA ORIGINAL INTACTA (Frontal o Posterior)
                   ===================================================================== */}
                <image
                  href={activeAnatomyImageSrc}
                  x={imageX}
                  y="88"
                  width="320"
                  height="652"
                  preserveAspectRatio="none"
                  mask={
                    selectedViewAngle === 'frontal'
                      ? 'url(#frontal-vignette-mask)'
                      : 'url(#posterior-vignette-mask)'
                  }
                  pointerEvents="none"
                />

                {/* =====================================================================
                    CAPA 1: CAPA VISUAL DE MÁSCARAS ANATÓMICAS (pointerEvents="none")
                    - Enmascarada por la luminancia real de las fibras (activeFiberMaskUrl)
                      para que los surcos oscuros e intersecciones tendinosas NUNCA se cubran.
                    - Difuminada con feGaussianBlur (anatomical-feather / anatomical-aura)
                      para eliminar al 100% cualquier borde geométrico.
                   ===================================================================== */}
                <g
                  id="capa-visual-iluminacion"
                  mask={activeFiberMaskUrl}
                  pointerEvents="none"
                >
                  {currentVisualRegions.map((region) => {
                    const isAnyMemberSelected = region.memberIds.some((mId) =>
                      selectedMuscleIds.includes(mId)
                    );
                    const isAnyMemberHovered = region.memberIds.some(
                      (mId) => hoveredMuscleId === mId
                    );

                    const parentState = recoveryReport[region.parentBiometricId];
                    const hasData = Boolean(parentState?.hasHistoricalData);
                    const fatigue = parentState ? parentState.fatigue : 0;
                    const remFloat = parentState
                      ? parentState.remainingHours + parentState.remainingMinutes / 60
                      : 0;

                    // Color real sincronizado con el motor de recuperación
                    const realStatusColor =
                      hasData && parentState?.statusColor && parentState.statusColor !== '#71717A'
                        ? parentState.statusColor
                        : '#CCFF00';

                    // En modo EXPLORACIÓN: anatomía limpia, solo se ilumina el músculo seleccionado o en hover
                    if (visualizationMode === 'exploracion') {
                      if (!isAnyMemberSelected && !isAnyMemberHovered) {
                        return null;
                      }
                      const exploreColor = '#CCFF00';
                      return (
                        <g key={`vis-exp-${region.regionKey}`}>
                          <path
                            d={region.unifiedPath}
                            fill={exploreColor}
                            fillOpacity="0.88"
                            filter="url(#anatomical-feather)"
                            style={{ mixBlendMode: 'color' }}
                          />
                          <path
                            d={region.unifiedPath}
                            fill={exploreColor}
                            fillOpacity={isAnyMemberHovered ? '0.48' : '0.4'}
                            filter="url(#anatomical-aura)"
                            style={{ mixBlendMode: 'screen' }}
                          />
                        </g>
                      );
                    }

                    // En modo RECUPERACIÓN: mostrar colores calculados en músculos con entrenamientos o en el músculo seleccionado
                    const showInRecoveryMode =
                      isAnyMemberSelected ||
                      isAnyMemberHovered ||
                      (hasData && (fatigue > 0 || remFloat > 0));
                    if (!showInRecoveryMode) {
                      return null;
                    }

                    const activeColor = hasData ? realStatusColor : '#CCFF00';
                    const isFocused = isAnyMemberSelected || isAnyMemberHovered;

                    return (
                      <g key={`vis-rec-${region.regionKey}`}>
                        {/* Tinte cromático puro sobre las fibras grises preservando sombras y surcos */}
                        <path
                          d={region.unifiedPath}
                          fill={activeColor}
                          fillOpacity={isFocused ? '0.92' : '0.78'}
                          filter="url(#anatomical-feather)"
                          style={{ mixBlendMode: 'color' }}
                        />
                        {/* Luminiscencia suave modulada por las fibras musculares */}
                        <path
                          d={region.unifiedPath}
                          fill={activeColor}
                          fillOpacity={isFocused ? '0.42' : '0.26'}
                          filter="url(#anatomical-aura)"
                          style={{ mixBlendMode: 'screen' }}
                        />
                      </g>
                    );
                  })}
                </g>

                {/* =====================================================================
                    CAPA 2: CAPA INTERACTIVA TRANSPARENTE (Zonas táctiles invisibles)
                    - 100% invisible (fill="transparent", stroke="none")
                    - Nunca produce figuras geométricas visibles
                   ===================================================================== */}
                <g id="capa-interactiva-transparente">
                  {currentViewMuscles.map((muscleId) => {
                    const meta = DETAILED_MUSCLE_REGISTRY[muscleId];
                    return (
                      <path
                        key={`hit-${muscleId}`}
                        d={meta.svgPath}
                        fill="transparent"
                        stroke="transparent"
                        strokeWidth="4"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredMuscleId(muscleId)}
                        onMouseLeave={() => setHoveredMuscleId(null)}
                        onClick={(e) => handleMuscleClick(muscleId, e)}
                      >
                        <title>{meta.name}</title>
                      </path>
                    );
                  })}
                </g>
              </svg>
            </div>
          </div>

          {/* COLUMNA DERECHA (Y DEBAJO EN MÓVIL): LEYENDA + FICHA DEL MÚSCULO */}
          <div ref={detailCardRef} className="md:col-span-7 lg:col-span-7 space-y-3.5">
            {/* =====================================================================
                5. TARJETA LEYENDA: ESTADO MUSCULAR + ANILLO PROPORCIONAL COMPACTO
               ===================================================================== */}
            <section className="relative overflow-hidden rounded-[22px] bg-[#171717] border border-[#CCFF00]/40 p-3.5 sm:p-4 shadow-xl space-y-2.5">
              <div className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-[#CCFF00]/10 blur-2xl" />

              <div className="flex items-center justify-between gap-2 border-b border-[#303030]/75 pb-2">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <h3 className="text-xs xs:text-sm sm:text-base font-black italic uppercase tracking-wide text-[#F5F5F5]">
                    ESTADO MUSCULAR
                  </h3>
                  <span className="text-[11px] text-[#F5F5F5]/65">
                    (Tiempo restante est.)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#CCFF00] bg-[#090909] border border-[#303030] px-2 py-0.5 rounded-full shrink-0">
                  Últimas 72 h
                </span>
              </div>

              {/* Distribución móvil y escritorio proporcional sin espacios vacíos */}
              <div className="grid grid-cols-[1fr_auto] items-center gap-2.5 xs:gap-3.5 sm:gap-5 pt-0.5">
                <div className="min-w-0 space-y-1.5 text-[11.5px] xs:text-xs sm:text-[13px]">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3 h-3 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444] shrink-0" />
                      <span className="text-[#F5F5F5] font-medium leading-tight">
                        Fatiga alta
                      </span>
                    </div>
                    <span className="text-[#F5F5F5]/70 font-mono text-[10.5px] xs:text-[11px] shrink-0">
                      (&gt; 36 h)
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3 h-3 rounded-full bg-[#F97316] shadow-[0_0_8px_#F97316] shrink-0" />
                      <span className="text-[#F5F5F5] font-medium leading-tight">
                        Fatiga moderada
                      </span>
                    </div>
                    <span className="text-[#F5F5F5]/70 font-mono text-[10.5px] xs:text-[11px] shrink-0">
                      (24 – 36 h)
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3 h-3 rounded-full bg-[#FACC15] shadow-[0_0_8px_#FACC15] shrink-0" />
                      <span className="text-[#F5F5F5] font-medium leading-tight">
                        Recup. en progreso
                      </span>
                    </div>
                    <span className="text-[#F5F5F5]/70 font-mono text-[10.5px] xs:text-[11px] shrink-0">
                      (6 – 24 h)
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3 h-3 rounded-full bg-[#CCFF00] shadow-[0_0_8px_#CCFF00] shrink-0" />
                      <span className="text-[#F5F5F5] font-medium leading-tight">
                        Recup. suficiente
                      </span>
                    </div>
                    <span className="text-[#F5F5F5]/70 font-mono text-[10.5px] xs:text-[11px] shrink-0">
                      (0 – 6 h)
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3 h-3 rounded-full bg-[#71717A] border border-zinc-500 shrink-0" />
                      <span className="text-[#F5F5F5] font-medium leading-tight">
                        Sin datos
                      </span>
                    </div>
                    <span className="text-[#F5F5F5]/70 font-mono text-[10.5px] xs:text-[11px] shrink-0">
                      (Sin reg.)
                    </span>
                  </div>
                </div>

                {/* Gráfico circular proporcional de Músculos entrenados */}
                <div className="relative w-[88px] h-[88px] xs:w-[96px] xs:h-[96px] sm:w-[108px] sm:h-[108px] shrink-0 flex items-center justify-center">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="#262626"
                      strokeWidth="10"
                    />
                    {trainedMusclesRingStats.arcs.length > 0 ? (
                      trainedMusclesRingStats.arcs.map((arc, idx) => (
                        <circle
                          key={idx}
                          cx="50"
                          cy="50"
                          r="40"
                          fill="none"
                          stroke={arc.color}
                          strokeWidth="10"
                          strokeDasharray={arc.dashArray}
                          strokeDashoffset={arc.dashOffset}
                          strokeLinecap="butt"
                        />
                      ))
                    ) : (
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="#383838"
                        strokeWidth="10"
                        strokeDasharray="55 8"
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1.5">
                    <span className="text-xl xs:text-2xl font-black text-[#F5F5F5] leading-none">
                      {trainedMusclesRingStats.trainedCount}
                    </span>
                    <span className="text-[9.5px] xs:text-[10px] font-semibold text-[#F5F5F5]/80 leading-tight mt-0.5">
                      Músculos
                      <br />
                      entrenados
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* =====================================================================
                6. FICHA DEL MÚSCULO SELECCIONADO
               ===================================================================== */}
            <section className="relative overflow-hidden rounded-[22px] bg-[#171717] border border-[#CCFF00]/55 p-3.5 sm:p-4 shadow-[0_0_24px_rgba(204,255,0,0.12)] space-y-3.5">
              <div className="pointer-events-none absolute -top-12 -right-12 w-36 h-36 rounded-full bg-[#CCFF00]/15 blur-2xl" />

              {/* Encabezado de la ficha con miniatura anatómica, nombre completo en 1-2 líneas y botón reorganizado */}
              <div className="border-b border-[#303030]/85 pb-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Miniatura anatómica focalizada con máscara de fibras reales */}
                    <div className="w-[72px] h-[58px] sm:w-20 sm:h-16 rounded-xl bg-[#090909] border border-[#CCFF00]/60 overflow-hidden shrink-0 relative shadow-inner mt-0.5">
                      <svg
                        className="w-full h-full"
                        viewBox={primaryActiveMeta.cropBox}
                        preserveAspectRatio="xMidYMid slice"
                      >
                        <image
                          href={
                            primaryActiveMeta.view === 'frontal'
                              ? '/images/anatomia-frontal.png'
                              : '/images/anatomia-posterior.png'
                          }
                          x={primaryActiveMeta.view === 'frontal' ? 96 : 584}
                          y="88"
                          width="320"
                          height="652"
                          preserveAspectRatio="none"
                        />
                        <g
                          mask={
                            primaryActiveMeta.view === 'frontal'
                              ? 'url(#frontal-fiber-mask)'
                              : 'url(#posterior-fiber-mask)'
                          }
                        >
                          <path
                            d={primaryActiveMeta.unifiedGroupPath || primaryActiveMeta.svgPath}
                            fill={
                              hasSelectedMuscleData &&
                              primaryActiveRecovery.statusColor !== '#71717A'
                                ? primaryActiveRecovery.statusColor
                                : '#CCFF00'
                            }
                            fillOpacity="0.9"
                            filter="url(#anatomical-feather)"
                            style={{ mixBlendMode: 'color' }}
                          />
                          {primaryActiveMeta.id.startsWith('pectoral_') && (
                            <path
                              d={
                                primaryActiveMeta.id.endsWith('_left')
                                  ? UNIFIED_GROUP_PATHS.pectoral_right
                                  : UNIFIED_GROUP_PATHS.pectoral_left
                              }
                              fill={
                                hasSelectedMuscleData &&
                                primaryActiveRecovery.statusColor !== '#71717A'
                                  ? primaryActiveRecovery.statusColor
                                  : '#CCFF00'
                              }
                              fillOpacity="0.9"
                              filter="url(#anatomical-feather)"
                              style={{ mixBlendMode: 'color' }}
                            />
                          )}
                        </g>
                      </svg>
                    </div>

                    {/* Nombre completo sin truncamiento obligatorio: permite 2 líneas limpiamente */}
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg xs:text-xl sm:text-2xl font-black italic uppercase tracking-tight text-[#F5F5F5] leading-tight break-words">
                        {primaryActiveMeta.shortGroup}
                      </h3>
                      <div className="w-20 sm:w-24 h-0.5 bg-[#CCFF00] my-1.5 rounded-full shadow-[0_0_8px_#CCFF00]" />
                      <p className="text-xs sm:text-[13px] font-semibold text-[#F5F5F5]/90 leading-snug break-words">
                        {primaryActiveMeta.name}
                      </p>
                    </div>
                  </div>

                  {/* Botón de marcador compacto en esquina superior derecha sin comprimir el título */}
                  <button
                    type="button"
                    onClick={() => setIsBookmarked((b) => !b)}
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                      isBookmarked
                        ? 'bg-[#CCFF00]/15 border-[#CCFF00] text-[#CCFF00]'
                        : 'bg-[#090909] border-[#303030] text-[#CCFF00] hover:border-[#CCFF00]'
                    }`}
                    title="Fijar músculo en seguimiento"
                    aria-label="Fijar músculo"
                  >
                    <Bookmark className="w-4 h-4" fill={isBookmarked ? '#CCFF00' : 'none'} />
                  </button>
                </div>

                {/* Barra secundaria de contexto y acceso rápido al mapa en móvil (evita comprimir el título) */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#090909] border border-[#303030] text-[11px] font-semibold text-[#F5F5F5]/80">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          hasSelectedMuscleData && primaryActiveRecovery.statusColor !== '#71717A'
                            ? primaryActiveRecovery.statusColor
                            : '#CCFF00',
                      }}
                    />
                    <span>
                      {primaryActiveMeta.view === 'frontal' ? 'Vista Frontal' : 'Vista Posterior'}
                    </span>
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      anatomyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                    className="md:hidden px-3 py-1 rounded-lg bg-[#090909] border border-[#303030] hover:border-[#CCFF00] text-[11px] font-bold text-[#CCFF00] inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                    <span>Volver al mapa</span>
                  </button>
                </div>
              </div>

              {/* Resumen de Selección Múltiple cuando está activo */}
              {isMultiSelectMode && multiSelectStats && (
                <div className="p-3 rounded-xl bg-[#090909] border border-[#CCFF00]/40 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#CCFF00] flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      <span>{multiSelectStats.count} regiones seleccionadas</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedMuscleIds(getSymmetricGroupIds(lastSelectedMuscleId))
                      }
                      className="text-[11px] text-[#F5F5F5]/70 underline cursor-pointer"
                    >
                      Limpiar
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center font-mono text-[11px]">
                    <div className="p-1.5 rounded-lg bg-[#171717] border border-[#303030]">
                      <span className="text-[9px] text-[#F5F5F5]/60 block">Fatiga Est.</span>
                      <span className="font-bold text-[#F5F5F5]">
                        {multiSelectStats.levelLabel}
                      </span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-[#171717] border border-[#303030]">
                      <span className="text-[9px] text-[#F5F5F5]/60 block">Volumen</span>
                      <span className="font-bold text-[#CCFF00]">
                        {multiSelectStats.musclesWithData > 0
                          ? `${Math.round(multiSelectStats.totalVolume).toLocaleString('es-CL')} kg`
                          : '- kg'}
                      </span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-[#171717] border border-[#303030]">
                      <span className="text-[9px] text-[#F5F5F5]/60 block">Restante</span>
                      <span className="font-bold text-[#F5F5F5]">
                        {multiSelectStats.musclesWithData > 0
                          ? `${multiSelectStats.maxH}h ${multiSelectStats.maxM}m`
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Grid de Telemetría en 2 Columnas con datos 100% reales y coherentes */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* Subcolumna izquierda: Última sesión, Series realizadas, Volumen total */}
                <div className="sm:col-span-7 divide-y divide-[#303030]/80 text-xs rounded-xl bg-[#111111]/70 border border-[#303030]/70 px-3 py-1">
                  <div className="py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[#F5F5F5]/85">
                      <Calendar className="w-4 h-4 text-[#CCFF00] shrink-0" />
                      <span>Última sesión</span>
                    </div>
                    <span className="font-bold text-[#F5F5F5] font-mono">
                      {hasSelectedMuscleData && primaryActiveRecovery.lastTrainedDate
                        ? primaryActiveRecovery.lastTrainedDate.slice(0, 10)
                        : 'Sin datos'}
                    </span>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[#F5F5F5]/85">
                      <Layers className="w-4 h-4 text-[#CCFF00] shrink-0" />
                      <span>Series realizadas</span>
                    </div>
                    <span className="font-bold text-[#F5F5F5] font-mono">
                      {hasSelectedMuscleData ? primaryActiveRecovery.sets : '-'}
                    </span>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[#F5F5F5]/85">
                      <Dumbbell className="w-4 h-4 text-[#CCFF00] shrink-0" />
                      <span>Volumen total</span>
                    </div>
                    <span className="font-bold text-[#F5F5F5] font-mono">
                      {hasSelectedMuscleData
                        ? `${Math.round(primaryActiveRecovery.volume).toLocaleString('es-CL')} kg`
                        : '- kg'}
                    </span>
                  </div>
                </div>

                {/* Subcolumna derecha: Recuperación estimada y Fatiga estimada */}
                <div className="sm:col-span-5 rounded-xl bg-[#111111] border border-[#303030] p-3 flex flex-col justify-between gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-[#F5F5F5]/85">
                      <Clock className="w-4 h-4 text-[#CCFF00] shrink-0" />
                      <span className="leading-tight">
                        Recuperación
                        <br />
                        estimada
                      </span>
                    </div>
                    <span className="text-base sm:text-lg font-black text-[#CCFF00] font-mono">
                      {hasSelectedMuscleData
                        ? primaryActiveRecovery.remainingHours === 0 &&
                          primaryActiveRecovery.remainingMinutes === 0
                          ? '0 h'
                          : primaryActiveRecovery.remainingMinutes > 0 &&
                            primaryActiveRecovery.remainingHours < 10
                          ? `${primaryActiveRecovery.remainingHours}h ${primaryActiveRecovery.remainingMinutes}m`
                          : `${primaryActiveRecovery.remainingHours} h`
                        : '-'}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-[#303030]/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-[#F5F5F5]/85">
                      <Activity className="w-4 h-4 text-[#CCFF00] shrink-0" />
                      <span>Fatiga estimada</span>
                    </div>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold whitespace-nowrap"
                      style={{
                        backgroundColor: fatigueLevelBadge.bg,
                        color: fatigueLevelBadge.textColor,
                      }}
                    >
                      {fatigueLevelBadge.label}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sección EJERCICIOS ASOCIADOS con mejor ancho disponible y desplazamiento horizontal */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <h4 className="text-xs sm:text-sm font-black italic uppercase tracking-wide text-[#F5F5F5]">
                      EJERCICIOS ASOCIADOS
                    </h4>
                    <span className="text-[11px] text-[#F5F5F5]/65">
                      {hasSelectedMuscleData ? '(Última sesión)' : '(Sugeridos)'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowHistoryModal(true)}
                    className="text-xs font-semibold text-[#F5F5F5]/85 hover:text-[#CCFF00] flex items-center gap-0.5 cursor-pointer transition-colors shrink-0"
                  >
                    <span>Ver todos</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#CCFF00]" />
                  </button>
                </div>

                {/* Contenedor horizontal deslizable con tarjetas amplias y legibles */}
                <div className="flex gap-2.5 sm:gap-3 overflow-x-auto pb-1.5 pt-0.5 snap-x snap-mandatory">
                  {associatedExercisesList.map((item, idx) => (
                    <div
                      key={idx}
                      className="min-w-[164px] xs:min-w-[174px] sm:min-w-[184px] flex-1 snap-start rounded-xl bg-[#090909] border border-[#CCFF00]/35 p-2.5 flex flex-col justify-between gap-2 shadow-inner"
                    >
                      <div className="rounded-lg overflow-hidden border border-[#262626] bg-[#0D0D0D]">
                        <ExerciseSilhouetteGraphic index={idx} />
                      </div>
                      <div className="space-y-1.5 flex-1 flex flex-col justify-between">
                        <span className="text-xs sm:text-[13px] font-bold text-[#F5F5F5] leading-snug break-words block">
                          {item.name}
                        </span>
                        <div className="px-2 py-1 rounded-lg bg-[#141414] border border-[#303030] flex items-center justify-between gap-1.5">
                          <span className="text-[11px] font-mono font-semibold text-[#CCFF00] leading-none">
                            {item.sublabel}
                          </span>
                          {item.detail && (
                            <span className="text-[10px] font-mono text-[#F5F5F5]/70 leading-none">
                              {item.detail}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tarjeta interna RECOMENDACIÓN */}
              <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-1.5">
                <div className="flex items-center gap-2 text-[#CCFF00]">
                  <Target className="w-4 h-4 shrink-0" />
                  <span className="text-xs sm:text-sm font-black italic uppercase tracking-wide">
                    RECOMENDACIÓN
                  </span>
                </div>
                <p className="text-xs text-[#F5F5F5]/90 leading-relaxed">
                  {recommendationText}
                </p>
              </div>

              {/* Botón HISTORIAL DEL MÚSCULO > */}
              <button
                type="button"
                onClick={() => setShowHistoryModal(true)}
                className="w-full p-3.5 rounded-2xl bg-[#090909] border border-[#CCFF00]/65 hover:border-[#CCFF00] flex items-center justify-between gap-3 transition-all cursor-pointer shadow-[0_0_14px_rgba(204,255,0,0.12)] active:scale-[0.99]"
              >
                <div className="flex items-center gap-2.5">
                  <BarChart2 className="w-5 h-5 text-[#CCFF00] shrink-0" />
                  <span className="text-xs sm:text-sm font-black italic uppercase tracking-wide text-[#F5F5F5]">
                    HISTORIAL DEL MÚSCULO
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-[#CCFF00] shrink-0" />
              </button>
            </section>
          </div>
        </div>

        {/* Espaciador de seguridad inferior para garantizar que ninguna tarjeta ni botón quede tapado por la barra fija */}
        <div className="h-8 sm:h-6 w-full shrink-0" aria-hidden="true" />

        {/* =========================================================================
            MODAL 1: HISTORIAL DEL MÚSCULO Y RECOMENDACIONES DE SPLITS
           ========================================================================= */}
        {showHistoryModal && (
          <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <div className="bg-[#171717] border border-[#303030] rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-4 sm:p-5 border-b border-[#303030] flex items-center justify-between gap-3 bg-[#090909]">
                <div className="min-w-0">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#CCFF00] block">
                    ANÁLISIS BIOMECÁNICO Y REGISTROS
                  </span>
                  <h3 className="text-base sm:text-lg font-black italic uppercase text-[#F5F5F5] leading-snug break-words">
                    {primaryActiveMeta.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(false)}
                  className="w-9 h-9 rounded-xl bg-[#171717] border border-[#303030] text-[#F5F5F5] flex items-center justify-center cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto space-y-5">
                {/* Ejercicios registrados para este músculo */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-[#CCFF00] flex items-center gap-1.5">
                    <Dumbbell className="w-4 h-4" />
                    <span>Ejercicios Registrados en este Músculo</span>
                  </h4>

                  {hasSelectedMuscleData && primaryActiveRecovery.exercisesTriggered.length > 0 ? (
                    <div className="space-y-2">
                      {primaryActiveRecovery.exercisesTriggered.map((trig, idx) => (
                        <div
                          key={`${trig.workoutId}-${idx}`}
                          className="p-3 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-[#F5F5F5] break-words">
                                {trig.exerciseName}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-[#171717] border border-[#303030] text-[10px] font-mono text-[#CCFF00]">
                                {trig.role === 'primary'
                                  ? 'Primario'
                                  : 'Sinergista'}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#F5F5F5]/65 font-mono block mt-0.5">
                              {trig.workoutDate.slice(0, 10)} • {trig.sets} series × {trig.reps} reps
                              {trig.weightKg > 0 ? ` @ ${trig.weightKg} kg` : ''}
                            </span>
                          </div>
                          <span className="font-mono font-black text-[#CCFF00] shrink-0">
                            {Math.round(trig.volumeKg).toLocaleString('es-CL')} kg
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-[#090909] border border-[#303030] space-y-2">
                      <span className="text-xs font-bold text-[#F5F5F5] block">
                        Sin datos suficientes en el historial
                      </span>
                      <p className="text-xs text-[#F5F5F5]/70">
                        Ejercicios recomendados para activar {primaryActiveMeta.name}:
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {primaryActiveMeta.suggestedExercises.map((ex, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-xl bg-[#171717] border border-[#303030] text-xs text-[#CCFF00]"
                          >
                            {ex}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Ubicación y función biomecánica */}
                <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-[#CCFF00] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-[#F5F5F5]">Ubicación y función: </span>
                      <span className="text-[#F5F5F5]/75">
                        {primaryActiveMeta.location} {primaryActiveMeta.biomechanicalFunction}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 pt-1.5 border-t border-[#303030]">
                    <Share2 className="w-4 h-4 text-[#CCFF00] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-[#F5F5F5]">Sinergistas: </span>
                      <span className="text-[#F5F5F5]/75">
                        {primaryActiveMeta.secondaryMusclesList.join(', ')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Historial global por período */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-[#F5F5F5]">
                      Carga Global ({periodHistorySummary.periodLabel})
                    </h4>
                    <div className="flex items-center bg-[#090909] p-1 rounded-xl border border-[#303030]">
                      {(['hoy', '7dias', '30dias', '90dias'] as const).map((period) => (
                        <button
                          key={period}
                          type="button"
                          onClick={() => setTimePeriodFilter(period)}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer ${
                            timePeriodFilter === period
                              ? 'bg-[#CCFF00] text-[#090909] font-black'
                              : 'text-[#F5F5F5]/70'
                          }`}
                        >
                          {period === 'hoy'
                            ? 'Hoy'
                            : period === '7dias'
                            ? '7d'
                            : period === '30dias'
                            ? '30d'
                            : '90d'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
                    <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030]">
                      <span className="text-[10px] text-[#F5F5F5]/60 block">Sesiones</span>
                      <span className="font-black text-[#F5F5F5]">
                        {periodHistorySummary.totalWorkouts}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030]">
                      <span className="text-[10px] text-[#F5F5F5]/60 block">Series</span>
                      <span className="font-black text-[#F5F5F5]">
                        {periodHistorySummary.totalSetsCompleted}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030]">
                      <span className="text-[10px] text-[#F5F5F5]/60 block">Volumen</span>
                      <span className="font-black text-[#CCFF00]">
                        {Math.round(periodHistorySummary.totalVolumeKg).toLocaleString('es-CL')} kg
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            MODAL 2: RESUMEN DE LOS 10 GRUPOS MUSCULARES PRINCIPALES & SPLITS
           ========================================================================= */}
        {showAllDetailsModal && (
          <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <div className="bg-[#171717] border border-[#303030] rounded-3xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-4 sm:p-5 border-b border-[#303030] flex items-center justify-between gap-3 bg-[#090909]">
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-black italic uppercase text-[#F5F5F5] leading-snug">
                    ESTADO DE LOS 10 GRUPOS MUSCULARES
                  </h3>
                  <p className="text-xs text-[#F5F5F5]/70">
                    {hasAnyWorkoutHistory
                      ? `${athleteSummary.overallStatusText} • ${trainedMusclesRingStats.trainedCount} grupos con registros recientes`
                      : 'Sin datos suficientes en el historial'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllDetailsModal(false)}
                  className="w-9 h-9 rounded-xl bg-[#171717] border border-[#303030] text-[#F5F5F5] flex items-center justify-center cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {athleteSummary.readyMuscles
                    .concat(athleteSummary.inRecoveryMuscles)
                    .concat(athleteSummary.highFatigueMuscles)
                    .filter((m) => {
                      if (detailStatusFilter === 'LISTO') return m.readiness === 'LISTO PARA ENTRENAR';
                      if (detailStatusFilter === 'PROCESO')
                        return m.readiness === 'RECUPERACIÓN EN PROCESO';
                      if (detailStatusFilter === 'DESCANSO')
                        return m.readiness === 'DESCANSO RECOMENDADO';
                      return true;
                    })
                    .map((m) => (
                      <div
                        key={m.canonicalId}
                        className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-black text-[#F5F5F5] break-words">
                            {m.name}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded-full text-[9px] font-mono font-black border uppercase shrink-0"
                            style={{
                              backgroundColor: `${m.statusColor}18`,
                              color: m.statusColor,
                              borderColor: `${m.statusColor}55`,
                            }}
                          >
                            {m.statusColor === '#71717A' ? 'SIN DATOS' : m.readiness}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs font-mono text-[#F5F5F5]/80">
                          <span>Fatiga estimada:</span>
                          <span className="font-bold text-[#F5F5F5]">
                            {getQualitativeStatusLabel(m.statusColor)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs font-mono text-[#F5F5F5]/80">
                          <span>Tiempo restante est.:</span>
                          <span className="font-bold text-[#CCFF00]">
                            {m.statusColor === '#71717A'
                              ? 'Sin datos'
                              : m.remainingHours === 0 && m.remainingMinutes === 0
                              ? '0 h (Recuperado)'
                              : `${m.remainingHours} h ${m.remainingMinutes} min`}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Splits sugeridos */}
                <div className="space-y-2.5 pt-2 border-t border-[#303030]">
                  <h4 className="text-xs font-black uppercase tracking-wider text-[#CCFF00] flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4" />
                    <span>Splits de Entrenamiento Sugeridos</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {athleteSummary.suggestedSessionSplits.map((split, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-2xl bg-[#090909] border border-[#303030] flex flex-col justify-between gap-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black text-[#F5F5F5]">{split.splitName}</span>
                          <span className="text-[10px] font-mono font-bold text-[#CCFF00] shrink-0">
                            {hasAnyWorkoutHistory
                              ? split.isRecommended
                                ? 'Sugerido'
                                : 'En recuperación'
                              : 'Sin datos'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#F5F5F5]/75">{split.reason}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAllDetailsModal(false);
                            onNavigateTab('rutinas');
                          }}
                          className="text-[11px] font-bold text-[#CCFF00] hover:underline inline-flex items-center gap-1 self-end cursor-pointer"
                        >
                          <span>Ir a Rutinas</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default MapaMuscularView;
