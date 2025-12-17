# Redis Docker Setup

## Step 1: Install Docker Desktop

1. **Download Docker Desktop for Windows:**
   - Go to: https://www.docker.com/products/docker-desktop/
   - Download and install Docker Desktop
   - Restart your computer when prompted

2. **Verify Installation:**
   ```powershell
   docker --version
   docker compose version
   ```

## Step 2: Start Redis Container

Once Docker is installed, run:

```powershell
# Navigate to the app directory
cd free_file\app

# Start Redis using docker-compose
docker compose up -d

# Or if using older docker-compose command:
docker-compose up -d
```

## Step 3: Verify Redis is Running

```powershell
# Check if Redis container is running
docker ps

# Test Redis connection
docker exec -it redis-upload-queue redis-cli ping
# Should return: PONG
```

## Step 4: Stop Redis (when needed)

```powershell
# Stop Redis
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

## Quick Commands

```powershell
# Start Redis
docker compose up -d

# View Redis logs
docker compose logs redis

# Stop Redis
docker compose down

# Restart Redis
docker compose restart redis

# Access Redis CLI
docker exec -it redis-upload-queue redis-cli
```

## Configuration

The Redis container is configured with:
- **Port:** 6379 (default Redis port)
- **Persistence:** Data saved to volume `redis-data`
- **Health Check:** Automatic health monitoring
- **Auto-restart:** Container restarts automatically if it stops

## Environment Variables

Your application will connect to Redis at:
- **Host:** localhost (or 127.0.0.1)
- **Port:** 6379
- **No password required** (for local development)

## Troubleshooting

### Issue: "docker: command not found"
- Make sure Docker Desktop is installed and running
- Check system tray for Docker icon
- Restart your terminal/PowerShell

### Issue: Port 6379 already in use
```powershell
# Check what's using port 6379
netstat -ano | findstr :6379

# Or change the port in docker-compose.yml:
# ports:
#   - "6380:6379"  # Use 6380 instead
```

### Issue: Container won't start
```powershell
# Check logs
docker compose logs redis

# Remove and recreate
docker compose down -v
docker compose up -d
```

