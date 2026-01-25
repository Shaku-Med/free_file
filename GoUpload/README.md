# GoUpload

Go upload server running on port 3003 by default.

## Run

```
go run ./cmd/server
```

## Auto refresh

```
go install github.com/air-verse/air@latest
air
```

## Endpoints

```
GET  /health
POST /upload  multipart form field "file"
```