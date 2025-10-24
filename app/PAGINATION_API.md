# File Pagination API

## Endpoint
`GET /api/get`

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (1-based) |
| `limit` | number | 10 | Number of items per page (1-100) |
| `sortBy` | string | 'created_at' | Field to sort by (created_at, filename, file_size, file_type) |
| `sortOrder` | string | 'desc' | Sort order ('asc' or 'desc') |
| `fileType` | string | null | Filter by file type (e.g., 'image/', 'video/') |

## Response Format

```json
{
  "data": [
    {
      "id": "uuid",
      "created_at": "2024-01-01T00:00:00Z",
      "endpoint": "https://github.com/owner/repo/path/file.jpg",
      "filename": "file.jpg",
      "unique_id": "unique-id",
      "file_type": "image/jpeg",
      "file_size": 1024
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Example Requests

### Basic pagination
```
GET /api/get?page=1&limit=20
```

### Sort by filename ascending
```
GET /api/get?sortBy=filename&sortOrder=asc
```

### Filter by image files
```
GET /api/get?fileType=image/&page=2&limit=15
```

### Get all video files sorted by size
```
GET /api/get?fileType=video/&sortBy=file_size&sortOrder=desc
```

## Error Responses

### Invalid pagination parameters
```json
{
  "error": "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100"
}
```

### Invalid sort field
```json
{
  "error": "Invalid sortBy field. Must be one of: created_at, filename, file_size, file_type"
}
```

### Server error
```json
{
  "error": "Internal server error"
}
```
