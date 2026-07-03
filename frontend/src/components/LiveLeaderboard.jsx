import { useEffect, useMemo, useRef, useState } from 'react';
import { Radio, Trophy, WifiOff } from 'lucide-react';

const ROW_HEIGHT = 68;
const ROW_GAP = 8;

const RANK_BADGES = [
    'bg-gradient-to-br from-amber-300 to-yellow-500 text-yellow-950 shadow-[0_0_14px_rgba(251,191,36,0.45)]',
    'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800',
    'bg-gradient-to-br from-orange-300 to-amber-600 to-90% text-orange-950',
];

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatClock(seconds) {
    if (!Number.isFinite(seconds)) return '--:--';
    const safe = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Candidates ranked by live score; rows are absolutely positioned and slide
// to their new slot whenever the ranking changes (scoreboard-style motion).
const LiveLeaderboard = ({ attempts, connectionStatus, showQuizTitle = false }) => {
    const ranked = useMemo(() => {
        const rows = Array.isArray(attempts) ? [...attempts] : [];
        rows.sort((a, b) => {
            const scoreDiff = toNumber(b?.live_percentage) - toNumber(a?.live_percentage);
            if (scoreDiff !== 0) return scoreDiff;
            const answeredDiff = toNumber(b?.answered_count) - toNumber(a?.answered_count);
            if (answeredDiff !== 0) return answeredDiff;
            const elapsedDiff = toNumber(a?.elapsed_seconds, Infinity) - toNumber(b?.elapsed_seconds, Infinity);
            if (elapsedDiff !== 0) return elapsedDiff;
            const nameA = String(a?.student_name || a?.student_email || a?.student_id || '');
            const nameB = String(b?.student_name || b?.student_email || b?.student_id || '');
            return nameA.localeCompare(nameB);
        });
        return rows;
    }, [attempts]);

    // Track previous ranks/scores to show movement arrows and score flashes.
    const prevRanksRef = useRef(new Map());
    const prevScoresRef = useRef(new Map());
    const [movements, setMovements] = useState(new Map());
    const [flashes, setFlashes] = useState(new Set());

    useEffect(() => {
        const nextMovements = new Map();
        const nextFlashes = new Set();

        ranked.forEach((row, index) => {
            const id = Number(row?.id);
            const prevRank = prevRanksRef.current.get(id);
            if (prevRank !== undefined && prevRank !== index) {
                nextMovements.set(id, prevRank > index ? 'up' : 'down');
            }
            const score = toNumber(row?.live_score);
            const prevScore = prevScoresRef.current.get(id);
            if (prevScore !== undefined && prevScore !== score) {
                nextFlashes.add(id);
            }
        });

        prevRanksRef.current = new Map(ranked.map((row, index) => [Number(row?.id), index]));
        prevScoresRef.current = new Map(ranked.map((row) => [Number(row?.id), toNumber(row?.live_score)]));

        if (nextMovements.size === 0 && nextFlashes.size === 0) return undefined;

        setMovements(nextMovements);
        setFlashes(nextFlashes);
        const timer = setTimeout(() => {
            setMovements(new Map());
            setFlashes(new Set());
        }, 2200);
        return () => clearTimeout(timer);
    }, [ranked]);

    const isRealtime = connectionStatus === 'connected';
    const boardHeight = ranked.length * (ROW_HEIGHT + ROW_GAP) - (ranked.length > 0 ? ROW_GAP : 0);

    return (
        <div className="relative overflow-hidden rounded-xl bg-slate-950 border border-slate-800 mb-4">
            <style>{`
                @keyframes live-score-flash {
                    0% { box-shadow: inset 0 0 0 1px rgba(56,189,248,0.9), 0 0 18px rgba(56,189,248,0.35); }
                    100% { box-shadow: inset 0 0 0 1px rgba(56,189,248,0), 0 0 0 rgba(56,189,248,0); }
                }
                .live-row-flash { animation: live-score-flash 1.6s ease-out; }
                @keyframes live-dot-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.45; transform: scale(0.8); }
                }
                .live-dot { animation: live-dot-pulse 1.4s ease-in-out infinite; }
            `}</style>

            {/* Subtle scoreboard backdrop */}
            <div
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{
                    background:
                        'radial-gradient(120% 90% at 15% 0%, rgba(59,130,246,0.16), transparent 55%), radial-gradient(100% 80% at 100% 100%, rgba(239,68,68,0.12), transparent 50%)',
                }}
            />

            <div className="relative px-4 sm:px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div className="flex items-center gap-2.5">
                        <span className="live-dot inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                        <h4 className="text-slate-100 font-bold tracking-[0.18em] uppercase text-sm">
                            Live Rankings
                        </h4>
                        <span className="text-[11px] font-semibold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full">
                            {ranked.length} candidate{ranked.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    <span
                        className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${isRealtime
                            ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                            : 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                            }`}
                    >
                        {isRealtime ? <Radio size={12} /> : <WifiOff size={12} />}
                        {isRealtime ? 'Real-time' : 'Polling every 5s'}
                    </span>
                </div>

                {ranked.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                        <Trophy size={28} className="text-slate-600 mb-3" />
                        <p className="text-slate-300 text-sm font-medium">Waiting for candidates to join…</p>
                        <p className="text-slate-500 text-xs mt-1">
                            Rankings appear here the moment a student starts answering.
                        </p>
                    </div>
                ) : (
                    <div className="relative transition-[height] duration-500" style={{ height: `${boardHeight}px` }}>
                        {ranked.map((row, index) => {
                            const id = Number(row?.id);
                            const movement = movements.get(id);
                            const isFlashing = flashes.has(id);
                            const livePct = toNumber(row?.live_percentage);
                            const progressPct = Math.min(100, Math.max(0, toNumber(row?.progress_percentage)));
                            const badgeClass = RANK_BADGES[index] || 'bg-slate-800 text-slate-300';

                            return (
                                <div
                                    key={id}
                                    className={`absolute left-0 right-0 flex items-center gap-3 sm:gap-4 rounded-lg bg-slate-900/90 border border-slate-800 px-3 sm:px-4 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${isFlashing ? 'live-row-flash' : ''}`}
                                    style={{
                                        height: `${ROW_HEIGHT}px`,
                                        transform: `translateY(${index * (ROW_HEIGHT + ROW_GAP)}px)`,
                                    }}
                                >
                                    <div className={`flex items-center justify-center w-9 h-9 rounded-lg font-black text-sm shrink-0 ${badgeClass}`}>
                                        {index + 1}
                                    </div>

                                    <div className="w-4 text-center shrink-0">
                                        {movement === 'up' && <span className="text-emerald-400 text-xs font-bold">▲</span>}
                                        {movement === 'down' && <span className="text-red-400 text-xs font-bold">▼</span>}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <p className="text-slate-100 font-semibold text-sm truncate">
                                            {row?.student_name || row?.student_email || `Student ${row?.student_id}`}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="h-1.5 flex-1 max-w-[140px] rounded-full bg-slate-800 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-400 transition-[width] duration-700"
                                                    style={{ width: `${progressPct}%` }}
                                                />
                                            </div>
                                            <span className="text-[11px] text-slate-400 whitespace-nowrap">
                                                {toNumber(row?.answered_count)}/{toNumber(row?.total_questions)} answered
                                            </span>
                                            {showQuizTitle && row?.quiz_title && (
                                                <span className="hidden md:inline text-[11px] text-slate-500 truncate">
                                                    · {row.quiz_title}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="hidden sm:block text-right shrink-0">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Time left</p>
                                        <p className="text-slate-300 text-sm font-semibold tabular-nums">
                                            {formatClock(toNumber(row?.remaining_seconds, NaN))}
                                        </p>
                                    </div>

                                    <div className="text-right shrink-0 w-[76px]">
                                        <p className="text-xl font-black tabular-nums leading-none text-sky-300">
                                            {livePct.toFixed(1)}
                                            <span className="text-xs font-bold text-slate-500 ml-0.5">%</span>
                                        </p>
                                        <p className="text-[11px] text-slate-500 tabular-nums mt-1">
                                            {toNumber(row?.live_score).toFixed(1)} / {toNumber(row?.quiz_total_marks).toFixed(0)}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveLeaderboard;
