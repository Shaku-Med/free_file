# Upload Flow Verification

## How the Upload System Works

### 1. Job Submission
- Client uploads file → `/api/upload`
- Job is added to BullMQ queue
- Returns `jobId` immediately

### 2. Worker Processing (Automatic)
The worker automatically processes jobs from the queue:

**For Images:**
1. ✅ NSFW detection
2. ✅ Upload to GitHub (via FileUploader)
3. ✅ Insert record into Supabase `files` table
4. ✅ Returns success

**For Videos:**
1. ✅ Extract 10 thumbnails
2. ✅ Check each thumbnail for NSFW
3. ✅ Convert video to HLS format (m3u8 + segments)
4. ✅ Upload m3u8 file to GitHub → **Inserted into Supabase**
5. ✅ Upload all segment files (.ts) to GitHub → **NOT inserted into Supabase**
6. ✅ Upload all thumbnails to GitHub → **NOT inserted into Supabase**

## What Gets Stored in Supabase

Based on `FileService.uploadFile()` logic:

✅ **Stored in Supabase:**
- Images (image/jpeg, image/png, etc.)
- M3U8 files (application/vnd.apple.mpegurl)
- Files that don't start with `thumbnail_`

❌ **NOT Stored in Supabase:**
- Video segments (.ts files) - type: `video/mp2t`
- Thumbnails - filename starts with `thumbnail_`

## Verification Steps

### 1. Check if Worker is Running

```bash
# Check server logs for worker initialization
# Should see: "Upload worker initialization skipped" or worker started
```

### 2. Check Job Status

```bash
# GET /api/upload/queue-status?jobId=q6u7uaikl4hfwhos2myxa7
# Should return job state, progress, and result
```

### 3. Check GitHub Repository

```bash
# Verify files are uploaded to GitHub
# Path format: {date_folder}/{uniqueID}/{filename}
# Example: 15_01_2024/q6u7uaikl4hfwhos2myxa7/q6u7uaikl4hfwhos2myxa7.jpg
```

### 4. Check Supabase Database

```sql
-- Check if file record exists
SELECT * FROM files WHERE unique_id = 'q6u7uaikl4hfwhos2myxa7';

-- Should return:
-- - endpoint: GitHub file path
-- - filename: {uniqueID}.{extension}
-- - file_type: image/jpeg or application/vnd.apple.mpegurl
-- - is_adult: boolean (from NSFW detection)
-- - file_title: title from upload
-- - file_description: description from upload
```

### 5. Check Server Logs

Look for these log messages:
```
[Upload Worker] Starting job {jobId} for uniqueID: {uniqueID}
[Upload Worker] Image uploaded successfully for {uniqueID}. GitHub: {path}, Supabase ID: {id}
[Upload Worker] Job {jobId} completed successfully for {uniqueID}
```

## Common Issues

### Issue: Job shows "completed" but no files in GitHub/Supabase

**Possible causes:**
1. Worker not running (Redis not connected)
   - Check: `docker ps` - Redis should be running
   - Fix: `docker compose up -d` in `free_file/app`

2. Worker failed silently
   - Check server logs for errors
   - Look for `[Upload Worker]` messages

3. GitHub/Supabase errors
   - Check: GitHub token permissions
   - Check: Supabase connection
   - Check: Database schema matches (file_size is TEXT)

### Issue: Files in GitHub but not in Supabase

**Check:**
- File type must be `image/*` or `application/vnd.apple.mpegurl`
- Filename must NOT start with `thumbnail_`
- Check Supabase logs for insert errors

### Issue: Video uploaded but no m3u8 in Supabase

**Check:**
- M3U8 file should be uploaded with type `application/vnd.apple.mpegurl`
- Check if `shouldStoreInSupabase` condition is met
- Verify database insert didn't fail (check logs)

## Database Schema Notes

Your schema shows:
```sql
file_size text null
```

The code now converts `file.size` (number) to string:
```typescript
file_size: fileData.file.size.toString()
```

This should work correctly with PostgreSQL.

## Testing the Flow

1. **Upload an image:**
   ```bash
   # Should see in logs:
   [Upload Worker] Starting job...
   [Upload Worker] Image uploaded successfully...
   [Upload Worker] Job completed...
   ```

2. **Check GitHub:**
   - File should be at: `{date}/{uniqueID}/{uniqueID}.jpg`

3. **Check Supabase:**
   ```sql
   SELECT * FROM files WHERE unique_id = '{uniqueID}';
   ```

4. **Upload a video:**
   - Should see HLS conversion
   - M3U8 uploaded and inserted into Supabase
   - Segments uploaded to GitHub (not in Supabase)
   - Thumbnails uploaded to GitHub (not in Supabase)

