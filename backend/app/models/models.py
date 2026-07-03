from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text, JSON, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.database import Base

# Define String lengths for MySQL compatibility
EMAIL_LENGTH = 255
NAME_LENGTH = 100
ROLE_LENGTH = 50
ID_LENGTH = 100
DEPARTMENT_LENGTH = 100
YEAR_LENGTH = 50
PHONE_LENGTH = 20
TITLE_LENGTH = 500
CODE_LENGTH = 50
ANSWER_LENGTH = 500
TYPE_LENGTH = 50
TOPIC_LENGTH = 200
DIFFICULTY_LENGTH = 20

# Using datetime.now() for all timestamps to use local timezone

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(EMAIL_LENGTH), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    first_name = Column(String(NAME_LENGTH), nullable=False)
    last_name = Column(String(NAME_LENGTH), nullable=False)
    role = Column(String(ROLE_LENGTH), nullable=False)  # 'admin', 'teacher', 'student'
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    last_active = Column(DateTime, default=datetime.now)
    
    # Student specific fields
    student_id = Column(String(ID_LENGTH), unique=True, nullable=True, index=True)
    department = Column(String(DEPARTMENT_LENGTH), nullable=True)
    class_year = Column(String(YEAR_LENGTH), nullable=True)  # '1st Year', '2nd Year', etc.
    phone_number = Column(String(PHONE_LENGTH), nullable=True)
    profile_image = Column(Text, nullable=True)
    
    # Relationships
    quizzes_created = relationship("Quiz", back_populates="creator", foreign_keys="Quiz.creator_id")
    quiz_attempts = relationship("QuizAttempt", back_populates="student")
    subjects_created = relationship("Subject", back_populates="creator")
    questions_created = relationship("QuestionBank", back_populates="creator")

class Quiz(Base):
    __tablename__ = "quizzes"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(TITLE_LENGTH), nullable=False)
    description = Column(Text, nullable=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True)
    department = Column(String(DEPARTMENT_LENGTH), nullable=True)
    class_year = Column(String(YEAR_LENGTH), nullable=True)
    
    # Timing and scheduling
    scheduled_at = Column(DateTime, nullable=True)  # When quiz becomes available
    duration_minutes = Column(Integer, nullable=True)  # Quiz duration
    grace_period_minutes = Column(Integer, default=5)  # Late start grace period
    
    # Live session fields
    is_live_session = Column(Boolean, default=False)  # True if this is a live quiz session
    live_start_time = Column(DateTime, nullable=True)  # Exact time when live session starts
    live_end_time = Column(DateTime, nullable=True)  # Exact time when live session ends
    
    # Marking scheme
    total_marks = Column(Float, default=0)
    marks_per_correct = Column(Float, default=1)  # Default marks for correct answer
    negative_marking = Column(Float, default=0)  # Negative marks for incorrect answer
    
    # Status
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    
    # Relationships
    creator = relationship("User", back_populates="quizzes_created", foreign_keys=[creator_id])
    subject = relationship("Subject", back_populates="quizzes")
    questions = relationship("Question", back_populates="quiz", cascade="all, delete-orphan")
    attempts = relationship("QuizAttempt", back_populates="quiz")

class Question(Base):
    __tablename__ = "questions"
    
    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    question_bank_id = Column(Integer, ForeignKey("question_bank.id"), nullable=True)  # If pulled from bank
    question_text = Column(Text, nullable=False)
    question_type = Column(String(TYPE_LENGTH), nullable=False)  # 'mcq', 'true_false', 'short_answer'
    
    # MCQ options
    option_a = Column(String(ANSWER_LENGTH), nullable=True)
    option_b = Column(String(ANSWER_LENGTH), nullable=True)
    option_c = Column(String(ANSWER_LENGTH), nullable=True)
    option_d = Column(String(ANSWER_LENGTH), nullable=True)
    correct_answer = Column(String(ANSWER_LENGTH), nullable=False)
    
    # Marks
    marks = Column(Float, default=1)
    order = Column(Integer, default=0)  # Question order in quiz
    
    # Relationships
    quiz = relationship("Quiz", back_populates="questions")
    question_bank = relationship("QuestionBank", back_populates="quiz_questions")

class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"
    
    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Scores
    score = Column(Float, nullable=True)
    total_marks = Column(Float, nullable=False)
    percentage = Column(Float, nullable=True)
    
    # Timing
    started_at = Column(DateTime, default=datetime.utcnow)  # Store UTC-naive for consistent timer comparisons
    submitted_at = Column(DateTime, nullable=True)
    time_taken_minutes = Column(Float, nullable=True)  # Actual time taken
    
    # Status
    is_completed = Column(Boolean, default=False)
    is_graded = Column(Boolean, default=False)
    
    # Relationships
    quiz = relationship("Quiz", back_populates="attempts")
    student = relationship("User", back_populates="quiz_attempts")
    answers = relationship("Answer", back_populates="attempt", cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_answers_attempt_question"),
        Index("ix_answers_attempt_question", "attempt_id", "question_id"),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("quiz_attempts.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    answer_text = Column(Text, nullable=True)
    is_correct = Column(Boolean, nullable=True)
    marks_awarded = Column(Float, default=0)
    
    # Relationships
    attempt = relationship("QuizAttempt", back_populates="answers")


# NEW MODELS FOR ENHANCED FEATURES

class Subject(Base):
    __tablename__ = "subjects"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(TITLE_LENGTH), nullable=False, unique=True)
    code = Column(String(CODE_LENGTH), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    department = Column(String(DEPARTMENT_LENGTH), nullable=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    
    # Relationships
    creator = relationship("User", back_populates="subjects_created")
    quizzes = relationship("Quiz", back_populates="subject")
    question_bank = relationship("QuestionBank", back_populates="subject")


class QuestionBank(Base):
    __tablename__ = "question_bank"
    
    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Question details
    question_text = Column(Text, nullable=False)
    question_type = Column(String(TYPE_LENGTH), nullable=False)  # 'mcq', 'true_false', 'short_answer'
    
    # MCQ options
    option_a = Column(String(ANSWER_LENGTH), nullable=True)
    option_b = Column(String(ANSWER_LENGTH), nullable=True)
    option_c = Column(String(ANSWER_LENGTH), nullable=True)
    option_d = Column(String(ANSWER_LENGTH), nullable=True)
    correct_answer = Column(String(ANSWER_LENGTH), nullable=False)
    
    # Organization
    topic = Column(String(TOPIC_LENGTH), nullable=True)
    difficulty = Column(String(DIFFICULTY_LENGTH), default='medium')  # 'easy', 'medium', 'hard'
    marks = Column(Float, default=1)
    
    # Metadata
    times_used = Column(Integer, default=0)  # How many times used in quizzes
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    
    # Relationships
    subject = relationship("Subject", back_populates="question_bank")
    creator = relationship("User", back_populates="questions_created")
    quiz_questions = relationship("Question", back_populates="question_bank")


class QuizAssignment(Base):
    """Tracks which students are assigned to which quizzes"""
    __tablename__ = "quiz_assignments"
    __table_args__ = (
        UniqueConstraint("quiz_id", "student_id", name="uq_quiz_assignments_quiz_student"),
        Index("ix_quiz_assignments_quiz_student", "quiz_id", "student_id"),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_at = Column(DateTime, default=datetime.now)
    # Number of attempts this assignment permits. Each (re)assign sets this to
    # (completed attempts so far + 1), so a reassign grants exactly one fresh attempt.
    attempts_allowed = Column(Integer, default=1, nullable=False)

    # Relationships
    quiz = relationship("Quiz", backref="assignments")
    student = relationship("User", backref="assigned_quizzes")


# --- SESSION MANAGEMENT TABLES ---

class RevokedToken(Base):
    """Stores revoked JWT ids (jti) until they expire."""

    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String(64), unique=True, index=True, nullable=False)
    subject = Column(String(EMAIL_LENGTH), index=True, nullable=True)  # usually email
    revoked_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)


class UserTokenBlock(Base):
    """Global invalidation marker for a user.

    Any token with iat < revoked_before is rejected.
    """

    __tablename__ = "user_token_blocks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True, nullable=False)
    revoked_before = Column(DateTime, default=datetime.utcnow, nullable=False)
