import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Bot,
  Send,
  RefreshCw,
  AlertTriangle,
  Dumbbell,
  Calendar,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  Scale,
  Repeat,
  ChevronRight,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Square,
} from 'lucide-react';
import {
  ActiveWorkoutSession,
  CompletedWorkout,
  PersonalRecord,
  Profile,
  Routine,
} from '../types/index.ts';
import {
  askCoachAI,
  buildCoachExerciseAlternatives,
  buildMinimizedCoachContext,
  CoachAlternativeOption,
  CoachChatApiTurn,
  CoachQuickIntent,
  CoachReplacementPreview,
  CoachReplacementScope,
  createReplacementPreview,
} from '../utils/coachContextEngine.ts';
import {
  CoachLoadChangePreview,
  CoachVoiceCapabilities,
  detectCoachVoiceCapabilities,
  formatCoachTextForSpeech,
  getSpeechRecognitionConstructor,
  isSpeechSynthesisAvailable,
  loadAutoReadCoachPreference,
  mapSpeechRecognitionErrorToSpanish,
  parseCoachVoiceActionRequest,
  pickSpanishChileVoice,
  saveAutoReadCoachPreference,
  selectNextAutoSpeechMessage,
  SpeechRecognitionLike,
} from '../utils/coachVoiceEngine.ts';
import { checkCoachServiceStatus, type CoachServiceDiagnostic } from '../utils/coachServiceDiagnostics.ts';

const COACH_EQUIPMENT_FILTERS = [
  'Todos',
  'Máquinas',
  'Mancuernas',
  'Poleas',
  'Barras',
  'Peso corporal',
] as const;

export interface CoachChatModalProps {
  isOpen: boolean;
  initialIntent?: CoachQuickIntent | null;
  onClose: () => void;
  activeProfile: Profile;
  routines: Routine[];
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  activeSession: ActiveWorkoutSession | null;
  isHistorySyncing?: boolean;
  historySyncError?: string | null;
  onApplyReplacement: (preview: CoachReplacementPreview) => void;
  onApplyLoadChange?: (preview: CoachLoadChangePreview) => void;
  onStartWorkout?: (routine: Routine) => void;
  onNavigateRoutines?: () => void;
}

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  model?: string;
}

const QUICK_PROMPTS: Array<{
  intent: Exclude<CoachQuickIntent, 'freeform'>;
  label: string;
  promptBuilder: (exerciseName?: string) => string;
}> = [
  {
    intent: 'today_workout',
    label: '¿Qué me toca hoy?',
    promptBuilder: () => '¿Qué me toca entrenar hoy según mi rutina y mi estado actual?',
  },
  {
    intent: 'last_weight',
    label: '¿Qué peso usé la última vez?',
    promptBuilder: (exName) =>
      exName
        ? `¿Qué peso y repeticiones usé la última vez en ${exName}, y qué carga me sugieres hoy?`
        : '¿Qué peso usé la última vez en este ejercicio?',
  },
  {
    intent: 'replace_exercise',
    label: '¿Con qué reemplazo este ejercicio?',
    promptBuilder: (exName) =>
      exName
        ? `¿Con qué alternativa biomecánica puedo reemplazar ${exName} según el músculo y equipo disponible?`
        : '¿Con qué alternativa puedo reemplazar este ejercicio?',
  },
];

export const CoachChatModal: React.FC<CoachChatModalProps> = ({
  isOpen,
  initialIntent = 'today_workout',
  onClose,
  activeProfile,
  routines,
  history,
  prs,
  activeSession,
  isHistorySyncing = false,
  historySyncError = null,
  onApplyReplacement,
  onApplyLoadChange,
  onStartWorkout,
  onNavigateRoutines,
}) => {
  const [activeIntent, setActiveIntent] = useState<CoachQuickIntent>(
    initialIntent || 'today_workout'
  );
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [equipFilter, setEquipFilter] = useState<string>('Todos');
  const [altSearchQuery, setAltSearchQuery] = useState<string>('');
  const [pendingPreview, setPendingPreview] = useState<CoachReplacementPreview | null>(null);
  const [pendingLoadPreview, setPendingLoadPreview] = useState<CoachLoadChangePreview | null>(null);
  const [appliedBanner, setAppliedBanner] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const [coachWaitSeconds, setCoachWaitSeconds] = useState(0);
  const COACH_MAX_WAIT_MS = 27_000;
  const [serviceDiagnostic, setServiceDiagnostic] = useState<CoachServiceDiagnostic | null>(null);
  const [isCheckingService, setIsCheckingService] = useState(false);
  const [geminiError, setGeminiError] = useState<{
    message: string;
    code?: string;
    retryable?: boolean;
    lastRequest: { message: string; intent: CoachQuickIntent };
  } | null>(null);

  // Voice Input (STT) & Output (TTS) states
  const [autoReadEnabled, setAutoReadEnabled] = useState<boolean>(() =>
    loadAutoReadCoachPreference()
  );
  const [voiceCapabilities, setVoiceCapabilities] = useState<CoachVoiceCapabilities>(() =>
    detectCoachVoiceCapabilities()
  );
  const [isListening, setIsListening] = useState<boolean>(false);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<{
    tone: 'info' | 'error';
    text: string;
  } | null>(null);

  const [thumbErrors, setThumbErrors] = useState<Record<string, boolean>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoTriggeredKeyRef = useRef<string | null>(null);

  // Request lifecycle & concurrency guards (prevents stuck loading, duplicates, and stale responses)
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const latestRequestIdRef = useRef<number>(0);
  const isRequestInFlightRef = useRef<boolean>(false);
  const requestStartedAtRef = useRef<number>(0);
  const requestWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedRequestRef = useRef<{ message: string; intent: CoachQuickIntent } | null>(null);
  const abortReasonRef = useRef<'none' | 'user_cancel' | 'background_stale' | 'offline'>('none');
  const isMountedRef = useRef<boolean>(true);
  const prevProfileIdRef = useRef<string>(activeProfile.id);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isListeningRef = useRef<boolean>(false);
  const dictationFinalRef = useRef<string>('');
  const dictationInterimRef = useRef<string>('');
  const dictationPreInputRef = useRef<string>('');
  const dictationCancelledRef = useRef<boolean>(false);
  const dictationCommittedRef = useRef<boolean>(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const spokenMessageIdsRef = useRef<Set<string>>(new Set());

  const coachContext = useMemo(
    () =>
      buildMinimizedCoachContext({
        activeProfile,
        routines,
        history,
        prs,
        activeSession,
        selectedRoutineId,
        selectedExerciseId,
        filterEquipment: equipFilter,
        isHistorySyncing,
        historySyncError,
      }),
    [
      activeProfile,
      routines,
      history,
      prs,
      activeSession,
      selectedRoutineId,
      selectedExerciseId,
      equipFilter,
      isHistorySyncing,
      historySyncError,
    ]
  );

  const {
    resolution,
    selectedExercise,
    loadReport,
    historyCount,
    minimizedPayload,
  } = coachContext;

  const filteredAlternativesResult = useMemo(() => {
    if (!selectedExercise) {
      return { recommended: null, alternatives: [], targetPattern: '' };
    }
    return buildCoachExerciseAlternatives({
      exercise: selectedExercise,
      filterEquipment: equipFilter,
      searchQuery: altSearchQuery,
      limit: 6,
    });
  }, [selectedExercise, equipFilter, altSearchQuery]);

  // Keep selectedRoutineId and selectedExerciseId coherent when modal opens or routines change
  useEffect(() => {
    if (!isOpen) return;
    if (resolution.selectedRoutine && selectedRoutineId !== resolution.selectedRoutine.id && !selectedRoutineId) {
      setSelectedRoutineId(resolution.selectedRoutine.id);
    }
  }, [isOpen, resolution.selectedRoutine, selectedRoutineId]);

  useEffect(() => {
    if (!isOpen) return;
    if (
      resolution.exercises.length > 0 &&
      (!selectedExerciseId || !resolution.exercises.some((e) => e.id === selectedExerciseId))
    ) {
      setSelectedExerciseId(resolution.exercises[0].id);
    }
  }, [isOpen, resolution.exercises, selectedExerciseId]);

  const cancelActiveRequest = useCallback(
    (reason: 'user_cancel' | 'background_stale' | 'offline' = 'user_cancel') => {
      latestRequestIdRef.current += 1;
      abortReasonRef.current = reason;
      const controller = activeAbortControllerRef.current;
      activeAbortControllerRef.current = null;
      isRequestInFlightRef.current = false;
      requestStartedAtRef.current = 0;
      if (requestWatchdogRef.current !== null) {
        clearTimeout(requestWatchdogRef.current);
        requestWatchdogRef.current = null;
      }
      setCoachWaitSeconds(0);
      if (controller) {
        try {
          controller.abort();
        } catch {
          // Ignore AbortController cleanup failures
        }
      }
      if (isMountedRef.current) {
        setIsLoadingAI(false);
      }
    },
    []
  );

  const sendToGemini = async (
    promptText: string,
    intent: CoachQuickIntent,
    appendUserBubble = true
  ) => {
    const cleanPrompt = promptText.trim();
    if (!cleanPrompt || isRequestInFlightRef.current || isLoadingAI) return;

    isRequestInFlightRef.current = true;
    const requestId = ++latestRequestIdRef.current;
    abortReasonRef.current = 'none';
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeAbortControllerRef.current = controller;
    requestStartedAtRef.current = Date.now();
    setCoachWaitSeconds(0);
    lastSubmittedRequestRef.current = { message: cleanPrompt, intent };
    if (requestWatchdogRef.current !== null) clearTimeout(requestWatchdogRef.current);
    // Global wall-clock limit for token acquisition + HTTP + SDK retries.
    // A WebView can suspend fetch timers; always free the submit control.
    requestWatchdogRef.current = setTimeout(() => {
      if (requestId !== latestRequestIdRef.current || !isRequestInFlightRef.current) return;
      const lastReq = lastSubmittedRequestRef.current;
      cancelActiveRequest('background_stale');
      if (lastReq && isMountedRef.current) {
        setGeminiError({
          message: 'El Coach no respondió dentro de 27 segundos. Puede haber un problema de conexión, autenticación o disponibilidad de Gemini. Comprueba la conexión e inténtalo de nuevo.',
          code: 'coach/timeout',
          retryable: true,
          lastRequest: lastReq,
        });
      }
    }, COACH_MAX_WAIT_MS);

    setGeminiError(null);

    const priorTurns: CoachChatApiTurn[] = messages.slice(-8).map((m) => ({
      role: m.role,
      text: m.text,
    }));

    if (appendUserBubble) {
      setMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text: cleanPrompt,
        },
      ]);
    }

    setIsLoadingAI(true);
    try {
      const result = await askCoachAI({
        athleteId: activeProfile.id,
        message: cleanPrompt,
        intent,
        history: priorTurns,
        context: minimizedPayload,
        signal: controller?.signal,
        timeoutMs: 20_000,
        tokenTimeoutMs: 6_000,
        // Avoid 2 x 22s wait; give the athlete an explicit retry control.
        maxTransientRetries: 0,
      });

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) {
        return;
      }

      if (result.aborted) {
        return;
      }

      if (!result.ok || !result.reply) {
        setGeminiError({
          message:
            result.error ||
            'No se pudo obtener respuesta de Coach LazcaKong IA. Intenta de nuevo.',
          code: result.code,
          retryable: result.retryable !== false,
          lastRequest: { message: cleanPrompt, intent },
        });
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          text: result.reply!,
          model: result.model,
        },
      ]);
    } catch (err: any) {
      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) {
        return;
      }
      if (controller?.signal?.aborted) {
        return;
      }
      setGeminiError({
        message:
          err?.message ||
          'Ocurrió un error inesperado al consultar a Coach LazcaKong IA. Intenta de nuevo.',
        code: 'coach/unexpected-error',
        retryable: true,
        lastRequest: { message: cleanPrompt, intent },
      });
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
      if (requestId === latestRequestIdRef.current) {
        isRequestInFlightRef.current = false;
        requestStartedAtRef.current = 0;
        if (requestWatchdogRef.current !== null) {
          clearTimeout(requestWatchdogRef.current);
          requestWatchdogRef.current = null;
        }
        if (isMountedRef.current) {
          setIsLoadingAI(false);
          setCoachWaitSeconds(0);
        }
      }
    }
  };

  const stopSpeaking = useCallback(() => {
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if (isSpeechSynthesisAvailable()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser synthesis cancel errors
      }
    }
    setSpeakingMessageId(null);
  }, []);

  const mergeDictatedDraft = useCallback(
    (baseInput: string, finalSegment: string, interimSegment: string): string => {
      const captured = `${finalSegment} ${interimSegment}`.replace(/\s+/g, ' ').trim();
      const base = baseInput.trim();
      if (!captured) return baseInput;
      if (!base) return captured;
      return `${base} ${captured}`;
    },
    []
  );

  const commitDictationToInput = useCallback(() => {
    if (dictationCommittedRef.current || dictationCancelledRef.current) return;
    dictationCommittedRef.current = true;
    const nextValue = mergeDictatedDraft(
      dictationPreInputRef.current,
      dictationFinalRef.current,
      dictationInterimRef.current
    );
    setInputText(nextValue);
    setLiveTranscript('');
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
    }
  }, [mergeDictatedDraft]);

  const stopMicrophone = useCallback(
    (mode: 'finish' | 'cancel') => {
      const rec = recognitionRef.current;
      if (!rec && !isListeningRef.current) {
        return;
      }
      dictationCancelledRef.current = mode === 'cancel';

      if (rec) {
        try {
          if (mode === 'cancel') {
            rec.onresult = null;
            rec.onend = null;
            rec.onerror = null;
            rec.abort();
          } else {
            rec.stop();
          }
        } catch {
          // Ignore recognition stop errors
        }
        if (mode === 'cancel') {
          recognitionRef.current = null;
        }
      }

      isListeningRef.current = false;
      setIsListening(false);
      if (mode === 'cancel') {
        setLiveTranscript('');
        setInputText(dictationPreInputRef.current);
      } else {
        commitDictationToInput();
      }
    },
    [commitDictationToInput]
  );

  const stopAllVoiceActivity = useCallback(() => {
    stopMicrophone('cancel');
    stopSpeaking();
  }, [stopMicrophone, stopSpeaking]);

  const handleCloseModal = useCallback(() => {
    stopAllVoiceActivity();
    onClose();
  }, [onClose, stopAllVoiceActivity]);

  const speakMessageText = useCallback(
    (messageId: string, rawText: string) => {
      if (!isSpeechSynthesisAvailable()) {
        setVoiceNotice({
          tone: 'info',
          text: 'La lectura en voz alta no está disponible en este navegador.',
        });
        return;
      }

      if (speakingMessageId === messageId) {
        stopSpeaking();
        return;
      }

      stopSpeaking();
      const formatted = formatCoachTextForSpeech(rawText);
      if (!formatted) return;

      try {
        const synth = window.speechSynthesis;
        const voices = synth.getVoices() || [];
        const pickedVoice = pickSpanishChileVoice(voices);
        const utterance = new window.SpeechSynthesisUtterance(formatted);
        if (pickedVoice) {
          utterance.voice = pickedVoice;
          utterance.lang = pickedVoice.lang || 'es-CL';
        } else {
          utterance.lang = 'es-CL';
        }
        utterance.rate = 1;

        utterance.onend = () => {
          if (utteranceRef.current === utterance) {
            utteranceRef.current = null;
            setSpeakingMessageId(null);
          }
        };
        utterance.onerror = () => {
          if (utteranceRef.current === utterance) {
            utteranceRef.current = null;
            setSpeakingMessageId(null);
          }
        };

        utteranceRef.current = utterance;
        setSpeakingMessageId(messageId);
        synth.speak(utterance);
      } catch {
        setSpeakingMessageId(null);
        setVoiceNotice({
          tone: 'error',
          text: 'No se pudo reproducir el audio del coach en este dispositivo.',
        });
      }
    },
    [speakingMessageId, stopSpeaking]
  );

  const handleToggleAutoRead = useCallback(() => {
    if (!voiceCapabilities.ttsSupported) {
      setVoiceNotice({
        tone: 'info',
        text: 'Tu navegador no soporta lectura en voz alta para el coach.',
      });
      return;
    }

    setAutoReadEnabled((prev) => {
      const next = !prev;
      saveAutoReadCoachPreference(next);
      if (!next) {
        stopSpeaking();
      } else {
        // Mark existing messages as seen so only newly generated responses are auto-read once
        messages.forEach((m) => {
          if (m.role === 'assistant') {
            spokenMessageIdsRef.current.add(m.id);
          }
        });
      }
      return next;
    });
  }, [messages, stopSpeaking, voiceCapabilities.ttsSupported]);

  const handleStartDictation = useCallback(() => {
    // 1. Echo guard: always stop Coach TTS before turning on microphone
    stopSpeaking();
    setVoiceNotice(null);

    if (isListening) {
      stopMicrophone('finish');
      return;
    }

    const RecognitionCtor = getSpeechRecognitionConstructor();
    if (!RecognitionCtor) {
      setVoiceNotice({
        tone: 'info',
        text: 'El dictado por voz no está disponible en este navegador. Puedes escribir tu consulta normalmente.',
      });
      return;
    }

    try {
      const recognition = new RecognitionCtor();
      recognition.lang = 'es-CL';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      dictationCancelledRef.current = false;
      dictationCommittedRef.current = false;
      dictationFinalRef.current = '';
      dictationInterimRef.current = '';
      dictationPreInputRef.current = inputText;
      setLiveTranscript('');

      recognition.onstart = () => {
        isListeningRef.current = true;
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        if (!event?.results) return;
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const chunk = result?.[0]?.transcript || '';
          if (result.isFinal) {
            finalText += `${chunk} `;
          } else {
            interimText += `${chunk} `;
          }
        }
        dictationFinalRef.current = finalText.trim();
        dictationInterimRef.current = interimText.trim();
        setLiveTranscript(`${finalText} ${interimText}`.replace(/\s+/g, ' ').trim());
      };

      recognition.onerror = (event: any) => {
        const errorCode = String(event?.error || 'unknown');
        const mapped = mapSpeechRecognitionErrorToSpanish(errorCode);
        if (mapped) {
          setVoiceNotice({ tone: 'error', text: mapped });
        }
        recognitionRef.current = null;
        isListeningRef.current = false;
        setIsListening(false);
        if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed' || errorCode === 'audio-capture') {
          dictationCancelledRef.current = true;
          setLiveTranscript('');
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        isListeningRef.current = false;
        setIsListening(false);
        if (!dictationCancelledRef.current) {
          commitDictationToInput();
        }
      };

      recognitionRef.current = recognition;
      isListeningRef.current = true;
      setIsListening(true);
      recognition.start();
    } catch {
      recognitionRef.current = null;
      isListeningRef.current = false;
      setIsListening(false);
      setVoiceNotice({
        tone: 'error',
        text: 'No fue posible iniciar el micrófono. Verifica los permisos del navegador.',
      });
    }
  }, [commitDictationToInput, inputText, isListening, stopMicrophone, stopSpeaking]);

  // Refresh voice capabilities cleanly on mount and when voices populate asynchronously
  useEffect(() => {
    setVoiceCapabilities(detectCoachVoiceCapabilities());
    if (!isSpeechSynthesisAvailable()) return;

    const handleVoicesChanged = () => {
      setVoiceCapabilities(detectCoachVoiceCapabilities());
    };
    try {
      window.speechSynthesis.addEventListener?.('voiceschanged', handleVoicesChanged);
    } catch {
      // Ignore environments without addEventListener on speechSynthesis
    }
    return () => {
      try {
        window.speechSynthesis.removeEventListener?.('voiceschanged', handleVoicesChanged);
      } catch {
        // Ignore cleanup failures
      }
    };
  }, []);

  // Reset conversation & cancel active request if active athlete profile switches
  useEffect(() => {
    if (prevProfileIdRef.current !== activeProfile.id) {
      prevProfileIdRef.current = activeProfile.id;
      cancelActiveRequest('user_cancel');
      setMessages([]);
      setGeminiError(null);
      setInputText('');
      lastAutoTriggeredKeyRef.current = null;
    }
  }, [activeProfile.id, cancelActiveRequest]);

  // An explicit readiness check prevents a blank Coach experience when the
  // deployed backend has no Gemini credential, the route is missing, or the
  // Firebase account does not own the selected athlete.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsCheckingService(true);
    setServiceDiagnostic(null);
    void checkCoachServiceStatus(activeProfile.id).then((status) => {
      if (!cancelled) setServiceDiagnostic(status);
    }).catch(() => {
      if (!cancelled) setServiceDiagnostic({
        status: 'server_unavailable',
        message: 'No fue posible comprobar el servidor de Coach IA.',
        readyForLiveRequest: false,
      });
    }).finally(() => {
      if (!cancelled) setIsCheckingService(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, activeProfile.id]);

  // A visible, finite counter means the athlete can see the timeout approaching.
  // The independent watchdog above owns cancellation when the network stalls.
  useEffect(() => {
    if (!isOpen || !isLoadingAI) return;
    const update = () => {
      if (!requestStartedAtRef.current) return;
      setCoachWaitSeconds(Math.min(27, Math.floor(
        (Date.now() - requestStartedAtRef.current) / 1000
      )));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isOpen, isLoadingAI]);

  // Stop voice, cancel stalled requests when modal closes, and guard Android screen-lock / offline hangs
  useEffect(() => {
    if (!isOpen) {
      stopAllVoiceActivity();
      cancelActiveRequest('user_cancel');
      return;
    }

    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopAllVoiceActivity();
        return;
      }
      // On Android Doze/screen lock, JS timers pause while socket may hang; recover cleanly on resume
      if (
        document.visibilityState === 'visible' &&
        isRequestInFlightRef.current &&
        requestStartedAtRef.current > 0 &&
        Date.now() - requestStartedAtRef.current > 24_000
      ) {
        const lastReq = lastSubmittedRequestRef.current;
        cancelActiveRequest('background_stale');
        if (lastReq && isMountedRef.current) {
          setGeminiError({
            message:
              'La consulta se interrumpió mientras la app estaba en segundo plano o con pantalla bloqueada. Toca Reintentar.',
            code: 'coach/timeout',
            retryable: true,
            lastRequest: lastReq,
          });
        }
      }
    };

    const handleOffline = () => {
      if (!isRequestInFlightRef.current) return;
      const lastReq = lastSubmittedRequestRef.current;
      cancelActiveRequest('offline');
      if (lastReq && isMountedRef.current) {
        setGeminiError({
          message:
            'Se perdió la conexión a internet durante la consulta. Verifica tu Wi-Fi o datos móviles e intenta de nuevo.',
          code: 'coach/network-error',
          retryable: true,
          lastRequest: lastReq,
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('offline', handleOffline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('offline', handleOffline);
    };
  }, [cancelActiveRequest, isOpen, stopAllVoiceActivity]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopAllVoiceActivity();
      cancelActiveRequest('user_cancel');
    };
  }, [cancelActiveRequest, stopAllVoiceActivity]);

  // Auto-read each newly generated Coach response once only when toggle is ON
  useEffect(() => {
    if (!isOpen || !autoReadEnabled) return;
    const nextMessage = selectNextAutoSpeechMessage(
      messages,
      spokenMessageIdsRef.current,
      autoReadEnabled
    );
    if (!nextMessage) return;

    spokenMessageIdsRef.current.add(nextMessage.id);
    if (!isListening) {
      speakMessageText(nextMessage.id, nextMessage.text);
    }
  }, [autoReadEnabled, isListening, isOpen, messages, speakMessageText]);

  useEffect(() => {
    if (!isOpen) {
      lastAutoTriggeredKeyRef.current = null;
      return;
    }

    const intentToRun = initialIntent || 'today_workout';
    setActiveIntent(intentToRun);
    setPendingPreview(null);
    setPendingLoadPreview(null);
    setAppliedBanner(null);

    const triggerKey = `${activeProfile.id}:${intentToRun}`;
    if (lastAutoTriggeredKeyRef.current !== triggerKey && messages.length === 0) {
      lastAutoTriggeredKeyRef.current = triggerKey;
      const preset = QUICK_PROMPTS.find((q) => q.intent === intentToRun);
      if (preset) {
        void sendToGemini(
          preset.promptBuilder(selectedExercise?.name),
          intentToRun,
          true
        );
      }
    }
  }, [isOpen, initialIntent, activeProfile.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, geminiError, isLoadingAI, pendingLoadPreview, pendingPreview]);

  if (!isOpen) return null;

  const handleQuickPromptClick = (
    intent: Exclude<CoachQuickIntent, 'freeform'>
  ) => {
    setActiveIntent(intent);
    setPendingPreview(null);
    setPendingLoadPreview(null);
    setAppliedBanner(null);
    const preset = QUICK_PROMPTS.find((q) => q.intent === intent);
    if (preset) {
      void sendToGemini(preset.promptBuilder(selectedExercise?.name), intent, true);
    }
  };

  const handleOpenPreview = (alt: CoachAlternativeOption) => {
    if (!selectedExercise) return;
    const defaultScope: CoachReplacementScope = activeSession ? 'session' : 'routine';
    const preview = createReplacementPreview({
      exercise: selectedExercise,
      replacement: alt,
      scope: defaultScope,
      activeSession,
      selectedRoutine: resolution.selectedRoutine,
    });
    setPendingLoadPreview(null);
    setPendingPreview(preview);
    setAppliedBanner(null);
  };

  const handleConfirmReplacement = () => {
    if (!pendingPreview) return;
    onApplyReplacement(pendingPreview);
    setAppliedBanner(
      pendingPreview.scope === 'session'
        ? `Cambio aplicado solo a esta sesión: ${pendingPreview.originalExerciseName} → ${pendingPreview.replacement.name}.`
        : `Cambio guardado en la rutina: ${pendingPreview.originalExerciseName} → ${pendingPreview.replacement.name}.`
    );
    setPendingPreview(null);
  };

  const handleCancelReplacement = () => {
    setPendingPreview(null);
  };

  const handleConfirmLoadChange = () => {
    if (!pendingLoadPreview) return;
    if (onApplyLoadChange) {
      onApplyLoadChange(pendingLoadPreview);
    }
    setAppliedBanner(
      pendingLoadPreview.scope === 'session'
        ? `Carga ajustada solo para esta sesión en ${pendingLoadPreview.originalExerciseName}: ${pendingLoadPreview.proposedWeightKg} ${pendingLoadPreview.weightUnit}.`
        : `Carga guardada en la rutina para ${pendingLoadPreview.originalExerciseName}: ${pendingLoadPreview.proposedWeightKg} ${pendingLoadPreview.weightUnit}.`
    );
    setPendingLoadPreview(null);
  };

  const handleCancelLoadChange = () => {
    setPendingLoadPreview(null);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoadingAI) return;
    const msg = inputText.trim();
    setInputText('');
    setAppliedBanner(null);

    const detectedAction = parseCoachVoiceActionRequest({
      text: msg,
      exercises: resolution.exercises,
      selectedExercise,
      activeSession,
      selectedRoutine: resolution.selectedRoutine,
      defaultUnit: activeProfile.weightUnit || 'kg',
    });

    if (detectedAction.type === 'change_load') {
      setSelectedExerciseId(detectedAction.matchedExerciseId);
      setPendingPreview(null);
      setPendingLoadPreview(detectedAction.preview);
      void sendToGemini(msg, 'last_weight', true);
      return;
    }

    if (detectedAction.type === 'replace_exercise') {
      setActiveIntent('replace_exercise');
      setPendingLoadPreview(null);
      if (detectedAction.matchedExerciseId) {
        setSelectedExerciseId(detectedAction.matchedExerciseId);
      }
      if (detectedAction.equipmentHint) {
        setEquipFilter(detectedAction.equipmentHint);
      }
      if (detectedAction.suggestedReplacement) {
        const matchedEx =
          resolution.exercises.find((ex) => ex.id === detectedAction.matchedExerciseId) ||
          selectedExercise;
        if (matchedEx) {
          const preview = createReplacementPreview({
            exercise: matchedEx,
            replacement: detectedAction.suggestedReplacement,
            scope: activeSession ? 'session' : 'routine',
            activeSession,
            selectedRoutine: resolution.selectedRoutine,
          });
          setPendingPreview(preview);
        }
      }
      void sendToGemini(msg, 'replace_exercise', true);
      return;
    }

    void sendToGemini(msg, activeIntent || 'freeform', true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md p-0 sm:p-4 font-['Plus_Jakarta_Sans',sans-serif]"
      onClick={handleCloseModal}
      role="dialog"
      aria-modal="true"
      aria-label="Coach LazcaKong IA"
    >
      <div
        className="w-full max-w-lg bg-[#090909] border border-[#303030] rounded-t-3xl sm:rounded-3xl shadow-2xl text-[#F5F5F5] flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-4 py-3.5 bg-[#121212] border-b border-[#303030] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-accent/15 border border-accent/70 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 text-accent-text" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black italic uppercase tracking-tight text-[#F5F5F5] truncate">
                  Coach <span className="text-accent-text">LazcaKong IA</span>
                </h2>
              </div>
              <p className="text-[11px] text-zinc-400 truncate">
                {activeProfile.name} · {historyCount > 0 ? `${historyCount} sesiones en historial` : 'Sin historial previo'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCloseModal}
            aria-label="Cerrar panel del coach"
            className="w-10 h-10 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-300 hover:text-[#F5F5F5] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Disclaimer + Sync notice */}
        <div className="px-4 py-2 bg-[#141414] border-b border-[#303030]/80 flex items-start gap-2 text-[11px] text-zinc-400 shrink-0">
          <ShieldAlert className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
          <span>
            Orientación de entrenamiento basada en tus registros reales. No diagnostica lesiones ni reemplaza evaluación médica.
            {(isHistorySyncing || historySyncError) && (
              <strong className="block text-amber-300 mt-0.5">
                {historySyncError
                  ? 'Sincronización remota pendiente/con error: usando respaldo local verificado.'
                  : 'Sincronizando historial con la nube...'}
              </strong>
            )}
          </span>
        </div>

        {/* Voice Controls Bar (Persistent Auto-TTS toggle + Stop button) */}
        <div
          data-testid="coach-voice-controls-bar"
          className="px-4 py-2 bg-[#101010] border-b border-[#303030]/80 flex items-center justify-between gap-2 shrink-0"
        >
          <button
            type="button"
            role="switch"
            aria-checked={autoReadEnabled}
            data-testid="coach-auto-tts-toggle"
            onClick={handleToggleAutoRead}
            className="flex items-center gap-2.5 text-left min-h-[36px] cursor-pointer group"
          >
            <span
              className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                autoReadEnabled ? 'bg-accent' : 'bg-[#2a2a2a] border border-[#3f3f3f]'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full transition-transform ${
                  autoReadEnabled
                    ? 'translate-x-4 bg-accent-contrast'
                    : 'translate-x-0 bg-zinc-400'
                }`}
              />
            </span>
            <span className="text-[11px] font-bold text-zinc-200 group-hover:text-[#F5F5F5] flex items-center gap-1.5">
              {autoReadEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-accent-text" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-zinc-400" />
              )}
              <span>Leer respuestas en voz alta</span>
            </span>
          </button>

          {speakingMessageId && (
            <button
              type="button"
              data-testid="coach-stop-tts-global"
              onClick={stopSpeaking}
              className="px-2.5 py-1 rounded-lg bg-accent/15 border border-accent/70 text-[11px] font-black text-accent-text inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              Detener
            </button>
          )}
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3.5">
          {/* Quick Prompt Pills */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Accesos rápidos del coach">
            {QUICK_PROMPTS.map((qp) => {
              const isSelected = activeIntent === qp.intent;
              return (
                <button
                  key={qp.intent}
                  type="button"
                  disabled={isLoadingAI}
                  onClick={() => handleQuickPromptClick(qp.intent)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'bg-accent text-accent-contrast font-black shadow-[0_0_12px_var(--accent-glow)]'
                      : 'bg-[#171717] text-[#F5F5F5] border border-[#303030] hover:border-accent/60'
                  }`}
                >
                  {qp.label}
                </button>
              );
            })}
          </div>

          {/* Day / Routine & Exercise Context Selectors */}
          {resolution.hasRoutines && (
            <div className="p-3 rounded-2xl bg-[#171717] border border-[#303030] space-y-2.5">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="coach-routine-day-select"
                    className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1"
                  >
                    {resolution.requiresDaySelection
                      ? 'Elige un día de tu rutina'
                      : 'Día / Rutina consultada'}
                  </label>
                  <select
                    id="coach-routine-day-select"
                    value={resolution.selectedRoutine?.id || ''}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedRoutineId(nextId || null);
                      setSelectedExerciseId(null);
                      setPendingPreview(null);
                    }}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#090909] border border-[#303030] text-xs font-bold text-[#F5F5F5] focus:outline-none focus:border-accent"
                  >
                    {!resolution.selectedRoutine && (
                      <option value="">Selecciona un día de rutina...</option>
                    )}
                    {resolution.selectableRoutines.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.dayName ? `${r.dayName}: ` : ''}
                        {r.title}
                      </option>
                    ))}
                  </select>
                </div>

                {resolution.exercises.length > 0 && (
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor="coach-exercise-select"
                      className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1"
                    >
                      Ejercicio de referencia
                    </label>
                    <select
                      id="coach-exercise-select"
                      value={selectedExercise?.id || ''}
                      onChange={(e) => {
                        setSelectedExerciseId(e.target.value || null);
                        setPendingPreview(null);
                      }}
                      className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#090909] border border-[#303030] text-xs font-bold text-[#F5F5F5] focus:outline-none focus:border-accent"
                    >
                      {resolution.exercises.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Deterministic Structured Card (Always grounded in Athlete Data) */}
          {activeIntent === 'today_workout' && (
            <section
              data-testid="coach-today-workout-card"
              className="p-3.5 rounded-2xl bg-[#171717] border border-accent/45 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-accent-text">
                  <Calendar className="w-3.5 h-3.5" />
                  Entrenamiento programado · {resolution.todayDayName}
                </span>
                {historyCount === 0 && resolution.selectedRoutine && (
                  <span className="px-2 py-0.5 rounded bg-[#090909] border border-[#303030] text-[10px] font-bold text-zinc-300">
                    Sin historial previo
                  </span>
                )}
              </div>

              {!resolution.hasRoutines ? (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-300">
                    Aún no tienes una rutina asignada o creada en tu perfil.
                  </p>
                  {onNavigateRoutines && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onNavigateRoutines();
                      }}
                      className="px-3 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase tracking-wide inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      Ir a Rutinas <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : resolution.requiresDaySelection ? (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-300">
                    Tu rutina no asigna días específicos de la semana. Elige uno de tus días para ver qué toca hoy:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {resolution.selectableRoutines.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setSelectedRoutineId(r.id);
                          setSelectedExerciseId(null);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-[#090909] hover:border-accent border border-[#303030] text-xs font-bold text-[#F5F5F5] cursor-pointer"
                      >
                        {r.dayName ? `${r.dayName} · ` : ''}
                        {r.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : resolution.selectedRoutine ? (
                <div className="space-y-2">
                  {resolution.isRestDayFallback && (
                    <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-xl px-2.5 py-1.5">
                      Hoy ({resolution.todayDayName}) no tienes un día asignado en tu calendario. Mostrando {resolution.selectedRoutine.dayName || resolution.selectedRoutine.title} (puedes elegir otro día arriba).
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black text-[#F5F5F5]">
                        {resolution.selectedRoutine.title}
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        {resolution.selectedRoutine.dayName || resolution.todayDayName} ·{' '}
                        {resolution.exercises.length} ejercicios
                      </p>
                    </div>
                    {!activeSession && onStartWorkout && (
                      <button
                        type="button"
                        onClick={() => {
                          onStartWorkout(resolution.selectedRoutine!);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase tracking-wide cursor-pointer shrink-0"
                      >
                        Iniciar
                      </button>
                    )}
                  </div>

                  <ul className="space-y-1.5">
                    {resolution.exercises.map((ex, idx) => (
                      <li
                        key={ex.id}
                        className="px-2.5 py-2 rounded-xl bg-[#090909] border border-[#303030]/90 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-[#F5F5F5] block truncate">
                            {idx + 1}. {ex.name}
                          </span>
                          <span className="text-[10px] text-zinc-400 block truncate">
                            {ex.targetMuscles || 'General'}
                            {ex.equipment ? ` · ${ex.equipment}` : ''}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono font-bold text-accent-text shrink-0">
                          {ex.defaultSets} × {ex.repRange}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          )}

          {activeIntent === 'last_weight' && (
            <section
              data-testid="coach-last-weight-card"
              className="p-3.5 rounded-2xl bg-[#171717] border border-accent/45 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-accent-text">
                  <Scale className="w-3.5 h-3.5" />
                  Historial de carga real
                </span>
                {selectedExercise && (
                  <span className="text-[11px] font-bold text-zinc-300 truncate max-w-[190px]">
                    {selectedExercise.name}
                  </span>
                )}
              </div>

              {!loadReport ? (
                <p className="text-xs text-zinc-400">
                  Selecciona una rutina o ejercicio para consultar tus registros previos.
                </p>
              ) : !loadReport.hasRegisteredSets ? (
                <div
                  data-testid="coach-no-sets-message"
                  className="p-3 rounded-xl bg-[#090909] border border-[#303030] text-xs text-zinc-200 font-semibold"
                >
                  Aún no tienes series registradas para este ejercicio
                </div>
              ) : (
                <div className="space-y-2.5">
                  {/* Lifted Data Block */}
                  <div className="p-3 rounded-xl bg-[#090909] border border-[#303030] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-accent-text">
                        Lo que levantaste (Última sesión)
                      </span>
                      <span
                        data-testid="coach-last-session-date"
                        className="text-[11px] font-mono text-zinc-300"
                      >
                        {loadReport.lastSessionDate}
                      </span>
                    </div>

                    {loadReport.hasPerSetDetail && loadReport.liftedSets.length > 0 ? (
                      <div className="grid grid-cols-1 gap-1">
                        {loadReport.liftedSets.map((s) => (
                          <div
                            key={s.setNumber}
                            className="flex items-center justify-between text-xs px-2 py-1 rounded-lg bg-[#141414]"
                          >
                            <span className="text-zinc-400 font-mono">
                              Serie {s.setNumber}
                            </span>
                            <span className="font-black font-mono text-[#F5F5F5]">
                              {s.weight} kg × {s.reps} reps
                              {typeof s.rpe === 'number'
                                ? ` · @${s.rpe}`
                                : typeof s.rir === 'number'
                                ? ` · ${s.rir} RIR`
                                : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-300">
                        {loadReport.liftedFallbackSummary}
                      </p>
                    )}
                  </div>

                  {/* Suggestion Block (Explicitly Separated) */}
                  <div className="p-3 rounded-xl bg-accent/10 border border-accent/45 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-accent-text">
                        <Sparkles className="w-3 h-3" />
                        Sugerencia para hoy (Estimación)
                      </span>
                      <span className="px-2 py-0.5 rounded bg-accent text-accent-contrast text-[10px] font-black uppercase">
                        {loadReport.progression.badgeText}
                      </span>
                    </div>
                    {typeof loadReport.progression.suggestedWeightKg === 'number' && (
                      <p className="text-xs font-black text-[#F5F5F5]">
                        Carga sugerida: {loadReport.progression.suggestedWeightKg} kg
                        {loadReport.progression.suggestedRepsPattern
                          ? ` · objetivo ${loadReport.progression.suggestedRepsPattern} reps`
                          : ''}
                      </p>
                    )}
                    <p className="text-[11px] text-zinc-300 leading-snug">
                      {loadReport.progression.detailReason}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeIntent === 'replace_exercise' && (
            <section
              data-testid="coach-alternatives-card"
              className="p-3.5 rounded-2xl bg-[#171717] border border-accent/45 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-accent-text">
                  <Repeat className="w-3.5 h-3.5" />
                  Alternativas compatibles
                </span>
                {selectedExercise && (
                  <span className="text-[11px] font-bold text-zinc-300 truncate max-w-[185px]">
                    Para: {selectedExercise.name}
                  </span>
                )}
              </div>

              {/* Equipment Filter Chips + Search */}
              <div className="space-y-2">
                <div className="flex overflow-x-auto gap-1.5 pb-1 hide-scrollbar">
                  {COACH_EQUIPMENT_FILTERS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setEquipFilter(opt)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap cursor-pointer shrink-0 ${
                        equipFilter === opt
                          ? 'bg-accent text-accent-contrast font-black'
                          : 'bg-[#090909] text-zinc-300 border border-[#303030]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={altSearchQuery}
                  onChange={(e) => setAltSearchQuery(e.target.value)}
                  placeholder="Filtrar por nombre o equipo..."
                  className="w-full px-3 py-2 rounded-xl bg-[#090909] border border-[#303030] text-xs text-[#F5F5F5] placeholder:text-zinc-500 focus:outline-none focus:border-accent"
                />
              </div>

              {/* Applied Confirmation Banner */}
              {appliedBanner && (
                <div
                  data-testid="coach-replacement-applied-banner"
                  className="p-2.5 rounded-xl bg-accent/15 border border-accent flex items-center gap-2 text-xs font-bold text-accent-text"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{appliedBanner}</span>
                </div>
              )}

              {/* Confirmation Preview Box */}
              {pendingPreview ? (
                <div
                  data-testid="coach-replacement-preview"
                  className="p-3.5 rounded-2xl bg-[#090909] border-2 border-accent space-y-3"
                >
                  <div className="text-[11px] font-black uppercase tracking-wider text-accent-text">
                    Confirmar sustitución de ejercicio
                  </div>

                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                    <div className="flex-1 min-w-0">
                      <span className="block text-[10px] uppercase text-zinc-400 font-bold">
                        Original
                      </span>
                      <span className="text-xs font-bold text-[#F5F5F5] block truncate">
                        {pendingPreview.originalExerciseName}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {pendingPreview.originalEquipment || 'Sin equipo especificado'}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-accent-text shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="block text-[10px] uppercase text-accent-text font-bold">
                        Reemplazo
                      </span>
                      <span className="text-xs font-black text-[#F5F5F5] block truncate">
                        {pendingPreview.replacement.name}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {pendingPreview.replacement.equipment}
                      </span>
                    </div>
                  </div>

                  {/* Scope Selector */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      ¿Dónde aplicar este cambio?
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!pendingPreview.canApplyToSession}
                        onClick={() =>
                          setPendingPreview((prev) =>
                            prev ? { ...prev, scope: 'session' } : prev
                          )
                        }
                        className={`p-2 rounded-xl border text-left text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          pendingPreview.scope === 'session'
                            ? 'bg-accent/15 border-accent text-accent-text'
                            : 'bg-[#171717] border-[#303030] text-zinc-300'
                        }`}
                      >
                        <span className="block">Solo esta sesión</span>
                        <span className="block text-[10px] font-normal text-zinc-400 mt-0.5">
                          {pendingPreview.canApplyToSession
                            ? 'Mantiene tu rutina intacta'
                            : 'Requiere entrenamiento activo'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={!pendingPreview.canSaveToRoutine}
                        onClick={() =>
                          setPendingPreview((prev) =>
                            prev ? { ...prev, scope: 'routine' } : prev
                          )
                        }
                        className={`p-2 rounded-xl border text-left text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          pendingPreview.scope === 'routine'
                            ? 'bg-accent/15 border-accent text-accent-text'
                            : 'bg-[#171717] border-[#303030] text-zinc-300'
                        }`}
                      >
                        <span className="block">Guardar en la rutina</span>
                        <span className="block text-[10px] font-normal text-zinc-400 mt-0.5">
                          Actualiza esta rutina
                        </span>
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Las series ya completadas ({pendingPreview.completedSetsCount}) no se modifican y no se copian pesos desde {pendingPreview.originalExerciseName}.
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCancelReplacement}
                      className="flex-1 min-h-[42px] px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#242424] border border-[#303030] text-xs font-bold text-zinc-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmReplacement}
                      style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-contrast-text)' }}
                      className="flex-1 min-h-[42px] px-3 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase tracking-wide cursor-pointer"
                    >
                      Confirmar cambio
                    </button>
                  </div>
                </div>
              ) : filteredAlternativesResult.alternatives.length === 0 ? (
                <p className="text-xs text-zinc-400">
                  No encontramos alternativas con ese filtro. Prueba seleccionar "Todos" en equipo.
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredAlternativesResult.alternatives.map((alt) => {
                    const thumb =
                      !thumbErrors[alt.libraryExerciseId] && alt.thumbnailUrl
                        ? alt.thumbnailUrl
                        : null;
                    return (
                      <div
                        key={alt.libraryExerciseId}
                        className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] flex items-center gap-2.5"
                      >
                        <div className="w-14 h-14 rounded-xl bg-[#171717] border border-[#303030] overflow-hidden flex items-center justify-center shrink-0">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={alt.name}
                              onError={() =>
                                setThumbErrors((prev) => ({
                                  ...prev,
                                  [alt.libraryExerciseId]: true,
                                }))
                              }
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Dumbbell className="w-5 h-5 text-accent-text" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-black text-[#F5F5F5] truncate">
                              {alt.name}
                            </span>
                            {alt.isProgrammedMatch && (
                              <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent-text text-[9px] font-black uppercase">
                                Programada
                              </span>
                            )}
                          </div>
                          <span className="block text-[10px] font-mono text-accent-text/90 mt-0.5">
                            {alt.equipment} · {alt.muscleGroup}
                          </span>
                          <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5 leading-snug">
                            {alt.rationale}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenPreview(alt)}
                          className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-[#171717] hover:bg-accent hover:text-accent-contrast border border-accent/60 text-[11px] font-black text-accent-text transition-colors shrink-0 cursor-pointer"
                        >
                          Usar
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Applied Banner (visible across all intents after confirming load or replacement) */}
          {appliedBanner && activeIntent !== 'replace_exercise' && (
            <div
              data-testid="coach-action-applied-banner"
              className="p-2.5 rounded-xl bg-accent/15 border border-accent flex items-center gap-2 text-xs font-bold text-accent-text"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{appliedBanner}</span>
            </div>
          )}

          {/* Explicit Load Change Preview Box (never mutates workout/routine until confirmed) */}
          {pendingLoadPreview && (
            <section
              data-testid="coach-load-preview"
              className="p-3.5 rounded-2xl bg-[#090909] border-2 border-accent space-y-3"
            >
              <div className="text-[11px] font-black uppercase tracking-wider text-accent-text">
                Confirmar cambio de carga
              </div>

              <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                <div className="flex-1 min-w-0">
                  <span className="block text-[10px] uppercase text-zinc-400 font-bold">
                    Ejercicio
                  </span>
                  <span className="text-xs font-bold text-[#F5F5F5] block truncate">
                    {pendingLoadPreview.originalExerciseName}
                  </span>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    Actual:{' '}
                    {typeof pendingLoadPreview.currentWeightKg === 'number'
                      ? `${pendingLoadPreview.currentWeightKg} ${pendingLoadPreview.weightUnit}`
                      : 'Sin carga previa'}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-accent-text shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <span className="block text-[10px] uppercase text-accent-text font-bold">
                    Nueva carga
                  </span>
                  <span className="text-sm font-black font-mono text-accent-text block">
                    {pendingLoadPreview.proposedWeightKg} {pendingLoadPreview.weightUnit}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  ¿Dónde aplicar este cambio?
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!pendingLoadPreview.canApplyToSession}
                    onClick={() =>
                      setPendingLoadPreview((prev) =>
                        prev ? { ...prev, scope: 'session' } : prev
                      )
                    }
                    className={`p-2 rounded-xl border text-left text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      pendingLoadPreview.scope === 'session'
                        ? 'bg-accent/15 border-accent text-accent-text'
                        : 'bg-[#171717] border-[#303030] text-zinc-300'
                    }`}
                  >
                    <span className="block">Solo esta sesión</span>
                    <span className="block text-[10px] font-normal text-zinc-400 mt-0.5">
                      {pendingLoadPreview.canApplyToSession
                        ? `${pendingLoadPreview.pendingSetsCount} series pendientes`
                        : 'Requiere entrenamiento activo'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={!pendingLoadPreview.canSaveToRoutine}
                    onClick={() =>
                      setPendingLoadPreview((prev) =>
                        prev ? { ...prev, scope: 'routine' } : prev
                      )
                    }
                    className={`p-2 rounded-xl border text-left text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      pendingLoadPreview.scope === 'routine'
                        ? 'bg-accent/15 border-accent text-accent-text'
                        : 'bg-[#171717] border-[#303030] text-zinc-300'
                    }`}
                  >
                    <span className="block">Guardar en la rutina</span>
                    <span className="block text-[10px] font-normal text-zinc-400 mt-0.5">
                      Actualiza esta rutina
                    </span>
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-zinc-400 leading-snug">
                Las series ya completadas ({pendingLoadPreview.completedSetsCount}) no se modifican.
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelLoadChange}
                  className="flex-1 min-h-[42px] px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#242424] border border-[#303030] text-xs font-bold text-zinc-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLoadChange}
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-contrast-text)' }}
                  className="flex-1 min-h-[42px] px-3 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase tracking-wide cursor-pointer"
                >
                  Confirmar cambio
                </button>
              </div>
            </section>
          )}

          {/* AI Conversation Thread */}
          <div className="space-y-2.5 pt-1">
            <div
              data-testid="coach-service-diagnostic"
              className={`p-3 rounded-2xl border text-xs space-y-1.5 ${serviceDiagnostic?.status === 'ready'
                ? 'bg-[#131b10] border-[#ccff00]/35 text-lime-100'
                : 'bg-[#171717] border-[#303030] text-zinc-200'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">
                  {isCheckingService ? 'Comprobando Coach IA…' :
                    serviceDiagnostic?.status === 'ready' ? 'Coach IA · servidor configurado' :
                    'Coach IA · revisar conexión'}
                </span>
                <button type="button" onClick={() => {
                  setIsCheckingService(true);
                  void checkCoachServiceStatus(activeProfile.id).then(setServiceDiagnostic).catch(() => {
                    setServiceDiagnostic({
                      status: 'server_unavailable',
                      message: 'No fue posible comprobar el servidor de Coach IA.',
                      readyForLiveRequest: false,
                    });
                  }).finally(() => setIsCheckingService(false));
                }} disabled={isCheckingService}
                  className="px-2.5 py-1.5 rounded-lg bg-[#222] border border-[#444] text-[11px] font-bold disabled:opacity-50"
                >
                  {isCheckingService ? 'Revisando…' : 'Comprobar conexión'}
                </button>
              </div>
              {serviceDiagnostic && (
                <p data-testid="coach-service-status-message" className="text-[11px] leading-relaxed">
                  {serviceDiagnostic.message}
                </p>
              )}
            </div>
            {messages.map((m) => {
              const isPlayingThis = speakingMessageId === m.id;
              return (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-accent text-accent-contrast font-bold rounded-br-sm'
                        : 'bg-[#171717] border border-[#303030] text-[#F5F5F5] rounded-bl-sm'
                    }`}
                  >
                    <div>{m.text}</div>
                    {m.role === 'assistant' && (
                      <div className="mt-2 pt-1.5 border-t border-[#303030]/80 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          data-testid={`coach-listen-btn-${m.id}`}
                          onClick={() => speakMessageText(m.id, m.text)}
                          aria-label={isPlayingThis ? 'Detener lectura' : 'Escuchar respuesta'}
                          className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                            isPlayingThis
                              ? 'bg-accent text-accent-contrast font-black'
                              : 'bg-[#090909] border border-[#303030] text-zinc-200 hover:border-accent/70 hover:text-accent-text'
                          }`}
                        >
                          {isPlayingThis ? (
                            <>
                              <Square className="w-3 h-3 fill-current" />
                              <span>Detener</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5 text-accent-text" />
                              <span>Escuchar</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isLoadingAI && (
              <div data-testid="coach-pending-request" className="flex justify-start">
                <div className="w-full px-3.5 py-3 rounded-2xl bg-[#171717] border border-[#303030] text-xs text-zinc-300 space-y-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-accent-text animate-spin shrink-0" />
                    <span>Consultando Coach IA… {coachWaitSeconds} s / 27 s máximo</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden bg-[#303030]">
                    <div className="h-full bg-accent transition-[width] duration-300"
                      style={{ width: `${Math.min(100, coachWaitSeconds / 27 * 100)}%` }} />
                  </div>
                  <button type="button" data-testid="coach-cancel-pending"
                    onClick={() => {
                      const lastReq = lastSubmittedRequestRef.current;
                      cancelActiveRequest('user_cancel');
                      if (lastReq) {
                        setGeminiError({
                          message: 'Consulta cancelada. Puedes volver a intentarlo sin perder tus registros.',
                          code: 'coach/user-cancelled',
                          retryable: true,
                          lastRequest: lastReq,
                        });
                      }
                    }}
                    className="min-h-[36px] px-3 py-1.5 bg-[#272727] border border-[#555] rounded-lg text-zinc-100 font-bold">
                    Cancelar consulta
                  </button>
                </div>
              </div>
            )}

            {/* Explicit Gemini Error Banner with Retry (never masked) */}
            {geminiError && !isLoadingAI && (
              <div
                data-testid="coach-gemini-error-box"
                className="p-3 rounded-2xl bg-red-950/50 border border-red-500/60 space-y-2"
              >
                <div className="flex items-start gap-2 text-xs text-red-200">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="font-black block text-red-300">
                      {geminiError.code === 'coach/session-expired' ||
                      geminiError.code === 'coach/no-firebase-session'
                        ? 'Sesión requerida para Coach IA'
                        : geminiError.code === 'coach/network-error'
                        ? 'Sin conexión con Coach IA'
                        : geminiError.code === 'coach/timeout' ||
                          geminiError.code === 'coach/token-timeout'
                        ? 'Tiempo de espera agotado'
                        : 'Error al consultar a Gemini'}
                    </span>
                    <p className="mt-0.5 leading-snug">{geminiError.message}</p>
                    <p className="text-[11px] text-zinc-300 mt-1">
                      Tus datos reales de rutina, última sesión y alternativas siguen disponibles arriba.
                    </p>
                  </div>
                </div>
                {geminiError.retryable !== false && (
                  <button
                    type="button"
                    data-testid="coach-retry-button"
                    onClick={() =>
                      void sendToGemini(
                        geminiError.lastRequest.message,
                        geminiError.lastRequest.intent,
                        false
                      )
                    }
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-400/60 text-xs font-black text-red-100 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reintentar
                  </button>
                )}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Voice Listening / Capability Status Strip */}
        {(isListening || voiceNotice) && (
          <div className="px-3.5 py-2 bg-[#141414] border-t border-[#303030] shrink-0 space-y-2">
            {isListening && (
              <div
                data-testid="coach-listening-banner"
                className="p-2.5 rounded-2xl bg-accent/10 border border-accent/70 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse shrink-0" />
                    <span className="text-xs font-black text-accent-text">
                      Escuchando… (es-CL)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => stopMicrophone('cancel')}
                      className="min-h-[34px] px-2.5 py-1 rounded-xl bg-[#171717] border border-[#303030] text-[11px] font-bold text-zinc-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => stopMicrophone('finish')}
                      style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-contrast-text)' }}
                      className="min-h-[34px] px-3 py-1 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-[11px] font-black cursor-pointer"
                    >
                      Terminar
                    </button>
                  </div>
                </div>
                {liveTranscript && (
                  <p className="text-xs text-[#F5F5F5] bg-[#090909] border border-[#303030] rounded-xl px-2.5 py-1.5">
                    {liveTranscript}
                  </p>
                )}
                <p className="text-[10px] text-zinc-400">
                  Al terminar, podrás revisar y corregir kilos, repeticiones o ejercicios antes de enviar.
                </p>
              </div>
            )}

            {voiceNotice && (
              <div
                data-testid="coach-voice-notice"
                className={`px-3 py-2 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
                  voiceNotice.tone === 'error'
                    ? 'bg-red-950/40 border-red-500/50 text-red-200'
                    : 'bg-[#171717] border-[#303030] text-zinc-300'
                }`}
              >
                <span>{voiceNotice.text}</span>
                <button
                  type="button"
                  onClick={() => setVoiceNotice(null)}
                  aria-label="Ocultar aviso de voz"
                  className="text-zinc-400 hover:text-[#F5F5F5] p-1 shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Bottom Chat Input Bar (one-hand friendly Mic + Input + Send) */}
        <form
          onSubmit={handleFormSubmit}
          className="px-3.5 py-3 bg-[#121212] border-t border-[#303030] flex items-center gap-2 shrink-0"
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Pregúntale a tu coach o dicta..."
            enterKeyHint="send"
            maxLength={500}
            className="flex-1 min-h-[44px] px-3.5 py-2 rounded-2xl bg-[#090909] border border-[#303030] text-xs sm:text-sm text-[#F5F5F5] placeholder:text-zinc-500 focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            data-testid="coach-mic-button"
            onClick={handleStartDictation}
            aria-label={
              isListening
                ? 'Terminar dictado por voz'
                : voiceCapabilities.sttSupported
                ? 'Hablarle al coach por micrófono'
                : 'Dictado por voz no disponible'
            }
            aria-pressed={isListening}
            className={`min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
              isListening
                ? 'bg-red-500/20 border-2 border-accent text-accent-text'
                : voiceCapabilities.sttSupported
                ? 'bg-[#171717] hover:bg-[#222222] border border-[#303030] hover:border-accent/70 text-accent-text'
                : 'bg-[#171717] border border-[#303030] text-zinc-500'
            }`}
          >
            {voiceCapabilities.sttSupported ? (
              <Mic className="w-5 h-5" />
            ) : (
              <MicOff className="w-4 h-4" />
            )}
          </button>
          <button
            type="submit"
            disabled={!inputText.trim() || isLoadingAI}
            aria-label="Enviar mensaje al coach"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-contrast-text)' }}
            className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-contrast flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default CoachChatModal;
