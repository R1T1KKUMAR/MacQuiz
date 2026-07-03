#!/bin/bash
# MacQuiz Backend Setup Script for EC2
# Run this on your EC2 instance after copying the backend folder

echo "========================================="
echo "  MacQuiz Backend EC2 Setup"
echo "========================================="

# Update system
echo "📦 Updating system packages..."
sudo apt update -y

# Install Python and pip if not present
echo "🐍 Installing Python dependencies..."
sudo apt install -y python3 python3-pip python3-venv

# Install MySQL client
echo "🗄️ Installing MySQL client..."
sudo apt install -y default-libmysqlclient-dev

# Create virtual environment
echo "🔧 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install Python packages
echo "📥 Installing Python packages..."
pip install --upgrade pip
pip install -r requirements.txt

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << 'EOF'
DATABASE_URL=mysql+pymysql://root:YOUR_DB_PASSWORD@localhost:3306/quizapp_db
SECRET_KEY=your-super-secret-key-change-this-in-production-12345
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
CORS_ORIGINS=http://localhost:5173,http://3.110.145.152,http://3.110.145.152:5173,http://3.110.145.152:8000,https://macquiz.vercel.app
ADMIN_EMAIL=admin@macquiz.com
ADMIN_PASSWORD=admin123
EOF
    echo "⚠️  Please edit .env and set your actual DATABASE_URL password!"
fi

# Open firewall port
echo "🔓 Opening port 8000 in firewall..."
sudo ufw allow 8000
sudo ufw allow 22
sudo ufw --force enable

# Create systemd service for auto-start
echo "⚙️ Creating systemd service..."
sudo tee /etc/systemd/system/macquiz.service > /dev/null << EOF
[Unit]
Description=MacQuiz Backend API
After=network.target

[Service]
User=$USER
WorkingDirectory=$(pwd)
Environment="PATH=$(pwd)/venv/bin"
ExecStart=$(pwd)/venv/bin/python -m uvicorn app.main:socket_app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
echo "🚀 Starting MacQuiz service..."
sudo systemctl daemon-reload
sudo systemctl enable macquiz
sudo systemctl start macquiz

# Check status
echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "Service status:"
sudo systemctl status macquiz --no-pager

echo ""
echo "📍 Your backend should now be accessible at:"
echo "   http://3.110.145.152:8000"
echo "   http://3.110.145.152:8000/docs"
echo ""
echo "⚠️  IMPORTANT: Make sure AWS Security Group allows port 8000!"
echo "   Go to: EC2 → Security Groups → Edit Inbound Rules"
echo "   Add: Custom TCP, Port 8000, Source 0.0.0.0/0"
echo ""
echo "📋 Useful commands:"
echo "   sudo systemctl status macquiz  - Check status"
echo "   sudo systemctl restart macquiz - Restart backend"
echo "   sudo journalctl -u macquiz -f  - View logs"
