import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSampleVideoFile } from '../utils/sampleVideo';

describe('sampleVideo', () => {
  it('provides a decodable MP4 sample for the real upload-render workflow', async () => {
    const sample = createSampleVideoFile();
    const bytes = Buffer.from(await readFileAsArrayBuffer(sample));
    const tempDir = mkdtempSync(join(tmpdir(), 'sdkwork-video-cut-sample-'));
    const samplePath = join(tempDir, sample.name);
    const subtitlePath = join(tempDir, 'subtitles.ass');
    const outputPath = join(tempDir, 'rendered-output.mp4');

    try {
      writeFileSync(samplePath, bytes);
      writeFileSync(subtitlePath, sampleSubtitleAss(), 'utf8');

      expect(sample.name).toBe('interview.mp4');
      expect(sample.type).toBe('video/mp4');
      expect(bytes.byteLength).toBeGreaterThan(5_000);
      execFileSync(
        'ffmpeg',
        ['-hide_banner', '-v', 'error', '-xerror', '-i', samplePath, '-frames:v', '1', '-f', 'null', '-'],
        { stdio: 'pipe' },
      );
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'warning',
          '-y',
          '-i',
          samplePath,
          '-ss',
          '0',
          '-t',
          '2',
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-vf',
          `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,subtitles=filename='${escapeFilterPath(
            subtitlePath,
          )}':charenc=UTF-8`,
          '-af',
          'loudnorm=I=-16:TP=-1.5:LRA=11,afftdn',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        { stdio: 'pipe' },
      );
      expect(statSync(outputPath).size).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

function sampleSubtitleAss(): string {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,0,2,60,60,160,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,SDKWork Video Cut sample
`;
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/,/g, '\\,');
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read sample video.')));
    reader.addEventListener('load', () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }

      reject(new Error('Sample video did not read as ArrayBuffer.'));
    });
    reader.readAsArrayBuffer(file);
  });
}
