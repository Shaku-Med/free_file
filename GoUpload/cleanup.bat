@echo off
REM Cleanup script for GoUpload server (Windows)
REM Removes temporary files, assembled outputs, HLS files, and thumbnails

echo === GoUpload Cleanup Script ===
echo Working directory: %~dp0
echo.

cd /d "%~dp0"

REM Cleanup directories
echo Cleaning Chunks (temporary upload chunks)...
if exist "upload\chunks" rd /s /q "upload\chunks" 2>nul
if not exist "upload\chunks" mkdir "upload\chunks"
echo   Done.

echo Cleaning Assembled (assembled files before processing)...
if exist "upload\assembled" rd /s /q "upload\assembled" 2>nul
if not exist "upload\assembled" mkdir "upload\assembled"
echo   Done.

echo Cleaning Temp Processing (temporary processing files)...
if exist "upload\temp_processing" rd /s /q "upload\temp_processing" 2>nul
if not exist "upload\temp_processing" mkdir "upload\temp_processing"
echo   Done.

echo Cleaning HLS (HLS converted videos)...
if exist "upload\hls" rd /s /q "upload\hls" 2>nul
if not exist "upload\hls" mkdir "upload\hls"
echo   Done.

echo Cleaning Thumbnails (extracted video thumbnails)...
if exist "upload\thumbnails" rd /s /q "upload\thumbnails" 2>nul
if not exist "upload\thumbnails" mkdir "upload\thumbnails"
echo   Done.

echo Cleaning Temp (miscellaneous temp files)...
if exist "upload\temp" rd /s /q "upload\temp" 2>nul
if not exist "upload\temp" mkdir "upload\temp"
echo   Done.

echo.
echo === Cleanup Complete ===
pause
