from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from datetime import datetime, timedelta
from typing import List, Optional
from app.db.database import get_db
from app.models.models import User, Quiz, QuizAttempt, Answer, Question
from app.schemas.schemas import (
    QuizAttemptStart, QuizAttemptSubmit, QuizAttemptResponse,
    DashboardStats, ActivityItem
)
from app.core.deps import get_current_active_user, require_role

router = APIRouter()

# Allow a small clock-skew tolerance so students are not blocked at countdown zero.
START_TIME_TOLERANCE_SECONDS = 90
# Live sessions should start strictly at configured time.
LIVE_START_TIME_TOLERANCE_SECONDS = 0


def _normalized_answer_text(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _safe_minutes_value(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return max(0.0, float(value))


def _format_minutes_seconds(value: Optional[float]) -> Optional[str]:
    safe_value = _safe_minutes_value(value)
    if safe_value is None:
        return None
    minutes = int(safe_value)
    seconds = int((safe_value - minutes) * 60)
    return f"{minutes}m {seconds}s"


def _naive_datetime_remaining_seconds(target_time: datetime) -> float:
    """
    Compute remaining seconds for DB-naive datetimes that may represent either UTC or local time.
    Pick the smallest non-negative delta to avoid timer inflation on page refresh.
    """
    now_utc = datetime.utcnow()
    now_local = datetime.now()
    utc_delta = (target_time - now_utc).total_seconds()
    local_delta = (target_time - now_local).total_seconds()

    candidates = [utc_delta, local_delta]
    non_negative = [value for value in candidates if value >= 0]
    if non_negative:
        return min(non_negative)
    return max(candidates)


def _naive_datetime_elapsed_seconds(start_time: datetime) -> float:
    """
    Compute elapsed seconds for DB-naive datetimes that may represent UTC or local time.
    Pick the smallest non-negative delta to avoid inflated elapsed durations.
    """
    now_utc = datetime.utcnow()
    now_local = datetime.now()
    utc_delta = (now_utc - start_time).total_seconds()
    local_delta = (now_local - start_time).total_seconds()

    candidates = [utc_delta, local_delta]
    non_negative = [value for value in candidates if value >= 0]
    if non_negative:
        return min(non_negative)
    return max(candidates)


def _finalize_expired_attempt(db: Session, attempt: QuizAttempt, quiz: Quiz, now: datetime) -> None:
    """Finalize an expired, incomplete attempt using currently saved answers."""
    existing_answers = db.query(Answer).filter(Answer.attempt_id == attempt.id).all()
    answer_map = {ans.question_id: ans for ans in existing_answers}
    questions = db.query(Question).filter(Question.quiz_id == attempt.quiz_id).all()

    total_score = 0.0
    for question in questions:
        answer = answer_map.get(question.id)
        if not answer:
            continue

        student_answer = _normalized_answer_text(answer.answer_text)
        correct_answer = (question.correct_answer or "").strip().lower()
        if not student_answer:
            # Unanswered question: no penalty, no correctness flag.
            is_correct = None
            marks_awarded = 0.0
        else:
            is_correct = student_answer == correct_answer

            if is_correct:
                marks_awarded = float(question.marks or 0)
            else:
                marks_awarded = -float(quiz.negative_marking or 0) if float(quiz.negative_marking or 0) > 0 else 0.0

        answer.is_correct = is_correct
        answer.marks_awarded = marks_awarded
        total_score += marks_awarded

    time_taken = (now - attempt.started_at).total_seconds() / 60 if attempt.started_at else 0
    time_taken = max(0.0, time_taken)
    if quiz.duration_minutes and time_taken > quiz.duration_minutes:
        time_taken = quiz.duration_minutes

    attempt.score = max(0.0, total_score)
    attempt.percentage = (attempt.score / attempt.total_marks * 100) if attempt.total_marks > 0 else 0
    attempt.submitted_at = now
    attempt.time_taken_minutes = round(max(0.0, time_taken), 2)
    attempt.is_completed = True
    attempt.is_graded = True

    db.commit()


def _is_attempt_expired(attempt: QuizAttempt, quiz: Quiz, now: datetime) -> bool:
    if quiz.is_live_session and quiz.live_end_time:
        return now > quiz.live_end_time
    if quiz.duration_minutes and attempt.started_at:
        deadline = attempt.started_at + timedelta(minutes=quiz.duration_minutes)
        return now > deadline
    return False


def _normalize_student_attempts_for_quiz(
    db: Session,
    quiz: Quiz,
    student_id: int,
    now: datetime,
):
    student_attempts = db.query(QuizAttempt).filter(
        QuizAttempt.quiz_id == quiz.id,
        QuizAttempt.student_id == student_id,
    ).order_by(QuizAttempt.started_at.desc(), QuizAttempt.id.desc()).all()

    active_incomplete_attempts = []
    completed_attempt_count = 0

    for existing_attempt in student_attempts:
        if existing_attempt.is_completed:
            completed_attempt_count += 1
            continue

        if _is_attempt_expired(existing_attempt, quiz, now):
            _finalize_expired_attempt(db, existing_attempt, quiz, now)
            completed_attempt_count += 1
            continue

        active_incomplete_attempts.append(existing_attempt)

    # Keep only the latest active attempt; remove stale duplicates.
    if len(active_incomplete_attempts) > 1:
        stale_attempt_ids = [attempt.id for attempt in active_incomplete_attempts[1:]]
        db.query(Answer).filter(Answer.attempt_id.in_(stale_attempt_ids)).delete(synchronize_session=False)
        db.query(QuizAttempt).filter(QuizAttempt.id.in_(stale_attempt_ids)).delete(synchronize_session=False)
        db.commit()
        active_incomplete_attempts = active_incomplete_attempts[:1]

    active_attempt = active_incomplete_attempts[0] if active_incomplete_attempts else None
    return active_attempt, completed_attempt_count


def _build_attempt_sanity_flags(
    quiz: Quiz,
    attempt: QuizAttempt,
    total_questions: int,
    correct_answers: int,
    answered_count: int,
):
    flags = []

    score = float(attempt.score or 0)
    total_marks = float(attempt.total_marks or 0)
    percentage = float(attempt.percentage) if attempt.percentage is not None else None

    if score < 0:
        flags.append("negative_score")

    if total_marks >= 0 and score > (total_marks + 1e-6):
        flags.append("score_exceeds_total")

    if percentage is not None and (percentage < -0.1 or percentage > 100.1):
        flags.append("percentage_out_of_range")

    if correct_answers > answered_count:
        flags.append("correct_exceeds_answered")

    if total_questions > 0 and answered_count > total_questions:
        flags.append("answered_exceeds_total")

    if attempt.is_completed and total_questions > 0:
        correct_ratio = correct_answers / total_questions
        marks_per_correct = float(quiz.marks_per_correct or 1) if quiz else 1.0
        negative_marking = float(quiz.negative_marking or 0) if quiz else 0.0

        # Suspicious: many correct answers but net score clamped to zero, even though
        # negative marking isn't aggressive enough to typically offset that level of correctness.
        if score <= 0 and correct_ratio >= 0.5 and negative_marking <= marks_per_correct:
            flags.append("high_correct_zero_score")

        # Suspiciously fast completion for larger quizzes.
        if attempt.time_taken_minutes is not None and total_questions >= 20 and float(attempt.time_taken_minutes) < 0.5:
            flags.append("very_fast_completion")

    return flags


def best_completed_attempt_ids(
    db: Session,
    quiz_id: Optional[int] = None,
    student_id: Optional[int] = None,
    quiz_ids: Optional[List[int]] = None,
) -> List[int]:
    """Return the id of the authoritative completed attempt for each (quiz, student).

    After a teacher grants reattempts, a student may have several completed
    attempts for the same quiz. Reporting treats the *best* of those (highest
    score, ties broken by the most recent submission) as the official result
    while every attempt is still kept as history. Restrict aggregate queries to
    the ids returned here so reattempts don't double-count or skew averages.

    Optional filters (`quiz_id`, `student_id`, `quiz_ids`) narrow the scope; the
    ranking is per (quiz, student) and is unaffected by which subset is requested.
    """
    ranked = db.query(
        QuizAttempt.id.label("attempt_id"),
        func.row_number().over(
            partition_by=(QuizAttempt.quiz_id, QuizAttempt.student_id),
            order_by=(
                func.coalesce(QuizAttempt.score, 0).desc(),
                QuizAttempt.submitted_at.desc(),
                QuizAttempt.id.desc(),
            ),
        ).label("rank"),
    ).filter(QuizAttempt.is_completed == True)

    if quiz_id is not None:
        ranked = ranked.filter(QuizAttempt.quiz_id == quiz_id)
    if student_id is not None:
        ranked = ranked.filter(QuizAttempt.student_id == student_id)
    if quiz_ids is not None:
        if not quiz_ids:
            return []
        ranked = ranked.filter(QuizAttempt.quiz_id.in_(quiz_ids))

    ranked_subquery = ranked.subquery()
    rows = db.query(ranked_subquery.c.attempt_id).filter(ranked_subquery.c.rank == 1).all()
    return [row.attempt_id for row in rows]


@router.post("/start", response_model=QuizAttemptResponse)
async def start_quiz_attempt(
    attempt_data: QuizAttemptStart,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Start a quiz attempt with eligibility checks
    - Validates quiz is active
    - Checks schedule and grace period
    - Prevents duplicate attempts
    """
    # Verify quiz exists
    quiz = db.query(Quiz).filter(Quiz.id == attempt_data.quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )

    # Students can only start attempts for quizzes assigned to them
    assignment = None
    if current_user.role == "student":
        from app.models.models import QuizAssignment
        assignment = db.query(QuizAssignment).filter(
            QuizAssignment.quiz_id == quiz.id,
            QuizAssignment.student_id == current_user.id,
        ).first()
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Quiz not assigned to you"
            )
    
    # Teachers and admins can preview anytime (bypass restrictions)
    is_teacher_or_admin = current_user.role in ["teacher", "admin"]
    
    if not quiz.is_active and not is_teacher_or_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quiz is not active"
        )
    
    # Quiz schedule datetimes are stored as UTC-naive values.
    # Compare against utcnow() to keep checks stable across hosting timezones.
    now = datetime.utcnow()

    # For teachers/admins previewing: delete any existing incomplete attempts to start fresh
    if is_teacher_or_admin:
        existing_incomplete = db.query(QuizAttempt).filter(
            QuizAttempt.quiz_id == quiz.id,
            QuizAttempt.student_id == current_user.id,
            QuizAttempt.is_completed == False
        ).all()
        if existing_incomplete:
            existing_ids = [attempt.id for attempt in existing_incomplete]
            db.query(Answer).filter(Answer.attempt_id.in_(existing_ids)).delete(synchronize_session=False)
            db.query(QuizAttempt).filter(QuizAttempt.id.in_(existing_ids)).delete(synchronize_session=False)
            db.commit()
    else:
        # For students: normalize historical data and resolve active/completed state.
        active_attempt, completed_attempt_count = _normalize_student_attempts_for_quiz(
            db=db,
            quiz=quiz,
            student_id=current_user.id,
            now=now,
        )

        # Return existing active attempt to allow reconnection.
        # For live quizzes, still enforce start-time boundary before allowing reconnect.
        if active_attempt:
            if quiz.is_live_session and quiz.live_start_time:
                live_join_open_time = quiz.live_start_time - timedelta(seconds=LIVE_START_TIME_TOLERANCE_SECONDS)
                if now < live_join_open_time:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Live session has not started yet. Starts at {quiz.live_start_time.strftime('%Y-%m-%d %H:%M:%S')}"
                    )
            return active_attempt

        # Enforce the attempt allowance recorded on the assignment. Each reassign
        # sets attempts_allowed to (completed + 1), so it grants exactly one retry.
        # `assignment` was resolved (and required) in the student check above.
        attempts_allowed = (
            assignment.attempts_allowed
            if assignment and assignment.attempts_allowed is not None
            else 1
        )
        if completed_attempt_count >= attempts_allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You have used all your attempts for this quiz. Ask your teacher to reassign it."
            )
    
    # Check live session timing (only for students)
    if quiz.is_live_session and not is_teacher_or_admin:
        if not quiz.live_start_time or not quiz.live_end_time:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Live session times not configured properly"
            )
        
        # Check if session hasn't started yet (with tolerance for minor clock drift)
        live_join_open_time = quiz.live_start_time - timedelta(seconds=LIVE_START_TIME_TOLERANCE_SECONDS)
        if now < live_join_open_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Live session has not started yet. Starts at {quiz.live_start_time.strftime('%H:%M:%S')}"
            )
        
        # Students can join any time while the live session is active.
        # Check if session has ended
        if now > quiz.live_end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Live session has ended"
            )
        
        # Student is joining during the live session - ALWAYS ALLOWED
        # This allows reconnection at any time during the session
    # Check schedule and grace period (for non-live quizzes, only for students)
    elif quiz.scheduled_at and not is_teacher_or_admin:
        grace_end = quiz.scheduled_at + timedelta(minutes=quiz.grace_period_minutes)
        
        scheduled_open_time = quiz.scheduled_at - timedelta(seconds=START_TIME_TOLERANCE_SECONDS)
        if now < scheduled_open_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Quiz has not started yet. Starts at {quiz.scheduled_at}"
            )
        
        if now > grace_end:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Grace period for starting this quiz has expired"
            )
    
    # Create attempt
    db_attempt = QuizAttempt(
        quiz_id=quiz.id,
        student_id=current_user.id,
        total_marks=quiz.total_marks,
        is_completed=False,
        is_graded=False
    )
    
    db.add(db_attempt)
    db.commit()
    db.refresh(db_attempt)
    
    return db_attempt

@router.post("/submit", response_model=QuizAttemptResponse)
async def submit_quiz_attempt(
    attempt_id: int,
    submission: QuizAttemptSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Submit quiz attempt with custom marking scheme
    - Applies positive marking for correct answers
    - Applies negative marking for incorrect answers
    - Validates deadline if quiz has duration
    - Calculates time taken
    """
    # Get attempt
    attempt = db.query(QuizAttempt).filter(QuizAttempt.id == attempt_id).first()
    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attempt not found"
        )
    
    # Verify ownership
    if attempt.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not your attempt"
        )
    
    if attempt.is_completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quiz already submitted"
        )
    
    # Get quiz
    quiz = db.query(Quiz).filter(Quiz.id == attempt.quiz_id).first()
    
    # Teachers/admins previewing should not be blocked by student live-session deadlines.
    is_teacher_or_admin = current_user.role in ["teacher", "admin"]

    # Validate deadline
    now = datetime.utcnow()
    if quiz.is_live_session and not is_teacher_or_admin:
        # For live sessions, deadline is the live_end_time regardless of when student started
        if now > quiz.live_end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Live session has ended. Submission deadline has passed."
            )
    elif quiz.duration_minutes:
        # For regular quizzes, deadline is based on individual start time
        deadline = attempt.started_at + timedelta(minutes=quiz.duration_minutes)
        if now > deadline:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Submission deadline has passed"
            )
    
    # Calculate score with custom marking scheme
    total_score = 0
    correct_count = 0
    incorrect_count = 0

    # Remove any previously autosaved answers for this attempt to avoid duplicates
    db.query(Answer).filter(Answer.attempt_id == attempt.id).delete(synchronize_session=False)
    
    # If no answers provided, still mark as completed with 0 score
    if not submission.answers or len(submission.answers) == 0:
        attempt.score = 0
        attempt.percentage = 0
        attempt.submitted_at = datetime.utcnow()
        time_taken = (datetime.utcnow() - attempt.started_at).total_seconds() / 60
        attempt.time_taken_minutes = round(max(0.0, time_taken), 2)
        attempt.is_completed = True
        attempt.is_graded = True
        db.commit()
        db.refresh(attempt)
        return attempt
    
    for answer_data in submission.answers:
        question = db.query(Question).filter(Question.id == answer_data.question_id).first()
        if question:
            student_answer_normalized = _normalized_answer_text(answer_data.answer_text)

            # Blank/whitespace answer means unattempted; never negative mark it.
            if not student_answer_normalized:
                continue

            # Check answer correctness
            is_correct = student_answer_normalized == _normalized_answer_text(question.correct_answer)
            
            # Apply marking scheme
            if is_correct:
                marks_awarded = question.marks  # Award full question marks for correct answer
                correct_count += 1
            else:
                marks_awarded = -quiz.negative_marking if quiz.negative_marking > 0 else 0
                incorrect_count += 1
            
            total_score += marks_awarded
            
            # Save answer
            db_answer = Answer(
                attempt_id=attempt.id,
                question_id=question.id,
                answer_text=answer_data.answer_text.strip(),
                is_correct=is_correct,
                marks_awarded=marks_awarded
            )
            db.add(db_answer)
    
    # Calculate time taken
    submission_time = datetime.utcnow()
    time_taken = (submission_time - attempt.started_at).total_seconds() / 60  # in minutes
    time_taken = max(0.0, time_taken)
    
    # Cap time taken at quiz duration (if quiz has duration)
    # This prevents unrealistic times when students leave quiz open for long periods
    if quiz.duration_minutes and time_taken > quiz.duration_minutes:
        time_taken = quiz.duration_minutes
    
    # Update attempt
    attempt.score = max(0, total_score)  # Don't allow negative total scores
    attempt.percentage = (attempt.score / attempt.total_marks * 100) if attempt.total_marks > 0 else 0
    attempt.submitted_at = submission_time
    attempt.time_taken_minutes = round(max(0.0, time_taken), 2)
    attempt.is_completed = True
    attempt.is_graded = True
    
    db.commit()
    db.refresh(attempt)
    
    return attempt

@router.post("/{attempt_id:int}/save-answer")
async def save_answer_progress(
    attempt_id: int,
    answer_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Save or clear a single answer during quiz (for auto-save on refresh)
    Expected answer_data: {"question_id": int, "answer_text": str}
    - If answer_text is blank, existing saved answer is removed.
    """
    attempt = db.query(QuizAttempt).filter(QuizAttempt.id == attempt_id).first()
    
    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attempt not found"
        )
    
    if attempt.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not your attempt"
        )
    
    if attempt.is_completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot save answers for completed quiz"
        )
    
    question_id = answer_data.get("question_id")
    answer_text = answer_data.get("answer_text")

    if not question_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="question_id is required"
        )

    normalized_answer = (answer_text or "").strip()
    
    # Check if answer already exists, update it
    existing_answer = db.query(Answer).filter(
        Answer.attempt_id == attempt_id,
        Answer.question_id == question_id
    ).first()
    
    if existing_answer and not normalized_answer:
        db.delete(existing_answer)
    elif existing_answer:
        existing_answer.answer_text = normalized_answer
    else:
        if not normalized_answer:
            # Nothing to persist if no answer exists and payload is blank
            return {"status": "cleared", "question_id": question_id}
        # Create new answer (without grading yet)
        new_answer = Answer(
            attempt_id=attempt_id,
            question_id=question_id,
            answer_text=normalized_answer,
            is_correct=False  # Will be graded on final submission
        )
        db.add(new_answer)
    
    db.commit()
    
    return {"status": "saved" if normalized_answer else "cleared", "question_id": question_id}

@router.get("/{attempt_id:int}/answers")
async def get_saved_answers(
    attempt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get all saved answers for an in-progress attempt (for restore after refresh)
    """
    attempt = db.query(QuizAttempt).filter(QuizAttempt.id == attempt_id).first()
    
    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attempt not found"
        )
    
    if attempt.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not your attempt"
        )
    
    # Get all saved answers
    answers = db.query(Answer).filter(Answer.attempt_id == attempt_id).all()
    
    return {
        "attempt_id": attempt_id,
        "answers": [
            {
                "question_id": ans.question_id,
                "answer_text": ans.answer_text
            }
            for ans in answers
        ]
    }


@router.api_route("/{attempt_id:int}/kick-out", methods=["POST", "GET"], dependencies=[Depends(require_role(["admin", "teacher"]))])
@router.api_route("/kick-out/{attempt_id:int}", methods=["POST", "GET"], dependencies=[Depends(require_role(["admin", "teacher"]))])
@router.api_route("/actions/{attempt_id:int}/kick-out", methods=["POST", "GET"], dependencies=[Depends(require_role(["admin", "teacher"]))])
async def kick_out_live_attempt(
    attempt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Force-end a student's active live attempt.
    - Admin can kick from any live quiz.
    - Teacher can kick only from quizzes they created.
    """
    return _kick_out_live_attempt_internal(attempt_id, db, current_user)


@router.api_route("/kick-out", methods=["POST", "GET"], dependencies=[Depends(require_role(["admin", "teacher"]))])
@router.api_route("/actions/kick-out", methods=["POST", "GET"], dependencies=[Depends(require_role(["admin", "teacher"]))])
async def kick_out_live_attempt_query(
    attempt_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Compatibility route: force-end live attempt using query parameter."""
    return _kick_out_live_attempt_internal(attempt_id, db, current_user)


@router.get("/kick-out-status", dependencies=[Depends(require_role(["admin", "teacher"]))])
@router.get("/actions/kick-out-status", dependencies=[Depends(require_role(["admin", "teacher"]))])
async def kick_out_status(
    current_user: User = Depends(get_current_active_user),
):
    """Diagnostic endpoint to confirm deployed backend includes kick-out routes."""
    return {
        "status": "ok",
        "feature": "kick_out_live_attempt",
        "route_version": "2026-03-12-1",
        "role": current_user.role,
    }


def _kick_out_live_attempt_internal(attempt_id: int, db: Session, current_user: User):
    attempt = db.query(QuizAttempt).filter(QuizAttempt.id == attempt_id).first()
    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attempt not found"
        )

    quiz = db.query(Quiz).filter(Quiz.id == attempt.quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )

    if current_user.role == "teacher" and quiz.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to manage this attempt"
        )

    student = db.query(User).filter(User.id == attempt.student_id).first()
    if not student or student.role != "student":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only student attempts can be kicked out"
        )

    if not quiz.is_live_session:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kick-out is allowed only for live quizzes"
        )

    if attempt.is_completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attempt is already completed"
        )

    now = datetime.utcnow()
    _finalize_expired_attempt(db, attempt, quiz, now)

    return {
        "attempt_id": attempt.id,
        "student_id": attempt.student_id,
        "quiz_id": attempt.quiz_id,
        "status": "kicked_out",
        "message": "Student removed from live quiz and attempt submitted"
    }

@router.get("/{attempt_id:int}/remaining-time")
async def get_remaining_time(
    attempt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get remaining time for a quiz attempt
    For live sessions: calculates based on live_end_time
    For regular quizzes: calculates based on started_at + duration
    """
    attempt = db.query(QuizAttempt).filter(QuizAttempt.id == attempt_id).first()
    
    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attempt not found"
        )
    
    # Verify ownership
    if attempt.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not your attempt"
        )
    
    if attempt.is_completed:
        return {
            "remaining_seconds": 0,
            "is_expired": True,
            "message": "Quiz already submitted"
        }
    
    quiz = db.query(Quiz).filter(Quiz.id == attempt.quiz_id).first()
    now = datetime.utcnow()
    is_teacher_or_admin = current_user.role in ["teacher", "admin"]
    
    if quiz.is_live_session and not is_teacher_or_admin:
        # Student live sessions are bound to the session end-time.
        remaining = _naive_datetime_remaining_seconds(quiz.live_end_time)
        if quiz.duration_minutes:
            # Never exceed configured live duration due timezone interpretation drift.
            remaining = min(remaining, float(quiz.duration_minutes) * 60.0)
        is_expired = remaining <= 0
    else:
        # Teacher/admin previews use per-attempt duration even for live quizzes.
        # Regular quizzes also use per-attempt duration.
        if quiz.duration_minutes:
            # started_at is stored UTC-naive; use utcnow() for consistent duration math.
            preview_now = datetime.utcnow()
            deadline = attempt.started_at + timedelta(minutes=quiz.duration_minutes)
            remaining = (deadline - preview_now).total_seconds()
            is_expired = preview_now > deadline
        else:
            # No duration limit
            remaining = None
            is_expired = False
    
    return {
        "remaining_seconds": max(0, int(remaining)) if remaining is not None else None,
        "is_expired": is_expired,
        "is_live_session": quiz.is_live_session,
        "started_at": attempt.started_at,
        "live_end_time": quiz.live_end_time if quiz.is_live_session else None
    }

@router.get("/my-attempts")
async def get_my_attempts(
    include_incomplete: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get all quiz attempts for the current student with enhanced details"""
    query = db.query(QuizAttempt).filter(QuizAttempt.student_id == current_user.id)
    
    # By default, only show completed attempts
    if not include_incomplete:
        query = query.filter(QuizAttempt.is_completed == True)
    
    attempts = query.order_by(QuizAttempt.started_at.desc()).offset(skip).limit(limit).all()

    if not attempts:
        return []

    quiz_ids = list({attempt.quiz_id for attempt in attempts})
    attempt_ids = [attempt.id for attempt in attempts]

    quizzes = db.query(Quiz.id, Quiz.title, Quiz.total_marks).filter(Quiz.id.in_(quiz_ids)).all()
    quiz_map = {quiz.id: quiz for quiz in quizzes}

    question_count_rows = db.query(
        Question.quiz_id,
        func.count(Question.id).label("total_questions"),
    ).filter(
        Question.quiz_id.in_(quiz_ids)
    ).group_by(
        Question.quiz_id
    ).all()
    question_count_map = {row.quiz_id: int(row.total_questions or 0) for row in question_count_rows}

    correct_answer_rows = db.query(
        Answer.attempt_id,
        func.count(Answer.id).label("correct_answers"),
    ).filter(
        Answer.attempt_id.in_(attempt_ids),
        Answer.is_correct == True
    ).group_by(
        Answer.attempt_id
    ).all()
    correct_answer_map = {row.attempt_id: int(row.correct_answers or 0) for row in correct_answer_rows}
    
    # Enhance each attempt with calculated fields
    result = []
    for attempt in attempts:
        quiz = quiz_map.get(attempt.quiz_id)
        total_questions = question_count_map.get(attempt.quiz_id, 0)
        correct_answers = correct_answer_map.get(attempt.id, 0) if attempt.is_completed else None
        
        # Format time taken - handle None case
        time_taken_str = _format_minutes_seconds(attempt.time_taken_minutes)
        
        # Create response dict with explicit type conversions
        attempt_dict = {
            "id": attempt.id,
            "quiz_id": attempt.quiz_id,
            "student_id": attempt.student_id,
            "score": float(attempt.score) if attempt.score is not None else None,
            "total_marks": float(attempt.total_marks),
            "percentage": float(attempt.percentage) if attempt.percentage is not None else None,
            "started_at": attempt.started_at.isoformat() if attempt.started_at else None,
            "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
            "time_taken_minutes": _safe_minutes_value(attempt.time_taken_minutes),
            "is_completed": bool(attempt.is_completed),
            "is_graded": bool(attempt.is_graded),
            "quiz_title": quiz.title if quiz else None,
            "correct_answers": correct_answers,
            "total_questions": total_questions,
            "quiz_total_marks": float(quiz.total_marks) if quiz else float(attempt.total_marks),
            "time_taken": time_taken_str
        }
        result.append(attempt_dict)
    
    return result

@router.get("/all-attempts", dependencies=[Depends(require_role(["admin", "teacher"]))])
async def get_all_attempts(
    quiz_id: int = None,
    student_id: int = None,
    completed_only: bool = True,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get all quiz attempts with enhanced details for teachers/admins"""
    now = datetime.utcnow()
    query = db.query(QuizAttempt)

    # Student Results/Live Monitor should include only real student attempts.
    # This excludes teacher/admin preview attempts from dashboard counts.
    query = query.join(User, User.id == QuizAttempt.student_id)
    query = query.filter(User.role == "student")

    # Teachers can only see attempts for their own quizzes
    if current_user.role == "teacher":
        query = query.join(Quiz, Quiz.id == QuizAttempt.quiz_id)
        query = query.filter(Quiz.creator_id == current_user.id)
    
    # Apply filters
    if completed_only:
        query = query.filter(QuizAttempt.is_completed == True)
    
    if quiz_id:
        query = query.filter(QuizAttempt.quiz_id == quiz_id)
    
    if student_id:
        query = query.filter(QuizAttempt.student_id == student_id)
    
    attempts = query.order_by(QuizAttempt.submitted_at.desc(), QuizAttempt.started_at.desc()).offset(skip).limit(limit).all()

    if not attempts:
        return []

    quiz_ids = list({attempt.quiz_id for attempt in attempts})
    student_ids = list({attempt.student_id for attempt in attempts})
    attempt_ids = [attempt.id for attempt in attempts]

    quizzes = db.query(Quiz).filter(Quiz.id.in_(quiz_ids)).all()
    quiz_map = {quiz.id: quiz for quiz in quizzes}

    students = db.query(User.id, User.first_name, User.last_name, User.email).filter(User.id.in_(student_ids)).all()
    student_map = {student.id: student for student in students}

    question_count_rows = db.query(
        Question.quiz_id,
        func.count(Question.id).label("total_questions"),
    ).filter(
        Question.quiz_id.in_(quiz_ids)
    ).group_by(
        Question.quiz_id
    ).all()
    question_count_map = {row.quiz_id: int(row.total_questions or 0) for row in question_count_rows}

    question_rows = db.query(
        Question.id,
        Question.quiz_id,
        Question.correct_answer,
        Question.marks,
    ).filter(
        Question.quiz_id.in_(quiz_ids)
    ).all()
    question_meta_map = {
        int(row.id): {
            "quiz_id": int(row.quiz_id),
            "correct_answer": _normalized_answer_text(row.correct_answer),
            "marks": float(row.marks or 0),
        }
        for row in question_rows
    }

    answer_rows = db.query(
        Answer.attempt_id,
        Answer.question_id,
        Answer.answer_text,
    ).filter(
        Answer.attempt_id.in_(attempt_ids)
    ).all()
    answers_by_attempt = {}
    for row in answer_rows:
        answers_by_attempt.setdefault(int(row.attempt_id), {})[int(row.question_id)] = row.answer_text
    
    # Enhance each attempt with calculated fields
    result = []
    for attempt in attempts:
        quiz = quiz_map.get(attempt.quiz_id)

        # Auto-finalize expired incomplete attempts so live monitor stays accurate
        if quiz and not attempt.is_completed:
            is_expired = False
            if quiz.is_live_session and quiz.live_end_time and now > quiz.live_end_time:
                is_expired = True
            elif quiz.duration_minutes and attempt.started_at:
                deadline = attempt.started_at + timedelta(minutes=quiz.duration_minutes)
                if now > deadline:
                    is_expired = True

            if is_expired:
                _finalize_expired_attempt(db, attempt, quiz, now)

        student = student_map.get(attempt.student_id)
        total_questions = question_count_map.get(attempt.quiz_id, 0)
        attempt_answer_map = answers_by_attempt.get(int(attempt.id), {})
        answered_count = 0
        correct_answers = 0
        incorrect_answers = 0
        live_score = 0.0

        for question_id, answer_text in attempt_answer_map.items():
            normalized_answer = _normalized_answer_text(answer_text)
            if not normalized_answer:
                continue

            meta = question_meta_map.get(int(question_id))
            if not meta:
                continue

            answered_count += 1
            if normalized_answer == meta["correct_answer"]:
                correct_answers += 1
                live_score += float(meta["marks"])
            else:
                incorrect_answers += 1
                live_score -= float(quiz.negative_marking or 0) if quiz else 0.0

        live_score = max(0.0, float(live_score))
        quiz_total_marks_value = float(quiz.total_marks) if quiz and quiz.total_marks is not None else float(attempt.total_marks)
        live_percentage = (live_score / quiz_total_marks_value * 100.0) if quiz_total_marks_value > 0 else 0.0

        remaining_seconds = None
        elapsed_seconds = None
        if not attempt.is_completed and quiz:
            if quiz.is_live_session and quiz.live_end_time:
                remaining_seconds = max(0, int(_naive_datetime_remaining_seconds(quiz.live_end_time)))
            elif quiz.duration_minutes and attempt.started_at:
                deadline = attempt.started_at + timedelta(minutes=quiz.duration_minutes)
                remaining_seconds = max(0, int((deadline - now).total_seconds()))

        if attempt.is_completed and attempt.time_taken_minutes is not None:
            elapsed_seconds = max(0, int(float(attempt.time_taken_minutes) * 60))
        elif quiz and attempt.started_at:
            if remaining_seconds is not None and quiz.duration_minutes:
                elapsed_seconds = max(0, int(float(quiz.duration_minutes) * 60) - int(remaining_seconds))
            else:
                elapsed_seconds = max(0, int(_naive_datetime_elapsed_seconds(attempt.started_at)))

        if attempt.is_completed:
            status_value = "completed"
        elif remaining_seconds is not None and remaining_seconds <= 0:
            status_value = "expired"
        else:
            status_value = "in_progress"

        progress_percentage = 0.0
        if total_questions > 0:
            progress_percentage = round((answered_count / total_questions) * 100, 2)
        
        # Format time taken
        time_taken_str = _format_minutes_seconds(attempt.time_taken_minutes)
        
        # Create response dict
        sanity_flags = _build_attempt_sanity_flags(
            quiz=quiz,
            attempt=attempt,
            total_questions=total_questions,
            correct_answers=correct_answers,
            answered_count=answered_count,
        )

        attempt_dict = {
            "id": attempt.id,
            "quiz_id": attempt.quiz_id,
            "student_id": attempt.student_id,
            "student_name": f"{student.first_name} {student.last_name}" if student else None,
            "student_email": student.email if student else None,
            "score": float(attempt.score) if attempt.score is not None else None,
            "total_marks": float(attempt.total_marks),
            "percentage": float(attempt.percentage) if attempt.percentage is not None else None,
            "started_at": attempt.started_at.isoformat() if attempt.started_at else None,
            "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
            "time_taken_minutes": _safe_minutes_value(attempt.time_taken_minutes),
            "is_completed": bool(attempt.is_completed),
            "is_graded": bool(attempt.is_graded),
            "quiz_title": quiz.title if quiz else None,
            "quiz_duration_minutes": int(quiz.duration_minutes) if quiz and quiz.duration_minutes is not None else None,
            "correct_answers": correct_answers,
            "incorrect_answers": incorrect_answers,
            "answered_count": answered_count,
            "progress_percentage": progress_percentage,
            "total_questions": total_questions,
            "quiz_total_marks": quiz_total_marks_value,
            "live_score": round(live_score, 2),
            "live_percentage": round(live_percentage, 2),
            "time_taken": time_taken_str,
            "remaining_seconds": remaining_seconds,
            "elapsed_seconds": elapsed_seconds,
            "status": status_value,
            "needs_review": len(sanity_flags) > 0,
            "sanity_flags": sanity_flags,
        }
        result.append(attempt_dict)
    
    return result

@router.get("/quiz/{quiz_id}/attempts", response_model=List[QuizAttemptResponse], dependencies=[Depends(require_role(["admin", "teacher"]))])
async def get_quiz_attempts(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # Teachers can only view attempts for quizzes they created
    if current_user.role == "teacher":
        quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
        if not quiz or quiz.creator_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view attempts for this quiz"
            )

    attempts = db.query(QuizAttempt)\
        .join(User, User.id == QuizAttempt.student_id)\
        .filter(QuizAttempt.quiz_id == quiz_id, User.role == "student")\
        .all()
    return attempts

@router.get("/stats/dashboard", response_model=DashboardStats, dependencies=[Depends(require_role(["admin"]))])
async def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # Total quizzes
    total_quizzes = db.query(Quiz).count()
    
    # Students stats
    total_students = db.query(User).filter(User.role == "student").count()
    
    # Active students (students who attempted a quiz in last 30 days)
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    active_students = db.query(func.count(func.distinct(QuizAttempt.student_id)))\
        .filter(QuizAttempt.started_at >= thirty_days_ago).scalar() or 0
    
    # Yesterday's assessments
    yesterday_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    yesterday_end = yesterday_start + timedelta(days=1)
    yesterday_assessments = db.query(QuizAttempt)\
        .filter(QuizAttempt.started_at >= yesterday_start, QuizAttempt.started_at < yesterday_end)\
        .count()
    
    yesterday_attendance = db.query(func.count(func.distinct(QuizAttempt.student_id)))\
        .filter(QuizAttempt.started_at >= yesterday_start, QuizAttempt.started_at < yesterday_end)\
        .scalar() or 0
    
    # Active teachers today (teachers who created quiz or whose quiz was attempted today)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    total_teachers = db.query(User).filter(User.role == "teacher").count()
    active_teachers_today = 0  # Placeholder
    
    return {
        "total_quizzes": total_quizzes,
        "active_students": active_students,
        "total_students": total_students,
        "yesterday_assessments": yesterday_assessments,
        "yesterday_attendance": yesterday_attendance,
        "active_teachers_today": active_teachers_today,
        "total_teachers": total_teachers
    }

@router.get("/stats/activity", response_model=List[ActivityItem], dependencies=[Depends(require_role(["admin"]))])
async def get_recent_activity(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # Get recent quiz attempts
    recent_attempts = db.query(QuizAttempt).order_by(QuizAttempt.started_at.desc()).limit(limit).all()
    
    activities = []
    for attempt in recent_attempts:
        user = db.query(User).filter(User.id == attempt.student_id).first()
        quiz = db.query(Quiz).filter(Quiz.id == attempt.quiz_id).first()
        
        if user and quiz:
            time_diff = datetime.utcnow() - attempt.started_at
            if time_diff.seconds < 3600:
                time_str = f"{time_diff.seconds // 60} mins ago"
            elif time_diff.seconds < 86400:
                time_str = f"{time_diff.seconds // 3600} hours ago"
            else:
                time_str = f"{time_diff.days} days ago"
            
            activities.append({
                "user": f"{user.first_name} {user.last_name}",
                "action": f"Attempted quiz: {quiz.title}",
                "time": time_str,
                "status": "success" if attempt.submitted_at else "in_progress"
            })
    
    return activities


@router.get("/{attempt_id:int}", response_model=QuizAttemptResponse)
async def get_attempt(
    attempt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get a specific quiz attempt by ID with detailed results"""
    attempt = db.query(QuizAttempt).filter(QuizAttempt.id == attempt_id).first()

    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attempt not found"
        )

    # Students can only view their own attempts, teachers/admins can view any
    if current_user.role == "student" and attempt.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this attempt"
        )

    # Get quiz and calculate additional fields
    quiz = db.query(Quiz).filter(Quiz.id == attempt.quiz_id).first()
    total_questions = db.query(Question).filter(Question.quiz_id == attempt.quiz_id).count()
    attempt_answers = db.query(Answer).filter(Answer.attempt_id == attempt.id).all()
    question_rows = db.query(Question.id, Question.correct_answer).filter(Question.quiz_id == attempt.quiz_id).all()
    correct_answer_map = {row.id: _normalized_answer_text(row.correct_answer) for row in question_rows}

    answered_count = 0
    correct_answers = 0
    incorrect_answers = 0

    for answer in attempt_answers:
        normalized = _normalized_answer_text(answer.answer_text)
        if not normalized:
            # Blank answers are treated as unattempted
            continue

        answered_count += 1

        expected = correct_answer_map.get(answer.question_id)
        if expected is not None:
            if normalized == expected:
                correct_answers += 1
            else:
                incorrect_answers += 1
            continue

        # Fallback for legacy orphaned question rows.
        if answer.is_correct is True:
            correct_answers += 1
        elif answer.is_correct is False or float(answer.marks_awarded or 0) < 0:
            incorrect_answers += 1

    # Keep breakdown mathematically consistent for any unusual data.
    if incorrect_answers > answered_count:
        incorrect_answers = answered_count

    unattempted_questions = max(0, total_questions - answered_count)

    # Format time taken
    time_taken_str = _format_minutes_seconds(attempt.time_taken_minutes)

    # Convert to dict and add extra fields
    attempt_dict = {
        "id": attempt.id,
        "quiz_id": attempt.quiz_id,
        "student_id": attempt.student_id,
        "score": attempt.score,
        "total_marks": attempt.total_marks,
        "percentage": attempt.percentage,
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
        "time_taken_minutes": _safe_minutes_value(attempt.time_taken_minutes),
        "is_completed": attempt.is_completed,
        "is_graded": attempt.is_graded,
        "correct_answers": correct_answers,
        "answered_count": answered_count,
        "incorrect_answers": incorrect_answers,
        "unattempted_questions": unattempted_questions,
        "total_questions": total_questions,
        "quiz_total_marks": quiz.total_marks if quiz else attempt.total_marks,
        "time_taken": time_taken_str,
        "negative_marking": quiz.negative_marking if quiz else 0
    }

    return attempt_dict


@router.get("/{attempt_id:int}/review")
async def get_attempt_review(
    attempt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get per-question review for a submitted attempt.

    Returns question text, student answer, correct answer, correctness and marks.
    """
    attempt = db.query(QuizAttempt).filter(QuizAttempt.id == attempt_id).first()

    if not attempt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attempt not found"
        )

    # Students can only view their own attempts
    if current_user.role == "student" and attempt.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this attempt"
        )

    if not attempt.is_completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attempt not submitted yet"
        )

    quiz = db.query(Quiz).filter(Quiz.id == attempt.quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )

    questions = db.query(Question).filter(Question.quiz_id == quiz.id).order_by(Question.order.asc()).all()
    answers = db.query(Answer).filter(Answer.attempt_id == attempt.id).all()
    answer_map = {ans.question_id: ans for ans in answers}

    items = []
    for idx, question in enumerate(questions, start=1):
        answer = answer_map.get(question.id)
        student_answer = answer.answer_text if answer else ""
        is_correct = answer.is_correct if answer else None
        marks_awarded = float(answer.marks_awarded) if answer and answer.marks_awarded is not None else 0.0

        items.append({
            "question_number": idx,
            "question_id": question.id,
            "question_text": question.question_text,
            "question_type": question.question_type,
            "option_a": question.option_a,
            "option_b": question.option_b,
            "option_c": question.option_c,
            "option_d": question.option_d,
            "correct_answer": question.correct_answer,
            "student_answer": student_answer,
            "is_correct": is_correct,
            "marks": float(question.marks) if question.marks is not None else 0.0,
            "marks_awarded": marks_awarded,
            "mistake": bool(answer) and (answer.is_correct is False),
        })

    return {
        "attempt_id": attempt.id,
        "quiz_id": quiz.id,
        "quiz_title": quiz.title,
        "student_id": attempt.student_id,
        "score": float(attempt.score) if attempt.score is not None else 0.0,
        "total_marks": float(attempt.total_marks) if attempt.total_marks is not None else 0.0,
        "percentage": float(attempt.percentage) if attempt.percentage is not None else 0.0,
        "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
        "negative_marking": float(quiz.negative_marking) if quiz.negative_marking is not None else 0.0,
        "questions": items,
    }


@router.get("/review/{attempt_id:int}")
async def get_attempt_review_alias(
    attempt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Alias route for attempt review download to avoid path conflicts."""
    return await get_attempt_review(
        attempt_id=attempt_id,
        db=db,
        current_user=current_user
    )
