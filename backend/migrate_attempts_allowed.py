"""
Add the `attempts_allowed` column to `quiz_assignments`.

Background:
    The app initializes schema with `Base.metadata.create_all()`, which creates
    missing tables but never adds new columns to existing tables. Adding the
    reattempt counter therefore needs an explicit, idempotent ALTER for any
    database that already has the `quiz_assignments` table.

Behaviour:
    - Non-destructive. Existing rows default to 1, which preserves the current
      "one attempt, no reattempt" behaviour until a quiz is reassigned.
    - Safe to run repeatedly (checks whether the column already exists).
    - Works on both SQLite (dev) and PostgreSQL (prod). SQLite has no
      `ADD COLUMN IF NOT EXISTS`, so existence is checked via the inspector.

Usage:
    python migrate_attempts_allowed.py
"""

import sys

from sqlalchemy import inspect, text

from app.db.database import engine

TABLE_NAME = "quiz_assignments"
COLUMN_NAME = "attempts_allowed"


def migrate() -> None:
    inspector = inspect(engine)

    if TABLE_NAME not in inspector.get_table_names():
        print(
            f"ℹ️  Table '{TABLE_NAME}' does not exist yet. "
            "It will be created with the column by create_all(); nothing to do."
        )
        return

    existing_columns = {col["name"] for col in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME in existing_columns:
        print(f"✅ Column '{TABLE_NAME}.{COLUMN_NAME}' already exists. Nothing to do.")
        return

    print(f"🔄 Adding column '{TABLE_NAME}.{COLUMN_NAME}' ...")
    with engine.begin() as connection:
        connection.execute(
            text(
                f"ALTER TABLE {TABLE_NAME} "
                f"ADD COLUMN {COLUMN_NAME} INTEGER NOT NULL DEFAULT 1"
            )
        )
    print(f"✅ Added '{TABLE_NAME}.{COLUMN_NAME}' (existing rows default to 1).")


if __name__ == "__main__":
    try:
        migrate()
    except Exception as exc:  # noqa: BLE001 - surface any failure to the operator
        print(f"❌ Migration failed: {exc}")
        sys.exit(1)
