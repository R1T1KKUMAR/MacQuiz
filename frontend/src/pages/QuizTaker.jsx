import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { quizAPI, attemptAPI } from '../services/api';
import {
    Clock, CheckCircle, AlertCircle, ChevronLeft, ChevronRight,
    Send, RotateCcw, Timer, FileText, X, Check, Circle
} from 'lucide-react';

// Auto-save flush window: answer changes are batched into one request per window.
const ANSWER_AUTOSAVE_FLUSH_MS = 5000;

const QuizTaker = () => {
    const { quizId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { success, error } = useToast();

    const [quiz, setQuiz] = useState(null);
    const [attempt, setAttempt] = useState(null);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState({});
    const [timeRemaining, setTimeRemaining] = useState(null);
    const [calculatedDuration, setCalculatedDuration] = useState(null);
    const [initialDurationSeconds, setInitialDurationSeconds] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [preStartMessage, setPreStartMessage] = useState('');
    const [preStartAt, setPreStartAt] = useState(null);
    const [preStartCountdown, setPreStartCountdown] = useState(null);
    const [hasLoadingStalled, setHasLoadingStalled] = useState(false);
    const [initSequence, setInitSequence] = useState(0);
    const [isServerTimeExpired, setIsServerTimeExpired] = useState(false);
    const initStartedRef = useRef(false);
    const lastAutoRetryAtRef = useRef(0);
    const isTeacherOrAdminUser = user?.role === 'teacher' || user?.role === 'admin';

    const getTimerSnapshotKey = useCallback((attemptId) => `live_timer_snapshot_${attemptId}`, []);

    const readTimerSnapshot = useCallback((attemptId) => {
        try {
            const raw = sessionStorage.getItem(getTimerSnapshotKey(attemptId));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const savedRemaining = Number(parsed?.remaining_seconds);
            const savedAt = Number(parsed?.saved_at_ms);
            if (!Number.isFinite(savedRemaining) || !Number.isFinite(savedAt)) {
                return null;
            }
            const elapsedSeconds = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
            return Math.max(0, Math.floor(savedRemaining) - elapsedSeconds);
        } catch (_err) {
            return null;
        }
    }, [getTimerSnapshotKey]);

    const writeTimerSnapshot = useCallback((attemptId, remainingSeconds) => {
        try {
            sessionStorage.setItem(
                getTimerSnapshotKey(attemptId),
                JSON.stringify({
                    remaining_seconds: Math.max(0, Math.floor(remainingSeconds)),
                    saved_at_ms: Date.now(),
                })
            );
        } catch (_err) {
            // Ignore storage failures to avoid breaking quiz flow.
        }
    }, [getTimerSnapshotKey]);

    const clearTimerSnapshot = useCallback((attemptId) => {
        try {
            sessionStorage.removeItem(getTimerSnapshotKey(attemptId));
        } catch (_err) {
            // Ignore storage failures.
        }
    }, [getTimerSnapshotKey]);

    const normalizeRemainingSeconds = useCallback((rawSeconds, durationMinutes, baselineSeconds = null) => {
        const numeric = Number(rawSeconds);
        if (!Number.isFinite(numeric)) {
            return null;
        }

        let normalized = Math.max(0, Math.floor(numeric));

        const configuredCap = Number(durationMinutes) > 0 ? Math.floor(Number(durationMinutes) * 60) : null;
        if (Number.isFinite(configuredCap) && configuredCap > 0) {
            normalized = Math.min(normalized, configuredCap);
        }

        // Preview mode safety: never allow server sync to exceed configured quiz duration.
        if (isTeacherOrAdminUser) {
            const baselineCap = Number.isFinite(baselineSeconds) ? Math.floor(Number(baselineSeconds)) : null;
            const cap = baselineCap ?? configuredCap;
            if (Number.isFinite(cap) && cap > 0) {
                normalized = Math.min(normalized, cap);
            }
        }

        return normalized;
    }, [isTeacherOrAdminUser]);

    const parseStartDate = useCallback((value) => {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

        const raw = String(value).trim();
        if (!raw) return null;

        const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');

        // Backend emits UTC-naive datetimes; mark them as UTC before parsing in browser.
        const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
        const normalizedWithTz = hasTimezone ? normalized : `${normalized}Z`;

        const parsed = new Date(normalizedWithTz);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }, []);

    const extractStartDateFromMessage = useCallback((message) => {
        if (!message) return null;
        const match = String(message).match(/starts?\s+at\s+(.+)$/i);
        if (!match?.[1]) return null;
        return parseStartDate(match[1]);
    }, [parseStartDate]);

    const openPreStartView = useCallback((message, explicitStart = null, explicitSeconds = null) => {
        const parsedStart = parseStartDate(explicitStart) || extractStartDateFromMessage(message);
        const rawMessage = message || 'Quiz has not started yet.';
        const normalizedMessage = (parsedStart && /starts?\s+at/i.test(String(rawMessage)))
            ? `Quiz not started yet. Starts at ${parsedStart.toLocaleString()}`
            : rawMessage;

        setPreStartMessage(normalizedMessage);
        setPreStartAt(parsedStart);
        if (typeof explicitSeconds === 'number' && Number.isFinite(explicitSeconds)) {
            const normalizedSeconds = Math.max(0, Math.ceil(explicitSeconds));
            if (parsedStart && normalizedSeconds === 0 && parsedStart.getTime() > Date.now()) {
                setPreStartCountdown(1);
            } else {
                setPreStartCountdown(normalizedSeconds);
            }
        } else if (parsedStart) {
            const remaining = Math.max(0, Math.ceil((parsedStart.getTime() - Date.now()) / 1000));
            setPreStartCountdown(remaining);
        } else {
            setPreStartCountdown(null);
        }
        setIsRedirecting(false);
        setIsLoading(false);
    }, [extractStartDateFromMessage, parseStartDate]);

    const retryQuizStart = useCallback(() => {
        setPreStartMessage('');
        setPreStartAt(null);
        setPreStartCountdown(null);
        setHasLoadingStalled(false);
        setIsLoading(true);
        // Allow initialization flow to run again for this quiz.
        initStartedRef.current = false;
        setInitSequence((prev) => prev + 1);
    }, []);

    // Load quiz and start attempt
    useEffect(() => {
        const initQuiz = async () => {
            if (initStartedRef.current) {
                return;
            }
            initStartedRef.current = true;

            try {
                // Get quiz details
                const quizData = await quizAPI.getQuiz(quizId);
                setQuiz(quizData);

                // Teachers and admins can preview/take quizzes anytime (skip eligibility check)
                const isTeacherOrAdmin = isTeacherOrAdminUser;
                
                // Check eligibility FIRST before creating attempt (skip for teachers/admins)
                let timerCapDuration = quizData.duration_minutes;
                let effectiveIsLiveSession = !!quizData?.is_live_session;
                if (!isTeacherOrAdmin) {
                    try {
                        const eligibilityData = await quizAPI.checkEligibility(quizId);
                        if (typeof eligibilityData?.is_live_session === 'boolean') {
                            effectiveIsLiveSession = eligibilityData.is_live_session;
                            setQuiz((prev) => (prev ? { ...prev, is_live_session: effectiveIsLiveSession } : prev));
                        }
                        
                        if (!eligibilityData.eligible) {
                            const reason = eligibilityData.reason || 'You cannot take this quiz at this time.';
                            const reasonLower = String(reason).toLowerCase();
                            if (reasonLower.includes('starts at') || reasonLower.includes('not started')) {
                                openPreStartView(
                                    reason,
                                    eligibilityData.scheduled_at || eligibilityData.live_start_time,
                                    eligibilityData.seconds_until_start
                                );
                                return;
                            }
                            error(reason);
                            setIsRedirecting(true);
                            setTimeout(() => navigate('/dashboard'), 2000);
                            return;
                        }
                        
                        // Live eligibility duration is intentionally dynamic (remaining whole minutes)
                        // and should not be used as the countdown cap, otherwise reload snaps to xx:00.
                        if (!effectiveIsLiveSession && eligibilityData.duration_minutes) {
                            timerCapDuration = eligibilityData.duration_minutes;
                        }
                    } catch (err) {
                        console.error('Eligibility check failed:', err);
                        error('Failed to verify quiz eligibility. Please try again.');
                        setIsRedirecting(true);
                        setTimeout(() => navigate('/dashboard'), 2000);
                        return;
                    }
                }
                
                // Store calculated duration in state for timer sync
                setCalculatedDuration(timerCapDuration);
                
                // Initialize timer baseline. For student live sessions, defer display
                // to server-accurate remaining-time sync to avoid minute resets on refresh.
                const initialTimeSeconds = timerCapDuration * 60;
                const shouldDeferInitialTimer = !isTeacherOrAdmin && effectiveIsLiveSession;
                if (!shouldDeferInitialTimer) {
                    setTimeRemaining(initialTimeSeconds);
                    setInitialDurationSeconds(initialTimeSeconds);
                }
                
                // Start attempt (will return existing if in progress)
                const attemptData = await attemptAPI.startAttempt(quizId);
                
                // If attempt is already completed, redirect to results
                if (attemptData.is_completed) {
                    clearTimerSnapshot(attemptData.id);
                    navigate(`/quiz-result/${attemptData.id}`);
                    return;
                }
                
                setAttempt(attemptData);

                if (!isTeacherOrAdmin && effectiveIsLiveSession) {
                    const snapshotSeconds = readTimerSnapshot(attemptData.id);
                    const normalizedSnapshot = normalizeRemainingSeconds(
                        snapshotSeconds,
                        timerCapDuration,
                        initialTimeSeconds
                    );
                    if (normalizedSnapshot !== null) {
                        setTimeRemaining(normalizedSnapshot);
                        if (normalizedSnapshot > 0) {
                            setInitialDurationSeconds((prev) => {
                                if (prev === null) return normalizedSnapshot;
                                return Math.max(prev, normalizedSnapshot);
                            });
                        }
                    }
                }

                // Server-authoritative timer sync (source of truth)
                try {
                    const remainingData = await attemptAPI.getRemainingTime(attemptData.id);
                    if (typeof remainingData?.is_expired === 'boolean') {
                        setIsServerTimeExpired(remainingData.is_expired);
                    }
                    if (remainingData?.remaining_seconds !== null && remainingData?.remaining_seconds !== undefined) {
                        const syncedSeconds = normalizeRemainingSeconds(
                            remainingData.remaining_seconds,
                            timerCapDuration,
                            initialTimeSeconds
                        );
                        if (syncedSeconds !== null) {
                            setTimeRemaining((prev) => {
                                if (!isTeacherOrAdmin && effectiveIsLiveSession && prev !== null) {
                                    return Math.min(prev, syncedSeconds);
                                }
                                return syncedSeconds;
                            });
                            if (!isTeacherOrAdmin && effectiveIsLiveSession && syncedSeconds > 0) {
                                writeTimerSnapshot(attemptData.id, syncedSeconds);
                            }
                        }
                        if ((syncedSeconds ?? 0) > 0) {
                            setInitialDurationSeconds((prev) => {
                                if (prev === null) return syncedSeconds;
                                return Math.max(prev, syncedSeconds);
                            });
                        }
                    }
                } catch (syncErr) {
                    console.error('Initial timer sync failed:', syncErr);
                }
                
                // Restore saved answers if this is a reconnection
                let savedAnswersData = null;
                try {
                    savedAnswersData = await attemptAPI.getSavedAnswers(attemptData.id);
                    if (savedAnswersData.answers && savedAnswersData.answers.length > 0) {
                        const restoredAnswers = {};
                        savedAnswersData.answers.forEach(ans => {
                            restoredAnswers[ans.question_id] = ans.answer_text;
                        });
                        setAnswers(restoredAnswers);
                    }
                } catch (_err) {
                    // No saved answers to restore
                }
                
                // Check if time has already expired
                if (initialTimeSeconds <= 0) {
                    if (attemptData.is_completed) {
                        navigate(`/quiz-result/${attemptData.id}`);
                    } else {
                        error(quizData.is_live_session ? 'This quiz session has ended.' : 'Quiz time has expired.');
                        setTimeout(() => navigate('/dashboard'), 1500);
                    }
                    return;
                }
                
                const isReconnection = savedAnswersData?.answers?.length > 0;
                const previewMessage = isTeacherOrAdmin ? 'Quiz preview started' : 
                    (isReconnection ? 'Reconnected to quiz! Your progress has been restored.' : 
                        (effectiveIsLiveSession ? 'Joined live quiz session!' : 'Quiz started! Good luck!'));
                success(previewMessage);
            } catch (err) {
                const errorMessage = err.data?.detail || err.message || 'Failed to start quiz';
                const normalizedError = String(errorMessage).toLowerCase();
                if (normalizedError.includes('starts at') || normalizedError.includes('not started yet')) {
                    openPreStartView(errorMessage);
                    return;
                }

                if (normalizedError.includes('grace period expired')) {
                    try {
                        const eligibilityData = await quizAPI.checkEligibility(quizId);

                        if (!eligibilityData.eligible) {
                            const reason = eligibilityData.reason || errorMessage;
                            const reasonLower = String(reason).toLowerCase();
                            if (reasonLower.includes('starts at') || reasonLower.includes('not started')) {
                                openPreStartView(
                                    reason,
                                    eligibilityData.scheduled_at || eligibilityData.live_start_time,
                                    eligibilityData.seconds_until_start
                                );
                                return;
                            }
                            error(reason);
                            setIsRedirecting(true);
                            setTimeout(() => navigate('/dashboard'), 2000);
                            return;
                        }

                        // Eligibility says yes; retry without forcing dashboard redirect.
                        retryQuizStart();
                        return;
                    } catch (eligibilityErr) {
                        console.error('Eligibility fallback after grace error failed:', eligibilityErr);
                    }
                }

                error(errorMessage);
                console.error('Quiz start error:', err);
                // Only navigate back for quiz-specific errors, not auth errors
                setIsRedirecting(true);
                setTimeout(() => navigate('/dashboard'), 2000);
            } finally {
                setIsLoading(false);
            }
        };

        initQuiz();
    }, [quizId, user?.role, error, navigate, success, openPreStartView, initSequence, retryQuizStart]);

    useEffect(() => {
        if (preStartCountdown === null || preStartCountdown <= 0) {
            return;
        }

        const interval = setInterval(() => {
            setPreStartCountdown((prev) => {
                if (prev === null || prev <= 0) return 0;
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [preStartCountdown]);

    useEffect(() => {
        if (!preStartMessage || preStartCountdown === null || preStartCountdown > 0 || isLoading) {
            return;
        }

        // Avoid retry storms near start-time boundaries.
        const nowMs = Date.now();
        if (preStartAt && preStartAt.getTime() > nowMs) {
            return;
        }
        if (nowMs - lastAutoRetryAtRef.current < 3000) {
            return;
        }

        lastAutoRetryAtRef.current = nowMs;

        retryQuizStart();
    }, [preStartMessage, preStartCountdown, isLoading, retryQuizStart, preStartAt]);

    // Show a retry UI if init calls are unexpectedly slow.
    useEffect(() => {
        if (!isLoading) {
            setHasLoadingStalled(false);
            return;
        }

        const stallTimer = setTimeout(() => {
            setHasLoadingStalled(true);
        }, 12000);

        return () => clearTimeout(stallTimer);
    }, [isLoading, initSequence]);

    // Periodic server timer sync (authoritative for live and regular timed quizzes)
    useEffect(() => {
        if (!attempt?.id || isLoading) {
            return;
        }

        const syncRemainingTime = async () => {
            try {
                const remainingData = await attemptAPI.getRemainingTime(attempt.id);
                if (typeof remainingData?.is_expired === 'boolean') {
                    setIsServerTimeExpired(remainingData.is_expired);
                }
                if (remainingData?.remaining_seconds !== null && remainingData?.remaining_seconds !== undefined) {
                    const syncedSeconds = normalizeRemainingSeconds(
                        remainingData.remaining_seconds,
                        calculatedDuration || quiz?.duration_minutes,
                        initialDurationSeconds
                    );
                    if (syncedSeconds !== null) {
                        setTimeRemaining((prev) => {
                            if (!isTeacherOrAdminUser && quiz?.is_live_session && prev !== null) {
                                return Math.min(prev, syncedSeconds);
                            }
                            return syncedSeconds;
                        });
                        if (!isTeacherOrAdminUser && quiz?.is_live_session && syncedSeconds > 0) {
                            writeTimerSnapshot(attempt.id, syncedSeconds);
                        }
                    }
                    if ((syncedSeconds ?? 0) > 0) {
                        setInitialDurationSeconds((prev) => {
                            if (prev === null) return syncedSeconds;
                            return Math.max(prev, syncedSeconds);
                        });
                    }
                }
            } catch (syncErr) {
                console.error('Timer sync failed:', syncErr);
            }
        };

        // immediate sync once
        syncRemainingTime();

        // sync every 10s to keep time exact with backend/live session
        const syncInterval = setInterval(() => {
            syncRemainingTime();
        }, 10000);

        return () => clearInterval(syncInterval);
    }, [attempt?.id, isLoading, calculatedDuration, quiz?.duration_minutes, quiz?.is_live_session, initialDurationSeconds, isTeacherOrAdminUser, normalizeRemainingSeconds, writeTimerSnapshot]);

    useEffect(() => {
        if (!attempt?.id || isTeacherOrAdminUser || !quiz?.is_live_session || timeRemaining === null) {
            return;
        }

        if (timeRemaining > 0) {
            writeTimerSnapshot(attempt.id, timeRemaining);
            return;
        }

        clearTimerSnapshot(attempt.id);
    }, [attempt?.id, isTeacherOrAdminUser, quiz?.is_live_session, timeRemaining, writeTimerSnapshot, clearTimerSnapshot]);

    // Timer countdown
    useEffect(() => {
        // Don't start timer if quiz hasn't started yet
        if (!quiz || !attempt || isLoading) {
            return;
        }

        // If time is already 0 or not set, don't start timer
        if (timeRemaining === null || timeRemaining <= 0) {
            return;
        }

        const timer = setInterval(() => {
            setTimeRemaining((prev) => {
                const isLiveStudentFlow = quiz?.is_live_session && !isTeacherOrAdminUser;
                if (prev <= 1) {
                    // For live student sessions, only allow 0 when server confirms expiry.
                    if (isLiveStudentFlow && !isServerTimeExpired) {
                        return 1;
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [quiz, attempt, isLoading, timeRemaining, isTeacherOrAdminUser, isServerTimeExpired]);

    // Batched auto-save: keep only the latest answer per question and flush
    // them in one request per window instead of one request per click.
    const pendingSavesRef = useRef(new Map());
    const saveFlushTimerRef = useRef(null);
    const attemptIdRef = useRef(null);

    useEffect(() => {
        attemptIdRef.current = attempt?.id ?? null;
    }, [attempt]);

    const flushPendingSaves = useCallback(async ({ keepalive = false } = {}) => {
        const attemptId = attemptIdRef.current;
        if (saveFlushTimerRef.current) {
            clearTimeout(saveFlushTimerRef.current);
            saveFlushTimerRef.current = null;
        }
        if (!attemptId || pendingSavesRef.current.size === 0) {
            return;
        }
        const batch = Array.from(pendingSavesRef.current, ([question_id, answer_text]) => ({
            question_id,
            answer_text,
        }));
        pendingSavesRef.current = new Map();
        try {
            await attemptAPI.saveAnswers(attemptId, batch, { keepalive });
        } catch (err) {
            // Re-queue entries that were not superseded while the request was in flight
            for (const { question_id, answer_text } of batch) {
                if (!pendingSavesRef.current.has(question_id)) {
                    pendingSavesRef.current.set(question_id, answer_text);
                }
            }
            console.error('Failed to auto-save answers:', err);
        }
    }, []);

    const queueAnswerSave = useCallback((questionId, answerText) => {
        pendingSavesRef.current.set(questionId, answerText);
        if (!saveFlushTimerRef.current) {
            saveFlushTimerRef.current = setTimeout(() => {
                saveFlushTimerRef.current = null;
                flushPendingSaves();
            }, ANSWER_AUTOSAVE_FLUSH_MS);
        }
    }, [flushPendingSaves]);

    // Flush pending answers when the tab is hidden, the page unloads,
    // or the component unmounts, so refresh recovery stays intact.
    useEffect(() => {
        const flushOnHide = () => {
            if (document.visibilityState === 'hidden') {
                flushPendingSaves({ keepalive: true });
            }
        };
        const flushOnPageHide = () => flushPendingSaves({ keepalive: true });
        document.addEventListener('visibilitychange', flushOnHide);
        window.addEventListener('pagehide', flushOnPageHide);
        return () => {
            document.removeEventListener('visibilitychange', flushOnHide);
            window.removeEventListener('pagehide', flushOnPageHide);
            flushPendingSaves({ keepalive: true });
        };
    }, [flushPendingSaves]);

    const handleSubmitQuiz = useCallback(async (autoSubmit = false) => {
        if (!autoSubmit && !showSubmitConfirm) {
            setShowSubmitConfirm(true);
            return;
        }

        // Validate attempt exists
        if (!attempt || !attempt.id) {
            error('Quiz attempt not found. Please try starting the quiz again.');
            navigate('/dashboard');
            return;
        }

        setIsSubmitting(true);

        // Flush unsaved answers first: if the deadline already passed, the
        // server finalizes the attempt from auto-saved answers instead.
        await flushPendingSaves();

        const formattedAnswers = Object.entries(answers).map(([questionId, answer]) => ({
            question_id: parseInt(questionId),
            answer_text: answer
        }));

        try {
            const result = await attemptAPI.submitAttempt(attempt.id, formattedAnswers);
            clearTimerSnapshot(attempt.id);
            
            success(autoSubmit ? 'Time up! Quiz submitted automatically.' : 'Quiz submitted successfully!');
            navigate(`/quiz-result/${attempt.id}`, { state: { result } });
        } catch (err) {
            const errorMessage = err.data?.detail || err.message || 'Failed to submit quiz';
            error(errorMessage);
            console.error('Quiz submission error:', err);
            console.error('Attempt ID:', attempt?.id);
            console.error('Formatted answers:', formattedAnswers);
            setShowSubmitConfirm(false);
        } finally {
            setIsSubmitting(false);
        }
    }, [answers, attempt, showSubmitConfirm, error, navigate, success, clearTimerSnapshot, flushPendingSaves]);

    // Auto-submit when timer reaches 0
    const hasAutoSubmitted = useRef(false);
    useEffect(() => {
        if (timeRemaining === null || timeRemaining !== 0 || !attempt?.id || !quiz || isSubmitting || hasAutoSubmitted.current) {
            return;
        }

        const requiresServerExpiry = quiz.is_live_session && !isTeacherOrAdminUser;
        if (requiresServerExpiry && !isServerTimeExpired) {
            return;
        }

        if (!hasAutoSubmitted.current) {
            hasAutoSubmitted.current = true;
            handleSubmitQuiz(true);
        }
    }, [timeRemaining, attempt, quiz, isSubmitting, isServerTimeExpired, isTeacherOrAdminUser, handleSubmitQuiz]);

    const formatTime = (seconds) => {
        if (seconds === null) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const formatCountdown = (seconds) => {
        if (seconds === null || seconds === undefined) return '--:--:--';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleAnswerSelect = async (questionId, answer) => {
        // Prevent answer changes when time has expired
        if (timeRemaining !== null && timeRemaining <= 0) {
            error('Time has expired! Please wait while we submit your quiz.');
            return;
        }
        
        const previouslySelected = answers[questionId];
        const nextAnswer = previouslySelected === answer ? '' : answer;

        setAnswers((prev) => {
            const updated = { ...prev };
            if (!nextAnswer) {
                delete updated[questionId];
            } else {
                updated[questionId] = nextAnswer;
            }
            return updated;
        });
        
        // Auto-save answer to backend (for refresh protection), batched
        if (attempt?.id) {
            queueAnswerSave(questionId, nextAnswer);
        }
    };

    const currentQuestion = quiz?.questions?.[currentQuestionIndex];
    const totalQuestions = quiz?.questions?.length || 0;
    const answeredCount = Object.keys(answers).length;
    const timePercentage = (initialDurationSeconds && timeRemaining !== null)
        ? (timeRemaining / initialDurationSeconds) * 100
        : ((calculatedDuration && timeRemaining !== null) ? (timeRemaining / (calculatedDuration * 60)) * 100 : 100);

    // Show warning if time has expired
    const shouldShowExpiredScreen = (
        timeRemaining !== null
        && timeRemaining === 0
        && !isSubmitting
        && attempt?.id
        && (
            !quiz?.is_live_session
            || isTeacherOrAdminUser
            || isServerTimeExpired
        )
    );

    if (shouldShowExpiredScreen) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center bg-white p-8 rounded-xl shadow-lg max-w-md">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Time Expired!</h2>
                    <p className="text-gray-600 mb-4">Your quiz time has ended. Submitting your answers...</p>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mx-auto"></div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        if (hasLoadingStalled) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                    <div className="text-center bg-white p-8 rounded-xl shadow-lg max-w-xl w-full">
                        <AlertCircle className="w-14 h-14 text-amber-600 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold text-gray-800 mb-2">Still Loading Quiz</h2>
                        <p className="text-gray-600 mb-6">This is taking longer than expected. You can retry safely.</p>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <button
                                onClick={retryQuizStart}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Retry
                            </button>
                            <button
                                onClick={() => navigate('/dashboard')}
                                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
                            >
                                Back to Dashboard
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600 text-lg">Loading quiz...</p>
                </div>
            </div>
        );
    }

    if (isRedirecting) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600 text-lg">Redirecting to dashboard...</p>
                </div>
            </div>
        );
    }

    if (preStartMessage) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                <div className="text-center bg-white p-8 rounded-xl shadow-lg max-w-xl w-full">
                    <Clock className="w-14 h-14 text-blue-600 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Quiz Not Started Yet</h2>
                    <p className="text-gray-600 mb-4">{preStartMessage}</p>
                    {preStartAt && (
                        <div className="mb-6">
                            <p className="text-sm text-gray-500">Scheduled start</p>
                            <p className="font-semibold text-gray-800">{preStartAt.toLocaleString()}</p>
                            <p className="mt-3 text-sm text-gray-500">Starts in</p>
                            <p className="text-2xl font-mono font-bold text-blue-700">{formatCountdown(preStartCountdown)}</p>
                        </div>
                    )}
                    <p className="text-xs text-gray-500 mb-4">This page will auto-check and continue when the quiz starts.</p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                            onClick={() => navigate('/dashboard')}
                            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!quiz) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <AlertCircle className="text-red-600 mx-auto mb-4" size={48} />
                    <p className="text-gray-600 text-lg">Quiz data not available</p>
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // Check if quiz has no questions
    if (!quiz.questions || quiz.questions.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <AlertCircle className="text-orange-600 mx-auto mb-4" size={48} />
                    <p className="text-gray-800 text-xl font-semibold mb-2">No Questions Available</p>
                    <p className="text-gray-600 text-lg mb-4">This quiz doesn't have any questions yet.</p>
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // Check if current question index is valid
    if (!currentQuestion) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <AlertCircle className="text-red-600 mx-auto mb-4" size={48} />
                    <p className="text-gray-800 text-xl font-semibold mb-2">Question Not Found</p>
                    <p className="text-gray-600 text-lg mb-4">Unable to load the current question.</p>
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
            {/* Header Bar */}
            <div className="bg-white shadow-lg border-b-4 border-blue-600 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        {/* Quiz Info */}
                        <div className="flex items-start sm:items-center space-x-3 sm:space-x-4 min-w-0">
                            <FileText className="text-blue-600" size={28} />
                            <div className="min-w-0">
                                <h1 className="text-lg sm:text-xl font-bold text-gray-900 break-words">{quiz?.title}</h1>
                                <p className="text-sm text-gray-500">
                                    Question {currentQuestionIndex + 1} of {totalQuestions}
                                </p>
                            </div>
                        </div>

                        {/* Timer + Top Submit */}
                        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 sm:gap-6 w-full sm:w-auto">
                            {quiz?.is_live_session && (
                                <div className="flex items-center px-3 py-1 bg-red-100 text-red-700 rounded-full border-2 border-red-500 animate-pulse">
                                    <Circle className="fill-current mr-2" size={12} />
                                    <span className="text-sm font-bold">LIVE</span>
                                </div>
                            )}
                            <div className="text-right min-w-0 flex-1 sm:flex-none">
                                <div className="text-xs text-gray-500 mb-1">
                                    {quiz?.is_live_session ? 'Session Ends In' : 'Time Remaining'}
                                </div>
                                <div className={`text-2xl font-bold font-mono ${
                                    timeRemaining === null ? 'text-gray-400' :
                                    timeRemaining < 60 ? 'text-red-600 animate-pulse' : 
                                    timeRemaining < 300 ? 'text-yellow-600' : 'text-blue-600'
                                }`}>
                                    <Timer className="inline mr-2" size={24} />
                                    {formatTime(timeRemaining)}
                                </div>
                                {/* Timer bar */}
                                <div className="mt-2 w-full sm:w-48 h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full transition-all duration-1000 ${
                                            timePercentage < 10 ? 'bg-red-500' :
                                            timePercentage < 25 ? 'bg-yellow-500' : 'bg-blue-500'
                                        }`}
                                        style={{ width: `${timePercentage}%` }}
                                    ></div>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowSubmitConfirm(true)}
                                disabled={isSubmitting}
                                className="w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition shadow-lg disabled:opacity-50"
                            >
                                <Send size={16} className="inline mr-2" />
                                Submit Quiz
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Question Card */}
                    <div className="lg:col-span-3">
                        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border-2 border-blue-100">
                            {/* Question Header */}
                            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 sm:px-6 md:px-8 py-5 sm:py-6 text-white">
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                    <span className="text-sm font-semibold bg-white/20 px-4 py-1 rounded-full">
                                        Question {currentQuestionIndex + 1}/{totalQuestions}
                                    </span>
                                    <span className="text-sm font-semibold bg-white/20 px-4 py-1 rounded-full">
                                        {currentQuestion?.marks || 1} {currentQuestion?.marks === 1 ? 'Mark' : 'Marks'}
                                    </span>
                                </div>
                                <h2 className="text-xl sm:text-2xl font-bold leading-relaxed break-words">
                                    {currentQuestion?.question_text}
                                </h2>
                            </div>

                            {/* Options */}
                            <div className="p-4 sm:p-6 md:p-8 space-y-4">
                                {currentQuestion?.question_type === 'mcq' && (
                                    <>
                                        {['A', 'B', 'C', 'D'].map((option) => {
                                            const optionKey = `option_${option.toLowerCase()}`;
                                            const optionText = currentQuestion[optionKey];
                                            const isSelected = answers[currentQuestion?.id] === option;

                                            if (!optionText) return null;

                                            return (
                                                <button
                                                    key={option}
                                                    onClick={() => handleAnswerSelect(currentQuestion?.id, option)}
                                                    className={`w-full text-left p-4 sm:p-5 md:p-6 rounded-2xl border-2 transition-all duration-300 transform hover:scale-[1.02] ${
                                                        isSelected
                                                            ? 'border-blue-600 bg-blue-50 shadow-lg'
                                                            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    <div className="flex items-center space-x-4">
                                                        <div className={`flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-base sm:text-lg font-bold ${
                                                            isSelected
                                                                ? 'bg-blue-600 text-white'
                                                                : 'bg-gray-100 text-gray-600'
                                                        }`}>
                                                            {option}
                                                        </div>
                                                        <span className={`text-base sm:text-lg flex-1 break-words ${
                                                            isSelected ? 'text-blue-900 font-semibold' : 'text-gray-700'
                                                        }`}>
                                                            {optionText}
                                                        </span>
                                                        {isSelected && (
                                                            <CheckCircle className="text-blue-600 flex-shrink-0" size={28} />
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </>
                                )}

                                {currentQuestion?.question_type === 'true_false' && (
                                    <>
                                        {['True', 'False'].map((option) => {
                                            const isSelected = answers[currentQuestion?.id] === option;
                                            return (
                                                <button
                                                    key={option}
                                                    onClick={() => handleAnswerSelect(currentQuestion?.id, option)}
                                                    className={`w-full text-left p-4 sm:p-5 md:p-6 rounded-2xl border-2 transition-all duration-300 transform hover:scale-[1.02] ${
                                                        isSelected
                                                            ? 'border-blue-600 bg-blue-50 shadow-lg'
                                                            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    <div className="flex items-center space-x-4">
                                                        <div className={`flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center ${
                                                            isSelected
                                                                ? 'bg-blue-600 text-white'
                                                                : 'bg-gray-100 text-gray-600'
                                                        }`}>
                                                            {option === 'True' ? <Check size={24} /> : <X size={24} />}
                                                        </div>
                                                        <span className={`text-lg sm:text-xl font-semibold flex-1 ${
                                                            isSelected ? 'text-blue-900' : 'text-gray-700'
                                                        }`}>
                                                            {option}
                                                        </span>
                                                        {isSelected && (
                                                            <CheckCircle className="text-blue-600 flex-shrink-0" size={28} />
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </>
                                )}
                            </div>

                            {/* Navigation */}
                            <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-6 bg-gray-50 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center border-t">
                                <button
                                    onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                                    disabled={currentQuestionIndex === 0}
                                    className="w-full sm:w-auto justify-center flex items-center px-6 py-3 bg-white border-2 border-gray-300 rounded-xl text-gray-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition"
                                >
                                    <ChevronLeft size={20} className="mr-2" />
                                    Previous
                                </button>

                                <button
                                    onClick={() => setCurrentQuestionIndex(Math.min(totalQuestions - 1, currentQuestionIndex + 1))}
                                    disabled={currentQuestionIndex === totalQuestions - 1}
                                    className="w-full sm:w-auto justify-center flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Next
                                    <ChevronRight size={20} className="ml-2" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Question Navigator */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6 lg:sticky lg:top-24">
                            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                                <FileText size={20} className="mr-2 text-blue-600" />
                                Question Navigator
                            </h3>
                            
                            {/* Progress */}
                            <div className="mb-6">
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-600">Answered</span>
                                    <span className="font-bold text-blue-600">{answeredCount}/{totalQuestions}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div 
                                        className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                                        style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
                                    ></div>
                                </div>
                            </div>

                            {/* Question Grid */}
                            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                                {quiz?.questions?.map((q, idx) => {
                                    const isAnswered = answers[q.id] !== undefined;
                                    const isCurrent = idx === currentQuestionIndex;

                                    return (
                                        <button
                                            key={q.id}
                                            onClick={() => setCurrentQuestionIndex(idx)}
                                            className={`aspect-square rounded-lg font-bold text-sm transition-all duration-200 ${
                                                isCurrent
                                                    ? 'bg-blue-600 text-white shadow-lg scale-110'
                                                    : isAnswered
                                                    ? 'bg-green-100 text-green-700 border-2 border-green-400 hover:bg-green-200'
                                                    : 'bg-gray-100 text-gray-600 border-2 border-gray-300 hover:bg-gray-200'
                                            }`}
                                        >
                                            {idx + 1}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Legend */}
                            <div className="mt-6 space-y-2 text-xs">
                                <div className="flex items-center">
                                    <div className="w-6 h-6 bg-blue-600 rounded mr-2"></div>
                                    <span className="text-gray-600">Current</span>
                                </div>
                                <div className="flex items-center">
                                    <div className="w-6 h-6 bg-green-100 border-2 border-green-400 rounded mr-2"></div>
                                    <span className="text-gray-600">Answered</span>
                                </div>
                                <div className="flex items-center">
                                    <div className="w-6 h-6 bg-gray-100 border-2 border-gray-300 rounded mr-2"></div>
                                    <span className="text-gray-600">Unanswered</span>
                                </div>
                            </div>

                            <p className="mt-6 text-xs text-gray-500">
                                Submit button is available in the top header to avoid accidental submission.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Submit Confirmation Modal */}
            {showSubmitConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-5 sm:p-8">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <AlertCircle className="text-yellow-600" size={32} />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">Submit Quiz?</h2>
                            <p className="text-gray-600 mb-6">
                                You have answered <span className="font-bold text-blue-600">{answeredCount}</span> out of <span className="font-bold">{totalQuestions}</span> questions.
                                {answeredCount < totalQuestions && (
                                    <span className="block mt-2 text-red-600 font-semibold">
                                        {totalQuestions - answeredCount} question(s) unanswered!
                                    </span>
                                )}
                            </p>
                            <p className="text-sm text-gray-500 mb-6">
                                Are you sure you want to submit? You cannot change your answers after submission.
                            </p>
                            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:space-x-4">
                                <button
                                    onClick={() => setShowSubmitConfirm(false)}
                                    className="flex-1 px-6 py-3 border-2 border-gray-300 rounded-xl text-gray-700 font-semibold hover:bg-gray-100 transition"
                                >
                                    Review Answers
                                </button>
                                <button
                                    onClick={() => handleSubmitQuiz(false)}
                                    disabled={isSubmitting}
                                    className="flex-1 px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition shadow-lg disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Submitting...' : 'Yes, Submit'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default QuizTaker;
