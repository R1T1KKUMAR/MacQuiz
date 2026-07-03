import { io } from 'socket.io-client';
import { API_BASE_URL, normalizeServerDateStrings } from './api';

// Real-time channel for the teacher/admin live monitor. Auth reuses the same
// JWT as the REST API; the backend refuses sockets from non-staff accounts.
// When the socket cannot connect (e.g. serverless backend without WebSocket
// support) callers are expected to fall back to fast HTTP polling.
export const LIVE_ATTEMPT_EVENTS = [
    'attempt_started',
    'attempt_progress',
    'attempt_submitted',
    'attempt_kicked',
];

export function createLiveMonitorSocket({ onAttemptEvent, onStatusChange } = {}) {
    const token = localStorage.getItem('access_token');
    if (!token || !API_BASE_URL) {
        return null;
    }

    const socket = io(API_BASE_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
        reconnectionDelay: 2000,
        reconnectionDelayMax: 15000,
        timeout: 8000,
    });

    socket.on('connect', () => onStatusChange?.('connected'));
    socket.on('disconnect', () => onStatusChange?.('disconnected'));
    socket.on('connect_error', () => onStatusChange?.('disconnected'));

    for (const eventName of LIVE_ATTEMPT_EVENTS) {
        socket.on(eventName, (payload) => onAttemptEvent?.(eventName, normalizeServerDateStrings(payload)));
    }

    return socket;
}
