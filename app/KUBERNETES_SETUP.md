# Kubernetes and Docker Setup Guide

This guide will help you set up Docker and Kubernetes for the Free File application.

## Prerequisites

- Docker Desktop (with Kubernetes enabled) OR a Kubernetes cluster
- kubectl installed and configured
- Basic knowledge of Kubernetes concepts

## Table of Contents

1. [Docker Setup](#docker-setup)
2. [Kubernetes Setup](#kubernetes-setup)
3. [Deployment Steps](#deployment-steps)
4. [Troubleshooting](#troubleshooting)

---

## Docker Setup

### 1. Install Docker Desktop

**Windows:**
1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
2. Install and restart your computer
3. Enable Kubernetes in Docker Desktop settings:
   - Open Docker Desktop
   - Go to Settings → Kubernetes
   - Check "Enable Kubernetes"
   - Click "Apply & Restart"

**Verify Installation:**
```powershell
docker --version
docker compose version
kubectl version --client
```

### 2. Build Docker Image

```powershell
# Navigate to the app directory
cd free_file\app

# Build the Docker image
docker build -t free-file-app:latest .

# Verify the image was created
docker images | grep free-file-app
```

### 3. Test with Docker Compose

```powershell
# Make sure you have a .env file in the app directory
# Start all services
docker compose up -d

# View logs
docker compose logs -f app
docker compose logs -f redis

# Check running containers
docker compose ps

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v
```

---

## Kubernetes Setup

### 1. Prepare Environment Variables

Create a `.env` file in the `app` directory with all required environment variables. Then create a Kubernetes secret:

```powershell
# Create secret from .env file
kubectl create secret generic app-secrets --from-env-file=.env -n free-file

# Or create secret manually
kubectl create secret generic app-secrets -n free-file \
  --from-literal=DATABASE_URL='your-db-url' \
  --from-literal=JWT_SECRET='your-jwt-secret' \
  # ... add other secrets
```

**Important:** Never commit `.env` files or secrets to version control!

### 2. Update Kubernetes Manifests

Before deploying, update the following files:

#### `k8s/app/deployment.yaml`
- Change `image: free-file-app:latest` to your container registry (e.g., `your-registry.io/free-file-app:v1.0.0`)
- Adjust `replicas` based on your needs
- Update resource limits if needed

#### `k8s/ingress.yaml`
- Change `host: your-domain.com` to your actual domain
- Update `ingressClassName` to match your ingress controller
- Configure TLS/SSL if needed

#### `k8s/redis/pvc.yaml`
- Update `storageClassName` to match your cluster's storage class
- Adjust storage size if needed

### 3. Deploy to Kubernetes

#### Option A: Using kubectl (Manual)

```powershell
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Deploy Redis
kubectl apply -f k8s/redis/pvc.yaml
kubectl apply -f k8s/redis/deployment.yaml
kubectl apply -f k8s/redis/service.yaml

# Create ConfigMap (update with your values first)
kubectl apply -f k8s/app/configmap.yaml

# Create Secret (from .env file)
kubectl create secret generic app-secrets --from-env-file=.env -n free-file

# Deploy Application
kubectl apply -f k8s/app/deployment.yaml
kubectl apply -f k8s/app/service.yaml

# Deploy Ingress (update with your domain first)
kubectl apply -f k8s/ingress.yaml
```

#### Option B: Using Kustomize

```powershell
# Install kustomize (if not already installed)
# Windows: choco install kustomize
# Or download from: https://kustomize.io/

# Apply all resources
kubectl apply -k k8s/

# Or build and apply
kubectl kustomize k8s/ | kubectl apply -f -
```

### 4. Verify Deployment

```powershell
# Check namespace
kubectl get namespace free-file

# Check pods
kubectl get pods -n free-file

# Check services
kubectl get services -n free-file

# Check deployments
kubectl get deployments -n free-file

# View pod logs
kubectl logs -f deployment/free-file-app -n free-file
kubectl logs -f deployment/redis -n free-file

# Describe resources for troubleshooting
kubectl describe pod <pod-name> -n free-file
kubectl describe deployment free-file-app -n free-file
```

### 5. Access the Application

#### Using Service (Local/Cluster Access)

```powershell
# Port forward to access locally
kubectl port-forward service/free-file-app 3000:80 -n free-file

# Access at http://localhost:3000
```

#### Using Ingress (External Access)

If you've configured an ingress controller:

```powershell
# Get ingress IP/domain
kubectl get ingress -n free-file

# Access via the configured domain
```

#### Using LoadBalancer (Cloud Providers)

If using a cloud provider with LoadBalancer support:

```powershell
# Get external IP
kubectl get service free-file-app -n free-file

# Access via the external IP
```

---

## Deployment Workflow

### Development Workflow

1. **Make code changes**
2. **Build Docker image:**
   ```powershell
   docker build -t free-file-app:latest .
   ```
3. **Test locally:**
   ```powershell
   docker compose up
   ```
4. **Push to registry (if using):**
   ```powershell
   docker tag free-file-app:latest your-registry.io/free-file-app:v1.0.0
   docker push your-registry.io/free-file-app:v1.0.0
   ```
5. **Update deployment:**
   ```powershell
   kubectl set image deployment/free-file-app app=your-registry.io/free-file-app:v1.0.0 -n free-file
   ```

### Production Workflow

1. **Build and tag image:**
   ```powershell
   docker build -t your-registry.io/free-file-app:v1.0.0 .
   docker push your-registry.io/free-file-app:v1.0.0
   ```

2. **Update deployment manifest:**
   - Update image tag in `k8s/app/deployment.yaml`
   - Apply changes: `kubectl apply -f k8s/app/deployment.yaml`

3. **Rolling update:**
   ```powershell
   kubectl rollout restart deployment/free-file-app -n free-file
   kubectl rollout status deployment/free-file-app -n free-file
   ```

---

## Scaling

### Horizontal Scaling

```powershell
# Scale application
kubectl scale deployment/free-file-app --replicas=3 -n free-file

# Or update replicas in deployment.yaml and apply
```

### Vertical Scaling

Update resource limits in `k8s/app/deployment.yaml`:

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "2000m"
```

---

## Troubleshooting

### Pods Not Starting

```powershell
# Check pod status
kubectl get pods -n free-file

# Describe pod for events
kubectl describe pod <pod-name> -n free-file

# Check logs
kubectl logs <pod-name> -n free-file
kubectl logs <pod-name> -n free-file --previous  # Previous container instance
```

### Image Pull Errors

```powershell
# If using local images with Docker Desktop Kubernetes
# Make sure to use imagePullPolicy: IfNotPresent or Never
# Or push to a registry accessible by your cluster
```

### Redis Connection Issues

```powershell
# Verify Redis is running
kubectl get pods -l app=redis -n free-file

# Test Redis connection from app pod
kubectl exec -it deployment/free-file-app -n free-file -- sh
# Inside pod: redis-cli -h redis ping
```

### Service Not Accessible

```powershell
# Check service endpoints
kubectl get endpoints -n free-file

# Verify service selector matches pod labels
kubectl get pods -l app=free-file-app -n free-file
kubectl get service free-file-app -n free-file -o yaml
```

### Storage Issues

```powershell
# Check PVC status
kubectl get pvc -n free-file

# Check storage class
kubectl get storageclass

# Describe PVC for events
kubectl describe pvc redis-pvc -n free-file
```

### Common Commands

```powershell
# Delete everything and start fresh
kubectl delete namespace free-file

# Restart a deployment
kubectl rollout restart deployment/free-file-app -n free-file

# View all resources in namespace
kubectl get all -n free-file

# Edit a resource
kubectl edit deployment free-file-app -n free-file

# Delete a resource
kubectl delete deployment free-file-app -n free-file
```

---

## Security Best Practices

1. **Secrets Management:**
   - Use Kubernetes secrets (not ConfigMaps) for sensitive data
   - Consider using external secret managers (AWS Secrets Manager, HashiCorp Vault)
   - Never commit secrets to version control

2. **Image Security:**
   - Use specific image tags (not `latest`)
   - Scan images for vulnerabilities
   - Use private registries

3. **Network Policies:**
   - Implement network policies to restrict pod-to-pod communication
   - Use service mesh for advanced networking (Istio, Linkerd)

4. **RBAC:**
   - Implement Role-Based Access Control
   - Use least privilege principle

5. **Resource Limits:**
   - Always set resource requests and limits
   - Monitor resource usage

---

## Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [Kustomize Documentation](https://kustomize.io/)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)

---

## Quick Reference

```powershell
# Start Docker Compose
docker compose up -d

# Build and push image
docker build -t free-file-app:latest .
docker tag free-file-app:latest your-registry.io/free-file-app:v1.0.0
docker push your-registry.io/free-file-app:v1.0.0

# Deploy to Kubernetes
kubectl apply -k k8s/

# Check status
kubectl get all -n free-file

# View logs
kubectl logs -f deployment/free-file-app -n free-file

# Port forward
kubectl port-forward service/free-file-app 3000:80 -n free-file

# Scale
kubectl scale deployment/free-file-app --replicas=3 -n free-file

# Update
kubectl set image deployment/free-file-app app=your-registry.io/free-file-app:v1.0.1 -n free-file

# Clean up
kubectl delete namespace free-file
```
