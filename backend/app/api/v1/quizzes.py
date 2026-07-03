from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import math
from app.db.database import get_db
from app.models.models import User, Quiz, Question, QuestionBank, Subject, QuizAttempt
from app.schemas.schemas import (
    QuizCreate, QuizResponse, QuizDetailResponse, QuizUpdate, QuizWithAnswers
)
from app.core.deps import get_current_active_user, require_role

router = APIRouter()

# Allow a small clock-skew tolerance so students are not blocked at countdown zero.
START_TIME_TOLERANCE_SECONDS = 90
# Live sessions should start strictly at configured time.
LIVE_START_TIME_TOLERANCE_SECONDS = 0
# When teacher activates a live quiz, allow slight second-level drift so
# selecting the current minute doesn't fail because backend compares with seconds.
LIVE_ACTIVATION_PAST_TOLERANCE_SECONDS = 59

@router.post("/", response_model=QuizResponse, dependencies=[Depends(require_role(["admin", "teacher"]))])
async def create_quiz(
    quiz_data: QuizCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Create a new quiz with questions (Admin and Teacher only)
    Supports:
    - Manual questions
    - Questions from question bank
    - Custom marking scheme
    - Scheduled start time
    - Grace period for late starts
    """
    # Verify subject if provided (optional - set to None if not found)
    if quiz_data.subject_id:
        subject = db.query(Subject).filter(Subject.id == quiz_data.subject_id).first()
        if not subject:
            # Don't fail, just set subject_id to None
            print(f"Warning: Subject {quiz_data.subject_id} not found, creating quiz without subject")
            quiz_data.subject_id = None

    # Normalize incoming datetimes to UTC-naive so comparisons are consistent.
    for dt_field in ["scheduled_at", "live_start_time", "live_end_time"]:
        dt_value = getattr(quiz_data, dt_field, None)
        if isinstance(dt_value, datetime) and dt_value.tzinfo is not None:
            setattr(quiz_data, dt_field, dt_value.astimezone(timezone.utc).replace(tzinfo=None))
    
    # Calculate total marks
    total_marks = sum(q.marks for q in quiz_data.questions)
    
    # Validate live session settings
    if quiz_data.is_live_session:
        if not quiz_data.live_start_time or not quiz_data.duration_minutes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Live sessions require both live_start_time and duration_minutes"
            )
        # Calculate live_end_time based on start time + duration
        quiz_data.live_end_time = quiz_data.live_start_time + timedelta(minutes=quiz_data.duration_minutes)
    
    try:
        # Create quiz
        db_quiz = Quiz(
            title=quiz_data.title,
            description=quiz_data.description,
            creator_id=current_user.id,
            subject_id=quiz_data.subject_id,
            department=quiz_data.department,
            class_year=quiz_data.class_year,
            scheduled_at=quiz_data.scheduled_at,
            duration_minutes=quiz_data.duration_minutes,
            grace_period_minutes=quiz_data.grace_period_minutes,
            is_live_session=quiz_data.is_live_session,
            live_start_time=quiz_data.live_start_time,
            live_end_time=quiz_data.live_end_time,
            is_active=False,
            total_marks=total_marks,
            marks_per_correct=quiz_data.marks_per_correct,
            negative_marking=quiz_data.negative_marking
        )

        db.add(db_quiz)
        db.flush()  # Get db_quiz.id without committing the transaction

        # Create questions
        for idx, question_data in enumerate(quiz_data.questions):
            # If question is from bank, increment usage count
            if question_data.question_bank_id:
                bank_question = db.query(QuestionBank).filter(
                    QuestionBank.id == question_data.question_bank_id
                ).first()
                if not bank_question:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Question bank item {question_data.question_bank_id} not found"
                    )
                bank_question.times_used += 1

            db_question = Question(
                quiz_id=db_quiz.id,
                question_bank_id=question_data.question_bank_id,
                question_text=question_data.question_text,
                question_type=question_data.question_type,
                option_a=question_data.option_a,
                option_b=question_data.option_b,
                option_c=question_data.option_c,
                option_d=question_data.option_d,
                correct_answer=question_data.correct_answer,
                marks=question_data.marks,
                order=idx
            )
            db.add(db_question)

        db.commit()
        db.refresh(db_quiz)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create quiz"
        )
    
    # Return formatted quiz response with attempts count
    quiz_dict = {
        "id": db_quiz.id,
        "title": db_quiz.title,
        "description": db_quiz.description,
        "creator_id": db_quiz.creator_id,
        "subject_id": db_quiz.subject_id,
        "department": db_quiz.department,
        "class_year": db_quiz.class_year,
        "scheduled_at": db_quiz.scheduled_at,
        "duration_minutes": db_quiz.duration_minutes,
        "grace_period_minutes": db_quiz.grace_period_minutes,
        "is_live_session": db_quiz.is_live_session,
        "live_start_time": db_quiz.live_start_time,
        "live_end_time": db_quiz.live_end_time,
        "total_marks": db_quiz.total_marks,
        "marks_per_correct": db_quiz.marks_per_correct,
        "negative_marking": db_quiz.negative_marking,
        "is_active": db_quiz.is_active,
        "created_at": db_quiz.created_at,
        "updated_at": db_quiz.updated_at,
        "total_questions": len(db_quiz.questions) if db_quiz.questions else 0,
        "attempts": db.query(QuizAttempt)
            .join(User, User.id == QuizAttempt.student_id)
            .filter(QuizAttempt.quiz_id == db_quiz.id, User.role == "student")
            .count()
    }
    
    return quiz_dict

@router.get("/", response_model=List[QuizResponse])
async def get_all_quizzes(
    skip: int = 0,
    limit: int = 100,
    is_active: Optional[bool] = None,
    subject_id: Optional[int] = None,
    department: Optional[str] = None,
    class_year: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get quizzes with filtering options
    - Students: Only active quizzes available to them
    - Teachers: Only their created quizzes
    - Admin: All quizzes
    """
    query = db.query(Quiz)
    
    # Role-based filtering
    if current_user.role == "student":
        from app.models.models import QuizAssignment
        
        # Only show quizzes that are:
        # 1. Active AND
        # 2. Assigned to this student (via QuizAssignment table)
        query = query.filter(Quiz.is_active == True)
        query = query.join(QuizAssignment, Quiz.id == QuizAssignment.quiz_id)
        query = query.filter(QuizAssignment.student_id == current_user.id)
    elif current_user.role == "teacher":
        query = query.filter(Quiz.creator_id == current_user.id)
    
    # Additional filters
    if is_active is not None:
        query = query.filter(Quiz.is_active == is_active)
    
    if subject_id:
        query = query.filter(Quiz.subject_id == subject_id)
    
    if department:
        query = query.filter(Quiz.department == department)
    
    if class_year:
        query = query.filter(Quiz.class_year == class_year)
    
    quizzes = query.order_by(Quiz.created_at.desc()).offset(skip).limit(limit).all()
    
    # Add total_questions and attempts count to each quiz
    result = []
    for quiz in quizzes:
        quiz_dict = {
            "id": quiz.id,
            "title": quiz.title,
            "description": quiz.description,
            "creator_id": quiz.creator_id,
            "subject_id": quiz.subject_id,
            "department": quiz.department,
            "class_year": quiz.class_year,
            "scheduled_at": quiz.scheduled_at,
            "duration_minutes": quiz.duration_minutes,
            "grace_period_minutes": quiz.grace_period_minutes,
            "is_live_session": quiz.is_live_session,
            "live_start_time": quiz.live_start_time,
            "live_end_time": quiz.live_end_time,
            "total_marks": quiz.total_marks,
            "marks_per_correct": quiz.marks_per_correct,
            "negative_marking": quiz.negative_marking,
            "is_active": quiz.is_active,
            "created_at": quiz.created_at,
            "updated_at": quiz.updated_at,
            "total_questions": db.query(Question).filter(Question.quiz_id == quiz.id).count(),
            "attempts": db.query(QuizAttempt)
                .join(User, User.id == QuizAttempt.student_id)
                .filter(QuizAttempt.quiz_id == quiz.id, User.role == "student")
                .count()
        }
        result.append(quiz_dict)
    
    return result

@router.get("/{quiz_id}")
async def get_quiz(
    quiz_id: int,
    include_answers: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get quiz details with questions
    - include_answers: For teachers/admin to see correct answers when editing
    """
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )

    # Never allow students to request answers
    if include_answers and current_user.role not in ["admin", "teacher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view correct answers"
        )
    
    # Check permissions
    if current_user.role == "student":
        # Students can only access quizzes assigned to them
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

        if not quiz.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Quiz not available"
            )
        # Timing windows are enforced by eligibility/start-attempt endpoints.
        # Keep quiz detail fetch lightweight so students can reach pre-start view.
    
    # Return quiz with answers included for teachers/admins
    if current_user.role in ["admin", "teacher"]:
        # Build response manually to include correct_answer field
        questions_with_answers = []
        for q in quiz.questions:
            questions_with_answers.append({
                "id": q.id,
                "quiz_id": q.quiz_id,
                "question_text": q.question_text,
                "question_type": q.question_type,
                "option_a": q.option_a,
                "option_b": q.option_b,
                "option_c": q.option_c,
                "option_d": q.option_d,
                "correct_answer": q.correct_answer,
                "marks": q.marks,
                "order": q.order
            })
        
        return {
            "id": quiz.id,
            "title": quiz.title,
            "description": quiz.description,
            "creator_id": quiz.creator_id,
            "subject_id": quiz.subject_id,
            "department": quiz.department,
            "class_year": quiz.class_year,
            "scheduled_at": quiz.scheduled_at,
            "duration_minutes": quiz.duration_minutes,
            "grace_period_minutes": quiz.grace_period_minutes,
            "total_marks": quiz.total_marks,
            "marks_per_correct": quiz.marks_per_correct,
            "negative_marking": quiz.negative_marking,
            "is_active": quiz.is_active,
            "created_at": quiz.created_at,
            "updated_at": quiz.updated_at,
            "total_questions": len(quiz.questions),
            "questions": questions_with_answers
        }
    
    # For students, return quiz without correct answers
    questions_without_answers = []
    for q in quiz.questions:
        questions_without_answers.append({
            "id": q.id,
            "quiz_id": q.quiz_id,
            "question_text": q.question_text,
            "question_type": q.question_type,
            "option_a": q.option_a,
            "option_b": q.option_b,
            "option_c": q.option_c,
            "option_d": q.option_d,
            "marks": q.marks,
            "order": q.order
        })
    
    return {
        "id": quiz.id,
        "title": quiz.title,
        "description": quiz.description,
        "creator_id": quiz.creator_id,
        "subject_id": quiz.subject_id,
        "department": quiz.department,
        "class_year": quiz.class_year,
        "scheduled_at": quiz.scheduled_at,
        "duration_minutes": quiz.duration_minutes,
        "grace_period_minutes": quiz.grace_period_minutes,
        "total_marks": quiz.total_marks,
        "marks_per_correct": quiz.marks_per_correct,
        "negative_marking": quiz.negative_marking,
        "is_active": quiz.is_active,
        "created_at": quiz.created_at,
        "updated_at": quiz.updated_at,
        "total_questions": len(quiz.questions),
        "questions": questions_without_answers
    }


@router.get("/{quiz_id}/eligibility")
async def check_quiz_eligibility(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Check if student can take the quiz
    Teachers and admins can preview quizzes anytime (bypass all restrictions)
    """
    from app.models.models import QuizAttempt
    
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    
    # Teachers and admins can always preview quizzes (bypass all restrictions)
    is_teacher_or_admin = current_user.role in ["teacher", "admin"]

    # Students can only check eligibility for quizzes assigned to them
    if current_user.role == "student":
        from app.models.models import QuizAssignment
        assignment = db.query(QuizAssignment).filter(
            QuizAssignment.quiz_id == quiz.id,
            QuizAssignment.student_id == current_user.id,
        ).first()
        if not assignment:
            return {
                "eligible": False,
                "reason": "Quiz not assigned to you"
            }
    
    if not quiz.is_active and not is_teacher_or_admin:
        return {
            "eligible": False,
            "reason": "Quiz is not active"
        }

    # Students may reattempt only up to the number of attempts their current
    # assignment permits. Each (re)assign raises attempts_allowed to (completed + 1),
    # so a completed attempt blocks further tries until the teacher reassigns.
    if current_user.role == "student" and not is_teacher_or_admin:
        completed_count = db.query(QuizAttempt).filter(
            QuizAttempt.quiz_id == quiz_id,
            QuizAttempt.student_id == current_user.id,
            QuizAttempt.is_completed == True
        ).count()
        attempts_allowed = (
            assignment.attempts_allowed
            if assignment and assignment.attempts_allowed is not None
            else 1
        )
        if completed_count >= attempts_allowed:
            return {
                "eligible": False,
                "reason": "You have used all your attempts for this quiz. Ask your teacher to reassign it."
            }
    
    # Check if there's an active (incomplete) attempt
    active_attempt = db.query(QuizAttempt).filter(
        QuizAttempt.quiz_id == quiz_id,
        QuizAttempt.student_id == current_user.id,
        QuizAttempt.is_completed == False
    ).first()
    
    # Quiz schedule datetimes are stored as UTC-naive values.
    # Compare using utcnow() so Vercel/server timezone does not shift schedule gates.
    now = datetime.utcnow()
    calculated_duration = quiz.duration_minutes
    
    # For live sessions, enforce strict timing and calculate remaining time (only for students)
    if quiz.is_live_session and quiz.live_start_time and not is_teacher_or_admin:
        # Check if session has ended
        if quiz.live_end_time and now > quiz.live_end_time:
            return {
                "eligible": False,
                "reason": "Quiz session has ended"
            }

        # Cannot join before start time (with tolerance for minor clock drift).
        live_join_open_time = quiz.live_start_time - timedelta(seconds=LIVE_START_TIME_TOLERANCE_SECONDS)
        if now < live_join_open_time:
            seconds_until_start = max(0, math.ceil((quiz.live_start_time - now).total_seconds()))
            return {
                "eligible": False,
                "reason": f"Quiz starts at {quiz.live_start_time}",
                "scheduled_at": quiz.live_start_time,
                "seconds_until_start": seconds_until_start,
            }
        
        # Students can join any time while the live session is active.
        
        # Calculate remaining time based on active attempt OR when student would join
        if active_attempt:
            # Student already started - calculate from their attempt start time
            elapsed_minutes = (now - active_attempt.started_at).total_seconds() / 60
            # Use the duration they were allocated when they started (from live_start_time)
            original_elapsed = (active_attempt.started_at - quiz.live_start_time).total_seconds() / 60
            allocated_duration = quiz.duration_minutes - original_elapsed
            remaining_duration = int(allocated_duration - elapsed_minutes)
        else:
            # New join - calculate from live_start_time
            elapsed_minutes = (now - quiz.live_start_time).total_seconds() / 60
            remaining_duration = int(quiz.duration_minutes - elapsed_minutes)
        
        # If no time left, mark as ineligible
        if remaining_duration <= 0:
            return {
                "eligible": False,
                "reason": "Quiz time has expired"
            }
        
        # Ensure at least 1 minute remains for eligible students
        calculated_duration = max(1, remaining_duration)
    
    # For scheduled (non-live) quizzes (only enforce for students)
    elif quiz.scheduled_at and not is_teacher_or_admin:
        grace_end = quiz.scheduled_at + timedelta(minutes=quiz.grace_period_minutes)
        
        scheduled_open_time = quiz.scheduled_at - timedelta(seconds=START_TIME_TOLERANCE_SECONDS)
        if now < scheduled_open_time:
            seconds_until_start = max(0, math.ceil((quiz.scheduled_at - now).total_seconds()))
            return {
                "eligible": False,
                "reason": f"Quiz starts at {quiz.scheduled_at}",
                "scheduled_at": quiz.scheduled_at,
                "seconds_until_start": seconds_until_start,
            }
        
        if now > grace_end:
            return {
                "eligible": False,
                "reason": "Quiz grace period expired"
            }
    
    return {
        "eligible": True,
        "quiz_id": quiz_id,
        "title": quiz.title,
        "duration_minutes": calculated_duration,
        "total_marks": quiz.total_marks,
        "is_live_session": quiz.is_live_session,
        "live_start_time": quiz.live_start_time if quiz.is_live_session else None
    }

@router.put("/{quiz_id}", response_model=QuizResponse, dependencies=[Depends(require_role(["admin", "teacher"]))])
async def update_quiz(
    quiz_id: int,
    quiz_data: QuizUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    
    # Check if user can update (creator or admin)
    if current_user.role != "admin" and quiz.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    
    update_data = quiz_data.dict(exclude_unset=True)

    # Store schedule datetimes in UTC-naive form for consistent comparisons on serverless.
    for dt_field in ["scheduled_at", "live_start_time", "live_end_time"]:
        dt_value = update_data.get(dt_field)
        if isinstance(dt_value, datetime) and dt_value.tzinfo is not None:
            update_data[dt_field] = dt_value.astimezone(timezone.utc).replace(tzinfo=None)
    
    # Handle student assignments if provided
    assigned_student_ids = update_data.pop('assigned_student_ids', None)
    if assigned_student_ids is not None:
        from app.models.models import QuizAssignment
        unique_student_ids = list(dict.fromkeys(assigned_student_ids))

        # Delete existing assignments
        db.query(QuizAssignment).filter(QuizAssignment.quiz_id == quiz_id).delete()

        # Add new assignments. Grant exactly one fresh attempt per (re)assign by
        # setting attempts_allowed to (completed attempts so far + 1). A brand new
        # student gets 1; a student who already completed the quiz gets one more.
        for student_id in unique_student_ids:
            completed_count = db.query(QuizAttempt).filter(
                QuizAttempt.quiz_id == quiz_id,
                QuizAttempt.student_id == student_id,
                QuizAttempt.is_completed == True,
            ).count()
            assignment = QuizAssignment(
                quiz_id=quiz_id,
                student_id=student_id,
                attempts_allowed=completed_count + 1,
            )
            db.add(assignment)
    
    # If updating to live session, validate and calculate end time
    if update_data.get('is_live_session'):
        if 'live_start_time' in update_data and update_data['live_start_time']:
            duration = update_data.get('duration_minutes', quiz.duration_minutes)
            if duration:
                update_data['live_end_time'] = update_data['live_start_time'] + timedelta(minutes=duration)

    # If a live quiz is being activated, preserve teacher-selected start time.
    # Never silently shift start time to "now" because it causes unexpected early joins.
    activating_live_quiz = (
        update_data.get('is_active') is True
        and (update_data.get('is_live_session') is True or quiz.is_live_session)
    )
    if activating_live_quiz:
        now = datetime.utcnow()
        candidate_start = update_data.get('live_start_time', quiz.live_start_time)
        duration = update_data.get('duration_minutes', quiz.duration_minutes) or 30

        if not candidate_start:
            candidate_start = now
            update_data['live_start_time'] = candidate_start

        # Reject past starts instead of silently mutating to now.
        if candidate_start < (now - timedelta(seconds=LIVE_ACTIVATION_PAST_TOLERANCE_SECONDS)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Live start time is too far in the past. Please choose current time or a future start time."
            )

        update_data['live_end_time'] = candidate_start + timedelta(minutes=duration)
    
    for field, value in update_data.items():
        setattr(quiz, field, value)
    
    db.commit()
    db.refresh(quiz)
    
    # Convert quiz to dict and set attempts count (not the list)
    quiz_dict = {
        "id": quiz.id,
        "title": quiz.title,
        "description": quiz.description,
        "creator_id": quiz.creator_id,
        "subject_id": quiz.subject_id,
        "department": quiz.department,
        "class_year": quiz.class_year,
        "scheduled_at": quiz.scheduled_at,
        "duration_minutes": quiz.duration_minutes,
        "grace_period_minutes": quiz.grace_period_minutes,
        "is_live_session": quiz.is_live_session,
        "live_start_time": quiz.live_start_time,
        "live_end_time": quiz.live_end_time,
        "total_marks": quiz.total_marks,
        "marks_per_correct": quiz.marks_per_correct,
        "negative_marking": quiz.negative_marking,
        "is_active": quiz.is_active,
        "created_at": quiz.created_at,
        "updated_at": quiz.updated_at,
        "total_questions": len(quiz.questions) if quiz.questions else 0,
        "attempts": len(quiz.attempts) if quiz.attempts else 0
    }
    
    return quiz_dict

@router.delete("/{quiz_id}", dependencies=[Depends(require_role(["admin", "teacher"]))])
async def delete_quiz(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    from app.models.models import QuizAttempt, Question, Answer, QuizAssignment
    
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    
    # Check if user can delete (creator or admin)
    if current_user.role != "admin" and quiz.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    
    try:
        # Delete in correct order to respect foreign key constraints:
        # 1. First delete answers (references quiz_attempts)
        attempt_ids = [attempt.id for attempt in db.query(QuizAttempt).filter(QuizAttempt.quiz_id == quiz_id).all()]
        if attempt_ids:
            db.query(Answer).filter(Answer.attempt_id.in_(attempt_ids)).delete(synchronize_session=False)
        
        # 2. Delete quiz attempts (references quiz)
        db.query(QuizAttempt).filter(QuizAttempt.quiz_id == quiz_id).delete()
        
        # 3. Delete quiz assignments (references quiz)
        db.query(QuizAssignment).filter(QuizAssignment.quiz_id == quiz_id).delete()
        
        # 4. Delete questions (references quiz)
        db.query(Question).filter(Question.quiz_id == quiz_id).delete()
        
        # 5. Finally delete the quiz
        db.delete(quiz)
        db.commit()
        
        return {"message": "Quiz deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete quiz: {str(e)}"
        )


@router.get("/{quiz_id}/statistics")
async def get_quiz_statistics(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "teacher"]))
):
    """
    Get detailed statistics for a quiz (Teacher/Admin only)
    """
    from app.models.models import QuizAttempt
    from sqlalchemy import func
    
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    
    # Check permissions
    if current_user.role == "teacher" and quiz.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this quiz's statistics"
        )
    
    from app.api.v1.attempts import best_completed_attempt_ids

    # Count each student once and treat their best completed attempt as
    # authoritative, so granted reattempts never inflate counts or skew averages.
    total_students = db.query(func.count(func.distinct(QuizAttempt.student_id))).filter(
        QuizAttempt.quiz_id == quiz_id
    ).scalar() or 0

    best_ids = best_completed_attempt_ids(db, quiz_id=quiz_id)
    completed_students = len(best_ids)
    in_progress = max(0, total_students - completed_students)

    if best_ids:
        best_filter = QuizAttempt.id.in_(best_ids)
        average_score = db.query(func.avg(QuizAttempt.score)).filter(best_filter).scalar() or 0
        average_percentage = db.query(func.avg(QuizAttempt.percentage)).filter(best_filter).scalar() or 0
        highest_score = db.query(func.max(QuizAttempt.score)).filter(best_filter).scalar() or 0
        lowest_score = db.query(func.min(QuizAttempt.score)).filter(
            best_filter, QuizAttempt.score > 0
        ).scalar() or 0
    else:
        average_score = average_percentage = highest_score = lowest_score = 0

    return {
        "quiz_id": quiz_id,
        "quiz_title": quiz.title,
        "total_marks": quiz.total_marks,
        "total_attempts": total_students,
        "completed_attempts": completed_students,
        "in_progress": in_progress,
        "average_score": round(average_score, 2),
        "average_percentage": round(average_percentage, 2),
        "highest_score": highest_score,
        "lowest_score": lowest_score,
        "pass_rate": round((completed_students / total_students * 100), 2) if total_students > 0 else 0
    }


@router.get("/{quiz_id}/assignments")
async def get_quiz_assignments(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "teacher"]))
):
    """
    Get assignment statistics for a quiz (Teacher/Admin only)
    Returns count of assigned and unassigned students
    """
    from app.models.models import QuizAssignment
    
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    
    # Get all students
    all_students = db.query(User).filter(User.role == "student", User.is_active == True).all()
    total_students = len(all_students)
    
    # Get assigned students
    assigned = db.query(QuizAssignment).filter(QuizAssignment.quiz_id == quiz_id).all()
    assigned_count = len(assigned)
    assigned_student_ids = [a.student_id for a in assigned]
    
    # Get assigned student details
    assigned_students = db.query(User).filter(User.id.in_(assigned_student_ids)).all() if assigned_student_ids else []
    
    return {
        "quiz_id": quiz_id,
        "quiz_title": quiz.title,
        "total_students": total_students,
        "assigned_count": assigned_count,
        "unassigned_count": total_students - assigned_count,
        "assigned_students": [
            {
                "id": s.id,
                "email": s.email,
                "first_name": s.first_name,
                "last_name": s.last_name,
                "department": s.department,
                "class_year": s.class_year
            }
            for s in assigned_students
        ]
    }


@router.get("/{quiz_id}/attempts")
async def get_quiz_attempts(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "teacher"]))
):
    """
    Get all attempts for a quiz (Teacher/Admin only)
    """
    from app.models.models import QuizAttempt
    
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found"
        )
    
    # Check permissions
    if current_user.role == "teacher" and quiz.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this quiz's attempts"
        )
    
    attempts = db.query(QuizAttempt).filter(
        QuizAttempt.quiz_id == quiz_id
    ).all()
    
    return attempts
