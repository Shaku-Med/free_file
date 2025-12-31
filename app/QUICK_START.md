# Quick Start Guide - Docker & Kubernetes

## 🐳 Docker Quick Start

### 1. Build and Run with Docker Compose

```powershell
cd free_file\app

# Make sure you have a .env file
# Start everything
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

### 2. Build Docker Image

```powershell
docker build -t free-file-app:latest .
```

### 3. Run Container Manually

```powershell
# Run Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Run App (make sure .env exists)
docker run -d --name app -p 3000:3000 --env-file .env --link redis free-file-app:latest
```

---

## ☸️ Kubernetes Quick Start

### Prerequisites

1. **Enable Kubernetes in Docker Desktop:**
   - Settings → Kubernetes → Enable Kubernetes

2. **Verify kubectl:**
   ```powershell
   kubectl version --client
   ```

### Deploy to Kubernetes

#### Option 1: Using Deployment Script (Recommended)

**Windows:**
```powershell
cd free_file\app\k8s
.\deploy.ps1 -Build
```

**Linux/Mac:**
```bash
cd free_file/app/k8s
chmod +x deploy.sh
./deploy.sh --build
```

#### Option 2: Manual Deployment

```powershell
cd free_file\app\k8s

# 1. Create namespace
kubectl apply -f namespace.yaml

# 2. Deploy Redis
kubectl apply -f redis/

# 3. Create secret from .env file
kubectl create secret generic app-secrets --from-env-file=../.env -n free-file

# 4. Deploy app
kubectl apply -f app/

# 5. Check status
kubectl get all -n free-file
```

### Access Your Application

```powershell
# Port forward to access locally
kubectl port-forward service/free-file-app 3000:80 -n free-file

# Then open: http://localhost:3000
```

---

## 📋 Required Environment Variables

Create a `.env` file in the `app` directory with:

```env
# Supabase
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key

# GitHub
GITHUB_TOKEN=your-github-token
GITHUB_OWNER=your-github-username

# Redis (for Kubernetes, these are set automatically)
REDIS_HOST=redis
REDIS_PORT=6379

# Add other environment variables your app needs
```

---

## 🔧 Common Commands

### Docker

```powershell
# Build
docker build -t free-file-app:latest .

# Run
docker compose up -d

# Logs
docker compose logs -f app
docker compose logs -f redis

# Stop
docker compose down

# Clean
docker compose down -v
```

### Kubernetes

```powershell
# Check status
kubectl get all -n free-file

# View logs
kubectl logs -f deployment/free-file-app -n free-file
kubectl logs -f deployment/redis -n free-file

# Scale
kubectl scale deployment/free-file-app --replicas=3 -n free-file

# Restart
kubectl rollout restart deployment/free-file-app -n free-file

# Port forward
kubectl port-forward service/free-file-app 3000:80 -n free-file

# Delete everything
kubectl delete namespace free-file
```

---

## 🚀 Production Deployment

### 1. Build and Push to Registry

```powershell
# Build
docker build -t your-registry.io/free-file-app:v1.0.0 .

# Push
docker push your-registry.io/free-file-app:v1.0.0
```

### 2. Update Kubernetes Deployment

Edit `k8s/app/deployment.yaml`:
```yaml
image: your-registry.io/free-file-app:v1.0.0
```

### 3. Deploy

```powershell
kubectl apply -f k8s/app/deployment.yaml
```

---

## 📚 More Information

- **Detailed Setup:** See [KUBERNETES_SETUP.md](./KUBERNETES_SETUP.md)
- **Kubernetes Manifests:** See [k8s/README.md](./k8s/README.md)
- **Redis Setup:** See [REDIS_DOCKER_SETUP.md](./REDIS_DOCKER_SETUP.md)

---

## 🆘 Troubleshooting

### Docker Issues

```powershell
# Check if containers are running
docker ps

# Check logs
docker compose logs

# Restart
docker compose restart
```

### Kubernetes Issues

```powershell
# Check pod status
kubectl get pods -n free-file

# Describe pod for errors
kubectl describe pod <pod-name> -n free-file

# Check events
kubectl get events -n free-file --sort-by='.lastTimestamp'
```

### Common Problems

1. **Port already in use:**
   - Change port in docker-compose.yml or service.yaml

2. **Image pull errors:**
   - Make sure image exists or use `imagePullPolicy: IfNotPresent`

3. **Redis connection issues:**
   - Verify Redis service is running: `kubectl get svc -n free-file`
   - Check Redis pod: `kubectl get pods -l app=redis -n free-file`

4. **Secret not found:**
   - Create secret: `kubectl create secret generic app-secrets --from-env-file=.env -n free-file`
