
declare global {
  interface Window {
    createHLSConverter?: any;
    FFmpeg?: any;
    Hls?: any;
  }
}


export const convertToHLS = async (file: File): Promise<{ m3u8Url: string, segmentUrls: { blob: Blob, name: string }[] }> => {
  if (!file || !window.FFmpeg) return { m3u8Url: '', segmentUrls: [] as { blob: Blob, name: string }[] };

  const ffmpeg = window.FFmpeg.createFFmpeg({ log: true });
  await ffmpeg.load();

  await ffmpeg.FS("writeFile", "input.mp4", new Uint8Array(await file.arrayBuffer()));
  await ffmpeg.run(
    '-i', 'input.mp4',
    '-c', 'copy',
    '-c:v', 'libx264',
    '-c:a', 'copy',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-maxrate', '2M',
    '-bufsize', '4M',
    '-g', '30',
    '-keyint_min', '30',
    '-sc_threshold', '0',
    '-hls_time', '10',
    '-hls_list_size', '0',
    '-hls_segment_filename', 'segment%03d.ts',
    '-hls_flags', 'independent_segments',
    '-f', 'hls',
    'output.m3u8'
  );

  const m3u8Data = ffmpeg.FS("readFile", "output.m3u8");
  const m3u8Content = new TextDecoder().decode(m3u8Data);
  
  const correctedM3u8Content = m3u8Content
    .replace(/#EXT-X-VERSION:3/g, '#EXT-X-VERSION:3')
    .replace(/#EXT-X-TARGETDURATION:(\d+)/g, (match, duration) => {
      const targetDuration = Math.ceil(parseFloat(duration));
      return `#EXT-X-TARGETDURATION:${targetDuration}`;
    });
  
  const blob = new Blob([correctedM3u8Content], { type: "application/vnd.apple.mpegurl" });

  const files = ffmpeg.FS('readdir', '/');
  const segmentFiles = files.filter((file: any) => file.startsWith('segment') && file.endsWith('.ts'));

  let segmentUrls: { blob: Blob, name: string }[] = [];
  for (const segFile of segmentFiles) {
    const segData = ffmpeg.FS('readFile', segFile);
    const segBlob = new Blob([segData.buffer], { type: 'video/mp2t' });
    segmentUrls.push({
      blob: segBlob,
      name: segFile,
    });
  }

  return {
    m3u8Url: URL.createObjectURL(blob),
    segmentUrls: [{ blob: blob, name: `${file.name}.m3u8` }, ...segmentUrls],
  };
};