# Start MacQuiz Backend Server
# This script starts the backend server accessible on all network interfaces

Write-Host "========================================" -ForegroundColor Blue
Write-Host "  MacQuiz Backend Server" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""

# Change to backend directory
Set-Location $PSScriptRoot

Write-Host "Starting backend server on 0.0.0.0:8000..." -ForegroundColor Green
Write-Host "Backend will be accessible on:" -ForegroundColor Yellow
Write-Host "  - http://localhost:8000" -ForegroundColor Yellow
Write-Host "  - http://172.16.8.154:8000" -ForegroundColor Yellow
Write-Host "  - API Docs: http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host ""

# Start uvicorn with all network interfaces (without reload to prevent shutdowns)
$pythonExe = $null
if (Test-Path ".\\venv312\\Scripts\\python.exe") {
	$pythonExe = ".\\venv312\\Scripts\\python.exe"
} elseif (Test-Path ".\\venv\\Scripts\\python.exe") {
	$pythonExe = ".\\venv\\Scripts\\python.exe"
} else {
	$pythonExe = "python"
}

& $pythonExe -m uvicorn app.main:socket_app --host 0.0.0.0 --port 8000
