@echo off
REM GoUpload: full wipe of upload\ and tmp\ - frees all space, leaves no trace.
REM App recreates dirs on first use. Run from GoUpload project root.

echo === GoUpload Full Cleanup ===
echo Working directory: %~dp0
echo.

cd /d "%~dp0"

echo Wiping upload\ (chunks, assembled, temp_processing, hls, thumbnails)...
if exist "upload" rd /s /q "upload" 2>nul
echo   Gone.

echo Wiping tmp\ (air build, logs)...
if exist "tmp" rd /s /q "tmp" 2>nul
echo   Gone.

echo.
echo === Cleanup complete; all trace removed ===
pause
