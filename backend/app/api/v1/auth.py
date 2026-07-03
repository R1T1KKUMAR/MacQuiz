from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta, datetime
from app.db.database import get_db
from app.models.models import User
from app.models.models import RevokedToken, UserTokenBlock
from app.schemas.schemas import Token, LoginRequest, UserResponse, ChangePasswordRequest
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.config import settings
from app.core.deps import get_current_active_user, oauth2_scheme
from app.core.rate_limit import check_rate_limit

router = APIRouter()


def _get_client_ip(request: Request) -> str:
    """Resolve client IP behind proxies/load balancers (e.g., Vercel)."""
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        first_ip = forwarded_for.split(",")[0].strip()
        if first_ip:
            return first_ip

    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def _enforce_login_rate_limit(request: Request, username: str) -> None:
    client_ip = _get_client_ip(request)
    normalized_username = (username or "").strip().lower() or "unknown"

    # Per-IP limit protects against broad abuse from one source.
    ip_limit = check_rate_limit(f"login-ip:{client_ip}", limit=60, window_seconds=300)
    if not ip_limit.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
            headers={"Retry-After": str(ip_limit.retry_after_seconds or 60)},
        )

    # Per-user limit avoids locking out entire campuses/offices sharing one public IP.
    user_limit = check_rate_limit(
        f"login-user:{normalized_username}",
        limit=10,
        window_seconds=300,
    )
    if not user_limit.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
            headers={"Retry-After": str(user_limit.retry_after_seconds or 60)},
        )

@router.post("/login", response_model=Token)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """
    OAuth2 compatible login with form data (for Swagger UI)
    """
    _enforce_login_rate_limit(request, form_data.username)

    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    # Update last active
    user.last_active = datetime.utcnow()
    db.commit()
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": UserResponse.from_orm(user)
    }

@router.post("/login-json", response_model=Token)
def login_json(
    request: Request,
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    JSON-based login (for frontend)
    """
    _enforce_login_rate_limit(request, login_data.username)

    user = db.query(User).filter(User.email == login_data.username).first()
    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    # Update last active
    user.last_active = datetime.utcnow()
    db.commit()
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": UserResponse.from_orm(user)
    }

@router.get("/me", response_model=UserResponse)
def get_current_user(
    current_user: User = Depends(get_current_active_user)
):
    """
    Get current logged-in user
    """
    return current_user


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Allow the current user to change their password."""
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.last_active = datetime.utcnow()
    db.commit()

    # Invalidate all previous sessions for this user and mint a new token
    block = db.query(UserTokenBlock).filter(UserTokenBlock.user_id == current_user.id).first()
    if block:
        block.revoked_before = datetime.utcnow()
    else:
        db.add(UserTokenBlock(user_id=current_user.id, revoked_before=datetime.utcnow()))
    db.commit()

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    new_token = create_access_token(
        data={"sub": current_user.email},
        expires_delta=access_token_expires,
    )

    # Backward compatible response (frontend can update token if provided)
    return {"success": True, "access_token": new_token, "token_type": "bearer"}


@router.post("/logout")
def logout(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Revoke the current access token (single-session logout)."""
    from app.core.security import decode_access_token

    payload = decode_access_token(token)
    jti = (payload or {}).get("jti")
    exp = (payload or {}).get("exp")

    if jti:
        # best-effort insert; ignore duplicates
        exists = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
        if not exists:
            expires_at = None
            try:
                if exp:
                    # jose may decode exp into int timestamp
                    expires_at = datetime.utcfromtimestamp(int(exp))
            except Exception:
                expires_at = None

            db.add(RevokedToken(jti=jti, subject=current_user.email, expires_at=expires_at))
            db.commit()

    return {"success": True}


@router.post("/logout-all")
def logout_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Invalidate all tokens issued before now for this user."""
    now = datetime.utcnow()
    block = db.query(UserTokenBlock).filter(UserTokenBlock.user_id == current_user.id).first()
    if block:
        block.revoked_before = now
    else:
        db.add(UserTokenBlock(user_id=current_user.id, revoked_before=now))
    db.commit()

    return {"success": True}


@router.post("/refresh")
def refresh_access_token(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Issue a fresh access token for an already-authenticated user."""
    current_user.last_active = datetime.utcnow()
    db.commit()

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": current_user.email},
        expires_delta=access_token_expires,
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
    }
