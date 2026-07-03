"""Real-time hub for live quiz monitoring (Socket.IO).

Dashboard clients (teachers/admins) connect with their JWT and join
role-scoped rooms; the attempts API broadcasts attempt lifecycle events so
live rankings update without polling. Students never connect here - their
regular REST auto-save traffic is what drives the broadcasts.
"""
import asyncio
import logging
from typing import Optional

import socketio

from app.core.security import decode_access_token

logger = logging.getLogger(__name__)

ADMIN_ROOM = "monitor:admins"


def teacher_room(teacher_id: int) -> str:
    return f"monitor:teacher:{int(teacher_id)}"


# Origin checks add no security here: connections carry no ambient cookies
# and every socket must present a valid teacher/admin JWT to join a room.
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
)

_loop: Optional[asyncio.AbstractEventLoop] = None


def register_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Capture the server's event loop so sync request handlers can emit."""
    global _loop
    _loop = loop


def _resolve_monitor_user(token: str) -> Optional[dict]:
    """Validate the JWT and return the matching active admin/teacher user."""
    payload = decode_access_token(token or "")
    email = (payload or {}).get("sub")
    if not email:
        return None

    # Imported lazily to keep this module importable before DB bootstrap.
    from app.db.database import SessionLocal
    from app.models.models import User

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user or not user.is_active or user.role not in ("admin", "teacher"):
            return None
        return {"id": user.id, "role": user.role, "email": user.email}
    finally:
        db.close()


@sio.event
async def connect(sid, environ, auth):
    token = (auth or {}).get("token")
    monitor_user = await asyncio.to_thread(_resolve_monitor_user, token)
    if not monitor_user:
        raise socketio.exceptions.ConnectionRefusedError("Not authorized for live monitoring")

    if monitor_user["role"] == "admin":
        await sio.enter_room(sid, ADMIN_ROOM)
    else:
        await sio.enter_room(sid, teacher_room(monitor_user["id"]))
    logger.info("Live monitor connected: %s (%s)", monitor_user["email"], monitor_user["role"])


def emit_attempt_event(event: str, payload: dict, teacher_id: Optional[int] = None) -> None:
    """Broadcast an attempt lifecycle event to monitoring dashboards.

    Safe to call from sync endpoints running in the threadpool. Fire and
    forget: drops the event silently when no event loop is registered
    (e.g. serverless deployments, where clients poll instead).
    """
    if _loop is None or _loop.is_closed():
        return

    rooms = [ADMIN_ROOM]
    if teacher_id is not None:
        rooms.append(teacher_room(teacher_id))

    async def _broadcast():
        for room in rooms:
            await sio.emit(event, payload, room=room)

    try:
        asyncio.run_coroutine_threadsafe(_broadcast(), _loop)
    except RuntimeError:
        logger.debug("Live event %s dropped; event loop unavailable", event, exc_info=True)
