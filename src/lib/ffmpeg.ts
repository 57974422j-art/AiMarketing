// FFmpeg 视频处理模块

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 常见 FFmpeg 安装路径
const commonFFmpegPaths = process.platform === 'win32' ? [
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\ProgramData\\winget\\Packages\\Gyan.FFmpeg\\bin\\ffmpeg.exe',
  'C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
  process.env.LOCALAPPDATA + '\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
  'ffmpeg', // PATH 中的 ffmpeg
] : [
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg', // macOS ARM
  'ffmpeg',
];

// 获取 FFmpeg 路径
function getFFmpegPath(): string {
  // 优先使用环境变量
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }
  
  // 遍历常见路径
  for (const path of commonFFmpegPaths) {
    if (path && existsSync(path)) {
      return path;
    }
  }
  
  return 'ffmpeg'; // 默认返回
}

// 检查 FFmpeg 是否安装
export function checkFFmpeg(): boolean {
  try {
    const ffmpegPath = getFFmpegPath();
    execSync(`"${ffmpegPath}" -version`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// 确保输出目录存在
function ensureOutputDir(outputPath: string) {
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
}

// 视频裁剪
export function trimVideo(input: string, startTime: number, duration: number, output: string): void {
  const ffmpegPath = getFFmpegPath();
  ensureOutputDir(output);
  const command = `"${ffmpegPath}" -i "${input}" -ss ${startTime} -t ${duration} -c copy "${output}"`;
  execSync(command, { stdio: 'inherit' });
}

// 视频拼接/混剪
export function concatVideos(inputs: string[], output: string): void {
  const ffmpegPath = getFFmpegPath();
  ensureOutputDir(output);
  
  // 创建输入文件列表
  const inputListPath = join(__dirname, '..', '..', 'temp', 'inputlist.txt');
  ensureOutputDir(inputListPath);
  
  // 生成输入列表文件
  const fs = require('fs');
  const inputListContent = inputs.map(input => `file '${input}'`).join('\n');
  fs.writeFileSync(inputListPath, inputListContent);
  
  const command = `"${ffmpegPath}" -f concat -safe 0 -i "${inputListPath}" -c copy "${output}"`;
  execSync(command, { stdio: 'inherit' });
  
  // 清理临时文件
  fs.unlinkSync(inputListPath);
}

// 添加字幕
export function addTextOverlay(input: string, text: string, position: string, output: string): void {
  const ffmpegPath = getFFmpegPath();
  ensureOutputDir(output);
  
  // 位置映射
  const positionMap: Record<string, string> = {
    'top-left': '10:10',
    'top-center': '(w-text_w)/2:10',
    'top-right': 'w-text_w-10:10',
    'bottom-left': '10:h-text_h-10',
    'bottom-center': '(w-text_w)/2:h-text_h-10',
    'bottom-right': 'w-text_w-10:h-text_h-10',
    'center': '(w-text_w)/2:(h-text_h)/2'
  };
  
  const pos = positionMap[position] || positionMap['bottom-center'];
  const command = `"${ffmpegPath}" -i "${input}" -vf "drawtext=text='${text}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:x=${pos}" -c:a copy "${output}"`;
  execSync(command, { stdio: 'inherit' });
}

// 调整分辨率
export function resizeVideo(input: string, width: number, height: number, output: string): void {
  const ffmpegPath = getFFmpegPath();
  ensureOutputDir(output);
  const command = `"${ffmpegPath}" -i "${input}" -vf "scale=${width}:${height}" "${output}"`;
  execSync(command, { stdio: 'inherit' });
}


