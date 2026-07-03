"""Regression test: reattempt-on-reassign + best-score reporting.

Self-contained end-to-end test driving the real HTTP endpoints against a
temporary SQLite database. Run from the backend directory:

    python test_reattempt.py

Covers both the non-live and live-session assignment paths:
  - a completed quiz blocks further attempts until the teacher reassigns
  - each reassign grants exactly one fresh attempt (attempts_allowed = completed + 1)
  - every attempt is kept as history
  - reporting/analytics treat each student's BEST attempt as authoritative
"""
import os
import tempfile
from datetime import datetime, timedelta

_TMP_DB = os.path.join(tempfile.mkdtemp(prefix="macquiz_reattempt_"), "test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB}"

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.db.database import SessionLocal, engine, Base  # noqa: E402
from app.models.models import User, QuizAssignment  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402

Base.metadata.create_all(bind=engine)

_RESULTS = []


def check(name, cond, extra=""):
    _RESULTS.append(bool(cond))
    print(("PASS" if cond else "FAIL"), "-", name, ("" if cond else f":: {extra}"))


def _seed_users():
    db = SessionLocal()
    try:
        db.add_all([
            User(email="teacher@t.com", hashed_password=get_password_hash("pass1234"),
                 first_name="Terry", last_name="Teach", role="teacher", is_active=True),
            User(email="student@s.com", hashed_password=get_password_hash("pass1234"),
                 first_name="Sam", last_name="Study", role="student", is_active=True,
                 student_id="S1", department="CSE", class_year="2nd Year"),
        ])
        db.commit()
        return db.query(User).filter(User.role == "student").first().id
    finally:
        db.close()


def _login(client, email):
    r = client.post("/api/v1/auth/login-json", json={"username": email, "password": "pass1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


QUIZ_PAYLOAD = {
    "title": "Reattempt Demo", "duration_minutes": 30, "is_live_session": False,
    "marks_per_correct": 1.0, "negative_marking": 0.0,
    "questions": [
        {"question_text": "2+2?", "question_type": "mcq", "option_a": "3", "option_b": "4",
         "option_c": "5", "option_d": "6", "correct_answer": "4", "marks": 1.0, "order": 0},
        {"question_text": "Capital of France?", "question_type": "mcq", "option_a": "Paris",
         "option_b": "Rome", "option_c": "Berlin", "option_d": "Madrid",
         "correct_answer": "Paris", "marks": 1.0, "order": 1},
    ],
}


def _make_quiz(client, teacher):
    quiz_id = client.post("/api/v1/quizzes/", json=QUIZ_PAYLOAD, headers=teacher).json()["id"]
    questions = client.get(f"/api/v1/quizzes/{quiz_id}", headers=teacher).json()["questions"]
    qid_correct = {q["id"]: q["correct_answer"] for q in questions}
    return quiz_id, qid_correct


def _take(client, student, quiz_id, qid_correct, correct):
    aid = client.post("/api/v1/attempts/start", json={"quiz_id": quiz_id}, headers=student).json()["id"]
    answers = [{"question_id": qid, "answer_text": (ans if i < correct else "WRONG")}
               for i, (qid, ans) in enumerate(qid_correct.items())]
    r = client.post(f"/api/v1/attempts/submit?attempt_id={aid}", json={"answers": answers}, headers=student)
    assert r.status_code == 200, r.text
    return r.json()


def run(client, student_id, teacher, student, *, live):
    label = "live" if live else "non-live"
    quiz_id, qid_correct = _make_quiz(client, teacher)

    def assign():
        payload = {"is_active": True, "is_live_session": live, "assigned_student_ids": [student_id]}
        if live:
            payload["live_start_time"] = (datetime.utcnow() - timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%S")
        r = client.put(f"/api/v1/quizzes/{quiz_id}", json=payload, headers=teacher)
        assert r.status_code == 200, r.text

    def eligible():
        return client.get(f"/api/v1/quizzes/{quiz_id}/eligibility", headers=student).json()

    assign()
    check(f"[{label}] eligible before first attempt", eligible().get("eligible") is True)
    a1 = _take(client, student, quiz_id, qid_correct, correct=2)
    check(f"[{label}] first attempt scores 100%", abs(a1["percentage"] - 100.0) < 0.01, a1["percentage"])

    check(f"[{label}] NOT eligible after completing (no reassign)", eligible().get("eligible") is False)
    r = client.post("/api/v1/attempts/start", json={"quiz_id": quiz_id}, headers=student)
    check(f"[{label}] start blocked (400) after completing", r.status_code == 400, r.status_code)

    assign()  # reassign grants one fresh attempt
    check(f"[{label}] eligible again after reassign", eligible().get("eligible") is True)
    a2 = _take(client, student, quiz_id, qid_correct, correct=1)  # 50%, lower than first
    check(f"[{label}] second attempt scores 50%", abs(a2["percentage"] - 50.0) < 0.01, a2["percentage"])
    check(f"[{label}] NOT eligible after using the one reattempt", eligible().get("eligible") is False)

    my = client.get("/api/v1/attempts/my-attempts", headers=student).json()
    completed = [x for x in my if x["is_completed"] and x["quiz_id"] == quiz_id]
    check(f"[{label}] both attempts kept as history", len(completed) == 2, len(completed))

    stats = client.get(f"/api/v1/quizzes/{quiz_id}/statistics", headers=teacher).json()
    check(f"[{label}] stats completed distinct student == 1", stats["completed_attempts"] == 1, stats)
    check(f"[{label}] stats average == best (100, not 75/50)",
          abs(stats["average_percentage"] - 100.0) < 0.01, stats["average_percentage"])

    db = SessionLocal()
    try:
        asg = db.query(QuizAssignment).filter(
            QuizAssignment.quiz_id == quiz_id, QuizAssignment.student_id == student_id).first()
        check(f"[{label}] attempts_allowed == 2 after one reassign", asg.attempts_allowed == 2, asg.attempts_allowed)
    finally:
        db.close()


def main():
    student_id = _seed_users()
    client = TestClient(app)
    teacher = _login(client, "teacher@t.com")
    student = _login(client, "student@s.com")

    run(client, student_id, teacher, student, live=False)
    run(client, student_id, teacher, student, live=True)

    print("\n=== SUMMARY ===")
    print(f"{sum(_RESULTS)}/{len(_RESULTS)} checks passed")
    raise SystemExit(0 if all(_RESULTS) else 1)


if __name__ == "__main__":
    main()
