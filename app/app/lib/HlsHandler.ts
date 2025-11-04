
declare global {
  interface Window {
    createHLSConverter?: any;
    FFmpeg?: any;
    Hls?: any;
  }
}


export const convertToHLS = async (file: File, callBack: (ratio: number) => void): Promise<{ m3u8Url: string, segmentUrls: { blob: Blob, name: string }[] }> => {
  if (!file || !window.FFmpeg) return { m3u8Url: '', segmentUrls: [] as { blob: Blob, name: string }[] };

  const ffmpeg = window.FFmpeg.createFFmpeg({ 
    log: false,
    progress: ({ratio}: {ratio: number}) => {
      callBack(ratio);
    }
  });
  
  try {
    await ffmpeg.load();

    const timestamp = Date.now();
    const inputFileName = `input_${timestamp}.mp4`;
    const outputFileName = `output_${timestamp}.m3u8`;
    const segmentPattern = `segment_${timestamp}_%03d.ts`;

    await ffmpeg.FS("writeFile", inputFileName, new Uint8Array(await file.arrayBuffer()));
    
    // await ffmpeg.run(
    //   '-i', inputFileName,
    //   '-c', 'copy',
    //   '-hls_time', '10',
    //   '-hls_list_size', '0',
    //   '-hls_segment_filename', segmentPattern,
    //   '-hls_flags', 'independent_segments',
    //   '-hls_allow_cache', '0',
    //   '-hls_start_number_source', '0',
    //   '-f', 'hls',
    //   outputFileName
    // );

    await ffmpeg.run(
      '-i', inputFileName,
      '-c:v', 'libx264',           // Re-encode video to ensure compatibility
      '-c:a', 'aac',               // Re-encode audio to AAC
      '-b:v', '2000k',             // Video bitrate
      '-b:a', '128k',              // Audio bitrate
      '-hls_time', '10',
      '-hls_list_size', '0',
      '-hls_segment_filename', segmentPattern,
      '-hls_flags', 'independent_segments',
      '-hls_allow_cache', '0',
      '-hls_start_number_source', '0',
      '-f', 'hls',
      outputFileName
    );
    
    const filesAfterConversion = ffmpeg.FS('readdir', '/');
    if (!filesAfterConversion.includes(outputFileName)) {
      console.error('FFmpeg did not create the m3u8 file');
      await ffmpeg.run(
        '-i', inputFileName,
        '-c', 'copy',
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_segment_filename', segmentPattern,
        '-hls_flags', 'independent_segments',
        '-hls_allow_cache', '0',
        '-hls_start_number_source', '0',
        '-f', 'hls',
        outputFileName
      );
    }

    // ----
    const m3u8Data = ffmpeg.FS("readFile", outputFileName);
    const m3u8Content = new TextDecoder().decode(m3u8Data);
    
    const correctedM3u8Content = m3u8Content
      .replace(/#EXT-X-VERSION:3/g, '#EXT-X-VERSION:3')
      .replace(/#EXT-X-TARGETDURATION:(\d+)/g, (match, duration) => {
        const targetDuration = Math.ceil(parseFloat(duration));
        return `#EXT-X-TARGETDURATION:${targetDuration}`;
      });
    
    const blob = new Blob([correctedM3u8Content], { type: "application/vnd.apple.mpegurl" });

    const files = ffmpeg.FS('readdir', '/');
    console.log('All files in FFmpeg FS:', files);
    
    const segmentFiles = files.filter((file: any) => file.startsWith(`segment_${timestamp}_`) && file.endsWith('.ts'));
    console.log('Found segment files:', segmentFiles);

    let segmentUrls: { blob: Blob, name: string }[] = [];
    for (const segFile of segmentFiles) {
      try {
        const segData = ffmpeg.FS('readFile', segFile);
        const segBlob = new Blob([segData.buffer], { type: 'video/mp2t' });
        segmentUrls.push({
          blob: segBlob,
          name: segFile,
        });
        console.log(`Successfully processed segment: ${segFile}, size: ${segBlob.size} bytes`);
      } catch (error) {
        console.error(`Failed to read segment ${segFile}:`, error);
      }
    }
    
    console.log(`Total segments found: ${segmentUrls.length}`);

    const result = {
      m3u8Url: URL.createObjectURL(blob),
      segmentUrls: [{ blob: blob, name: `${file.name}.m3u8` }, ...segmentUrls],
    };

    // Proactively clear FFmpeg in-memory files now that blobs are prepared
    try {
      const filesNow = ffmpeg.FS('readdir', '/');
      const filesToDeleteNow = filesNow.filter((file: any) =>
        file.startsWith(`input_${timestamp}`) ||
        file.startsWith(`output_${timestamp}`) ||
        file.startsWith(`segment_${timestamp}_`) ||
        file === 'input.mp4' ||
        file === 'output.m3u8' ||
        file.endsWith('.ts')
      );
      for (const f of filesToDeleteNow) {
        try { ffmpeg.FS('unlink', f); } catch (err) { /* ignore */ }
      }
    } catch (err) {
      console.warn('Early FFmpeg FS cleanup failed:', err);
    }

    return result;
  } finally {
    try {
      const files = ffmpeg.FS('readdir', '/');
      const filesToDelete = files.filter((file: any) => 
        file.startsWith('input_') || 
        file.startsWith('output_') || 
        file.startsWith('segment_') ||
        file === 'input.mp4' ||
        file === 'output.m3u8' ||
        file.endsWith('.ts')
      );
      
      for (const file of filesToDelete) {
        try {
          ffmpeg.FS("unlink", file);
        } catch (error) {
          console.warn(`Failed to delete file ${file}:`, error);
        }
      }
      
      ffmpeg.exit();
    } catch (error) {
      console.warn('Error during FFmpeg cleanup:', error);
    }
  }
};