import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager
import logging
import socketio
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from app.core.config import settings
from app.core.live import sio, register_event_loop
from app.db.database import engine, Base, SessionLocal
from app.models.models import User
from app.core.security import get_password_hash, verify_password
from app.api.v1 import auth, users, quizzes, attempts, subjects, question_bank, analytics

logger = logging.getLogger(__name__)


def ensure_user_profile_image_column() -> None:
    """Best-effort schema compatibility for existing databases."""
    inspector = inspect(engine)
    user_columns = {col["name"] for col in inspector.get_columns("users")}
    if "profile_image" in user_columns:
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN profile_image TEXT"))


def ensure_quiz_assignment_attempts_allowed_column() -> None:
    """Best-effort schema compatibility for existing databases.

    `create_all` never adds columns to an existing table, so a deploy that
    introduces `attempts_allowed` would otherwise break every QuizAssignment
    query until a migration runs. Adding it here makes the column self-healing
    on startup. Existing rows default to 1 (one attempt, no reattempt).
    """
    inspector = inspect(engine)
    if "quiz_assignments" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("quiz_assignments")}
    if "attempts_allowed" in columns:
        return

    with engine.begin() as connection:
        connection.execute(text(
            "ALTER TABLE quiz_assignments ADD COLUMN attempts_allowed INTEGER NOT NULL DEFAULT 1"
        ))

def init_admin() -> None:
    """Create the initial admin user if it doesn't exist.

    This should run during startup, not at import time.
    """
    admin_email = (settings.ADMIN_EMAIL or "").strip()
    admin_password = (settings.ADMIN_PASSWORD or "").strip()

    if not admin_email or not admin_password:
        print("ℹ️  ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin bootstrap")
        return

    db = SessionLocal()
    try:
        admin_exists = db.query(User).filter(User.email == admin_email).first()
        if admin_exists:
            # Keep env credentials as the recovery source of truth for admin access.
            if not verify_password(admin_password, admin_exists.hashed_password):
                admin_exists.hashed_password = get_password_hash(admin_password)
                admin_exists.is_active = True
                db.commit()
                print("✅ Admin password synchronized from environment")
            else:
                print("ℹ️  Admin user already exists")
            return

        admin_user = User(
            email=admin_email,
            hashed_password=get_password_hash(admin_password),
            first_name="Admin",
            last_name="User",
            role="admin",
            is_active=True,
        )
        db.add(admin_user)
        try:
            db.commit()
            print(f"✅ Admin user created: {admin_email}")
        except IntegrityError:
            # Another startup instance may create admin concurrently; ignore duplicate.
            db.rollback()
            print("ℹ️  Admin user already exists (detected during commit)")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    register_event_loop(asyncio.get_running_loop())
    app.state.db_startup_ok = True
    app.state.db_startup_error = None
    try:
        Base.metadata.create_all(bind=engine)
        ensure_user_profile_image_column()
        ensure_quiz_assignment_attempts_allowed_column()
        init_admin()
    except Exception as error:
        app.state.db_startup_ok = False
        app.state.db_startup_error = str(error)
        logger.exception("Database startup/bootstrap failed")
    yield
    # Shutdown (nothing to do)

app = FastAPI(
    title="MacQuiz API",
    description="Comprehensive Backend API for MacQuiz - Advanced Quiz Management System",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compress larger JSON payloads (attempt lists, analytics) to improve response time on free-tier hosting.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "geolocation=(), microphone=(), camera=()",
    )
    return response

# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(subjects.router, prefix="/api/v1/subjects", tags=["Subjects"])
app.include_router(question_bank.router, prefix="/api/v1/question-bank", tags=["Question Bank"])
app.include_router(quizzes.router, prefix="/api/v1/quizzes", tags=["Quizzes"])
app.include_router(attempts.router, prefix="/api/v1/attempts", tags=["Quiz Attempts"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics & Reports"])

@app.get("/")
async def root():
    return {
        "message": "Welcome to MacQuiz API v2.0",
        "version": "2.0.0",
        "features": [
            "JWT Authentication with Role-Based Access Control",
            "Comprehensive User Management (Admin, Teacher, Student)",
            "Subject Management System",
            "Question Bank with Difficulty Levels",
            "Advanced Quiz Creation with Scheduling",
            "Custom Marking Schemes (Positive & Negative)",
            "Time-Based Quiz Control with Grace Periods",
            "Automatic Grading Engine",
            "Comprehensive Analytics & Reporting",
            "Department & Class-Based Filtering"
        ],
        "docs": "/docs",
        "redoc": "/redoc"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy" if getattr(app.state, "db_startup_ok", True) else "degraded",
        "version": "2.0.0",
        "database": "connected" if getattr(app.state, "db_startup_ok", True) else "unavailable",
        "startup_error": getattr(app.state, "db_startup_error", None),
    }


# Combined ASGI app: Socket.IO handles /socket.io, everything else goes to FastAPI.
# Serve this (app.main:socket_app) with uvicorn; Vercel keeps importing `app`
# since its serverless runtime cannot hold WebSocket connections anyway.
socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="/socket.io")
