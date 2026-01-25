#!/bin/bash

# Cleanup script for GoUpload server
# Removes temporary files, assembled outputs, HLS files, and thumbnails

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== GoUpload Cleanup Script ==="
echo "Working directory: $SCRIPT_DIR"
echo ""

# Function to safely remove directory contents
cleanup_dir() {
    local dir="$1"
    local name="$2"
    
    if [ -d "$dir" ]; then
        local size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "0")
        local count=$(find "$dir" -type f 2>/dev/null | wc -l || echo "0")
        echo "Cleaning $name: $count files, $size"
        rm -rf "$dir"/*
        echo "  Done."
    else
        echo "Skipping $name: directory does not exist"
    fi
}

# Cleanup directories
cleanup_dir "upload/chunks" "Chunks (temporary upload chunks)"
cleanup_dir "upload/assembled" "Assembled (assembled files before processing)"
cleanup_dir "upload/temp_processing" "Temp Processing (temporary processing files)"
cleanup_dir "upload/hls" "HLS (HLS converted videos)"
cleanup_dir "upload/thumbnails" "Thumbnails (extracted video thumbnails)"
cleanup_dir "upload/temp" "Temp (miscellaneous temp files)"

echo ""
echo "=== Cleanup Complete ==="

# Show remaining disk space
if command -v df &> /dev/null; then
    echo ""
    echo "Disk space:"
    df -h "$SCRIPT_DIR" 2>/dev/null | tail -1
fi
