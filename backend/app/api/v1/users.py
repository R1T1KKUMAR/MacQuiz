from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List
import csv
import io
from app.db.database import get_db
from app.models.models import User, QuizAttempt, Answer, QuizAssignment, Quiz, Subject, QuestionBank
from app.schemas.schemas import UserCreate, UserResponse, UserUpdate, UserActivityResponse
from app.core.security import get_password_hash
from app.core.deps import get_current_active_user, require_role

router = APIRouter()

@router.post("/", response_model=UserResponse, dependencies=[Depends(require_role(["admin", "teacher"]))])
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # Teachers can only create students
    if current_user.role == "teacher" and user_data.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teachers can only create student accounts"
        )
    
    # Check if email already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if provided user ID already exists (for students/teachers)
    if user_data.role in {"student", "teacher"} and user_data.student_id:
        existing_user_id = db.query(User).filter(User.student_id == user_data.student_id).first()
        if existing_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User ID already registered"
            )
    
    # Create new user
    hashed_password = get_password_hash(user_data.password)
    db_user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        role=user_data.role.lower(),
        department=user_data.department,
        class_year=user_data.class_year,
        student_id=user_data.student_id if user_data.role.lower() in {"student", "teacher"} else None,
        phone_number=user_data.phone_number
    )
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    return db_user

@router.post("/bulk-upload", dependencies=[Depends(require_role(["admin", "teacher"]))])
def bulk_upload_users(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Bulk upload users from CSV file. Teachers can only upload students.
    Expected CSV format: role,first_name,last_name,email,password,phone_number,student_id,department,class_year
    """
    if not file.filename.endswith(('.csv', '.xlsx', '.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only CSV and Excel files are supported"
        )
    
    try:
        contents = file.file.read()
        if len(contents) > 5 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File too large (max 5MB)"
            )
        
        # Handle CSV files
        if file.filename.endswith('.csv'):
            decoded = contents.decode('utf-8')
            csv_reader = csv.DictReader(io.StringIO(decoded))
        else:
            # For Excel files, we'll need openpyxl or pandas
            # For now, return error for Excel
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Excel file support requires openpyxl. Please use CSV format."
            )
        
        created_users = []
        errors = []
        seen_emails = set()
        seen_student_ids = set()
        
        for row_num, row in enumerate(csv_reader, start=2):  # start=2 because row 1 is header
            try:
                # Validate required fields
                required_fields = ['role', 'first_name', 'last_name', 'email', 'password']
                missing_fields = [field for field in required_fields if not row.get(field, '').strip()]
                
                if missing_fields:
                    errors.append({
                        "row": row_num,
                        "error": f"Missing required fields: {', '.join(missing_fields)}"
                    })
                    continue
                
                role = row['role'].strip().lower()
                if role not in {"admin", "teacher", "student"}:
                    errors.append({
                        "row": row_num,
                        "error": "Invalid role (must be admin, teacher, or student)"
                    })
                    continue

                if current_user.role == "teacher" and role != "student":
                    errors.append({
                        "row": row_num,
                        "error": "Teachers can only bulk-upload students"
                    })
                    continue
                email = row['email'].strip()

                if email in seen_emails:
                    errors.append({
                        "row": row_num,
                        "email": email,
                        "error": "Duplicate email in upload file"
                    })
                    continue
                
                # Check if email already exists
                if db.query(User).filter(User.email == email).first():
                    errors.append({
                        "row": row_num,
                        "email": email,
                        "error": "Email already registered"
                    })
                    continue
                
                # For students, check student_id
                student_id = row.get('student_id', '').strip() if role == 'student' else None
                if role == 'student':
                    if not student_id:
                        errors.append({
                            "row": row_num,
                            "email": email,
                            "error": "Student ID is required for students"
                        })
                        continue

                    if student_id in seen_student_ids:
                        errors.append({
                            "row": row_num,
                            "email": email,
                            "student_id": student_id,
                            "error": "Duplicate student ID in upload file"
                        })
                        continue
                    
                    if db.query(User).filter(User.student_id == student_id).first():
                        errors.append({
                            "row": row_num,
                            "email": email,
                            "student_id": student_id,
                            "error": "Student ID already registered"
                        })
                        continue
                
                # Create user
                hashed_password = get_password_hash(row['password'].strip())
                new_user = User(
                    email=email,
                    hashed_password=hashed_password,
                    first_name=row['first_name'].strip(),
                    last_name=row['last_name'].strip(),
                    role=role,
                    department=row.get('department', '').strip() or None,
                    class_year=row.get('class_year', '').strip() or None,
                    student_id=student_id,
                    phone_number=row.get('phone_number', '').strip() or None
                )
                
                db.add(new_user)
                seen_emails.add(email)
                if student_id:
                    seen_student_ids.add(student_id)
                created_users.append({
                    "email": email,
                    "name": f"{new_user.first_name} {new_user.last_name}",
                    "role": role
                })
                
            except Exception as e:
                errors.append({
                    "row": row_num,
                    "error": "Invalid row data"
                })
        
        # Commit all users at once
        if created_users:
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Upload contains duplicate or conflicting user data"
                )
        
        return {
            "success": True,
            "created_count": len(created_users),
            "error_count": len(errors),
            "created_users": created_users,
            "errors": errors
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process file"
        )

@router.get("/", response_model=List[UserResponse], dependencies=[Depends(require_role(["admin", "teacher"]))])
def get_all_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=300),
    role: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    query = db.query(User)
    
    # Teachers can only see students
    if current_user.role == "teacher":
        query = query.filter(User.role == "student")
    elif role:
        query = query.filter(User.role == role.lower())
    
    users = query.order_by(User.created_at.desc(), User.id.desc()).offset(skip).limit(limit).all()
    return users

@router.get("/me", response_model=UserResponse)
def get_current_user_info(
    current_user: User = Depends(get_current_active_user)
):
    return current_user


@router.put("/me", response_model=UserResponse)
def update_current_user_info(
    user_data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    update_data = user_data.model_dump(exclude_unset=True)

    # Prevent role/identity privilege escalation through profile updates.
    disallowed_fields = {"is_active", "student_id", "department", "class_year", "password"}
    for field in disallowed_fields:
        update_data.pop(field, None)

    if "profile_image" in update_data:
        image_value = update_data.get("profile_image")
        if image_value:
            if not isinstance(image_value, str):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid profile image format")
            if len(image_value) > 3_000_000:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile image is too large")
        else:
            update_data["profile_image"] = None

    allowed_fields = {"first_name", "last_name", "phone_number", "profile_image"}
    for field, value in update_data.items():
        if field in allowed_fields:
            setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return current_user

@router.get("/{user_id}", response_model=UserResponse, dependencies=[Depends(require_role(["admin", "teacher"]))])
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Teachers can only view students in their department
    if current_user.role == "teacher":
        if user.role != "student":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view student profiles"
            )
        if current_user.department and user.department != current_user.department:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view students in your department"
            )
    
    return user

@router.put("/{user_id}", response_model=UserResponse, dependencies=[Depends(require_role(["admin"]))])
def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    update_data = user_data.model_dump(exclude_unset=True)

    # Handle password updates safely
    new_password = update_data.pop("password", None)
    if new_password:
        user.hashed_password = get_password_hash(new_password)

    # Handle user ID updates for students/teachers
    new_user_id = update_data.pop("student_id", None)
    if new_user_id is not None:
        normalized_user_id = new_user_id.strip() if isinstance(new_user_id, str) else new_user_id
        if user.role in {"student", "teacher"}:
            if normalized_user_id:
                duplicate_user_id = db.query(User).filter(
                    User.student_id == normalized_user_id,
                    User.id != user.id
                ).first()
                if duplicate_user_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="User ID already registered"
                    )
                user.student_id = normalized_user_id
            else:
                user.student_id = None

    # Only allow a safe subset of fields to be updated
    allowed_fields = {
        "first_name",
        "last_name",
        "department",
        "class_year",
        "phone_number",
        "profile_image",
        "is_active",
    }
    for field, value in update_data.items():
        if field in allowed_fields:
            setattr(user, field, value)
    
    db.commit()
    db.refresh(user)
    
    return user

@router.delete("/{user_id}", dependencies=[Depends(require_role(["admin"]))])
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Prevent deleting privileged users that still own data
    if user.role in {"admin", "teacher"}:
        has_owned_quizzes = db.query(Quiz.id).filter(Quiz.creator_id == user.id).first() is not None
        has_owned_subjects = db.query(Subject.id).filter(Subject.creator_id == user.id).first() is not None
        has_owned_questions = db.query(QuestionBank.id).filter(QuestionBank.creator_id == user.id).first() is not None
        if has_owned_quizzes or has_owned_subjects or has_owned_questions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete this user because they have related created records"
            )

    # Student cleanup: remove dependent records first to avoid FK failures.
    if user.role == "student":
        attempt_ids = [
            attempt_id
            for (attempt_id,) in db.query(QuizAttempt.id).filter(QuizAttempt.student_id == user.id).all()
        ]
        if attempt_ids:
            db.query(Answer).filter(Answer.attempt_id.in_(attempt_ids)).delete(synchronize_session=False)
            db.query(QuizAttempt).filter(QuizAttempt.student_id == user.id).delete(synchronize_session=False)
        db.query(QuizAssignment).filter(QuizAssignment.student_id == user.id).delete(synchronize_session=False)
    
    try:
        db.delete(user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete user due to related records"
        )
    
    return {"message": "User deleted successfully"}

@router.get("/activity/teachers", response_model=List[UserActivityResponse], dependencies=[Depends(require_role(["admin"]))])
def get_teacher_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    teachers = db.query(User).filter(User.role == "teacher").all()
    return [
        {
            "id": teacher.id,
            "name": f"{teacher.first_name} {teacher.last_name}",
            "email": teacher.email,
            "role": teacher.role,
            "department": teacher.department,
            "class_year": teacher.class_year,
            "student_id": teacher.student_id,
            "last_active": teacher.last_active,
            "is_active": teacher.is_active,
        }
        for teacher in teachers
    ]

@router.get("/activity/students", response_model=List[UserActivityResponse], dependencies=[Depends(require_role(["admin"]))])
def get_student_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    students = db.query(User).filter(User.role == "student").all()
    return [
        {
            "id": student.id,
            "name": f"{student.first_name} {student.last_name}",
            "email": student.email,
            "role": student.role,
            "department": student.department,
            "class_year": student.class_year,
            "student_id": student.student_id,
            "last_active": student.last_active,
            "is_active": student.is_active,
        }
        for student in students
    ]
