# QuizzApp-RBMI

A comprehensive Quiz Application with Role-Based Management Interface built with React (Frontend) and FastAPI (Backend).

## Features

### Admin Dashboard
- **User Management**: Create and manage teachers and students
- **Quiz Management**: Oversee all quizzes and assessments
- **Analytics Dashboard**: Real-time statistics and activity tracking
- **Teacher Activity Lookup**: Monitor teacher engagement and quiz creation
- **Student Activity Lookup**: Track student performance and participation
- **Detailed Reports**: AI-powered insights using Gemini API
- **Bulk User Upload**: Import users via Excel/CSV files

### Teacher Features
- Create and manage quizzes
- Multiple question types (MCQ, True/False, Short Answer)
- View student attempts and results
- Department and class-based filtering

### Student Features
- Browse and attempt available quizzes
- Instant result calculation
- Track quiz history and performance
- Department and class-specific quizzes

## Tech Stack

### Frontend
- **React** with Vite
- **React Router** for navigation
- **Tailwind CSS** for styling
- **Lucide React** for icons

### Backend
- **FastAPI** - Modern Python web framework
- **SQLAlchemy** - ORM for database management
- **SQLite** - Database (can be swapped for PostgreSQL in production)
- **JWT** - Authentication and authorization
- **Bcrypt** - Password hashing
- **Pydantic** - Data validation

## Project Structure

```
QuizzApp-RBMI/
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── pages/           # Login, Dashboard pages
│   │   ├── components/      # Reusable components
│   │   └── assets/          # Images, SVGs
│   └── package.json
│
└── backend/                  # FastAPI backend
    ├── app/
    │   ├── api/v1/          # API endpoints
    │   ├── core/            # Config, security
    │   ├── models/          # Database models
    │   ├── schemas/         # Pydantic schemas
    │   └── db/              # Database setup
    ├── .env                 # Environment variables
    ├── requirements.txt     # Python dependencies
    └── run.sh               # Quick start script
```

## Quick Start

### 🚀 One-Command Startup (Recommended)

**Windows:**
```batch
start.bat
```

**Linux/Mac:**
```bash
./start.sh
```

This will automatically:
- ✅ Check system requirements (Python 3 & Node.js)
- ✅ Create virtual environment for backend
- ✅ Install all dependencies (backend & frontend)
- ✅ Start backend server on http://localhost:8000
- ✅ Start frontend server on http://localhost:5173
- ✅ Open the application in your browser

**Note:** Press `Ctrl+C` to stop all servers

---

### Manual Setup (Alternative)

#### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Run the startup script (creates venv, installs dependencies, starts server):
```bash
./run.sh
```

Or manually:
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

3. Access the API:
- **API**: http://localhost:8000
- **API Docs (Swagger)**: http://localhost:8000/docs
- **API Docs (ReDoc)**: http://localhost:8000/redoc

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start development server:
```bash
npm run dev
```

4. Access the app:
- **Frontend**: http://localhost:5173

## Default Credentials

**Admin Login:**
- Email: `admin@macquiz.com`
- Password: `admin123`

⚠️ **Important**: Change these credentials in production!

## API Documentation

### Authentication
- `POST /api/v1/auth/login` - OAuth2 form login
- `POST /api/v1/auth/login-json` - JSON login

### User Management
- `POST /api/v1/users/` - Create user (Admin)
- `GET /api/v1/users/` - List all users (Admin)
- `GET /api/v1/users/me` - Get current user
- `GET /api/v1/users/{id}` - Get user by ID (Admin)
- `PUT /api/v1/users/{id}` - Update user (Admin)
- `DELETE /api/v1/users/{id}` - Delete user (Admin)
- `GET /api/v1/users/activity/teachers` - Teacher activity (Admin)
- `GET /api/v1/users/activity/students` - Student activity (Admin)

### Quiz Management
- `POST /api/v1/quizzes/` - Create quiz (Teacher/Admin)
- `GET /api/v1/quizzes/` - List quizzes
- `GET /api/v1/quizzes/{id}` - Get quiz details
- `PUT /api/v1/quizzes/{id}` - Update quiz (Teacher/Admin)
- `DELETE /api/v1/quizzes/{id}` - Delete quiz (Teacher/Admin)

### Quiz Attempts
- `POST /api/v1/attempts/start` - Start quiz attempt
- `POST /api/v1/attempts/submit` - Submit answers
- `GET /api/v1/attempts/my-attempts` - Get user attempts
- `GET /api/v1/attempts/quiz/{id}/attempts` - Get quiz attempts (Teacher/Admin)
- `GET /api/v1/attempts/stats/dashboard` - Dashboard stats (Admin)
- `GET /api/v1/attempts/stats/activity` - Recent activity (Admin)

### AI Reports
- `POST /api/v1/analytics/reports/ai-insights` - Generate AI-based insights (Gemini if configured, safe fallback otherwise)

See [backend/API_EXAMPLES.md](backend/API_EXAMPLES.md) for detailed API usage examples.

## Database Schema

### Users
- Authentication and profile information
- Roles: admin, teacher, student
- Student-specific: student_id, department, class_year

### Quizzes
- Title, description, creator
- Department and class filters
- Duration and marks configuration

### Questions
- Multiple types: MCQ, True/False, Short Answer
- Options and correct answers
- Individual marks allocation

### Quiz Attempts
- Student attempts tracking
- Score and percentage calculation
- Timing information

### Answers
- Student responses
- Correctness evaluation
- Marks awarded

## Development

### Backend Testing
```bash
cd backend
source venv/bin/activate
pytest  # (setup tests as needed)
```

### Frontend Testing
```bash
cd frontend
npm run test  # (setup tests as needed)
```

### Code Quality
```bash
# Backend
black app/
flake8 app/

# Frontend
npm run lint
```

## Production Deployment

### Backend Checklist
- [ ] Change `SECRET_KEY` in `.env`
- [ ] Change default admin credentials
- [ ] Use PostgreSQL instead of SQLite
- [ ] Configure proper CORS origins
- [ ] Enable HTTPS
- [ ] Set up logging and monitoring
- [ ] Configure rate limiting
- [ ] Use environment-specific configs

### Frontend Checklist
- [ ] Update API endpoint URLs
- [ ] Build for production: `npm run build`
- [ ] Configure proper CORS
- [ ] Set up CDN for static assets
- [ ] Enable HTTPS

### Docker Deployment (Optional)

Backend Dockerfile:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Frontend Dockerfile:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "run", "preview"]
```

## Environment Variables

### Backend (.env)
```env
DATABASE_URL=sqlite:///./quizapp.db
SECRET_KEY=your-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
ADMIN_EMAIL=admin@macquiz.com
ADMIN_PASSWORD=admin123
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:8000
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License 

This project is licensed under the MIT License.

## Support

For issues and questions:
- Check the [API Examples](backend/API_EXAMPLES.md)
- Check the [Backend README](backend/README.md)
- Create an issue in the repository

## Acknowledgments

- React and Vite teams for excellent frontend tools
- FastAPI team for the amazing Python framework
- Tailwind CSS for the utility-first CSS framework
- Lucide for beautiful icons
" 
