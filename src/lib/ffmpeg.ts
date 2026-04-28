// FFmpeg 视频处理模块

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 检查 FFmpeg 是否安装
function checkFFmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
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
  if (!checkFFmpeg()) {
    throw new Error('FFmpeg 未安装，请先安装 FFmpeg。安装命令：\nWindows: winget install Gyan.FFmpeg\nmacOS: brew install ffmpeg\nLinux: apt install ffmpeg');
  }

  ensureOutputDir(output);
  
  const command = `ffmpeg -i "${input}" -ss ${startTime} -t ${duration} -c copy "${output}"`;
  execSync(command, { stdio: 'inherit' });
}

// 视频拼接/混剪
export function concatVideos(inputs: string[], output: string): void {
  if (!checkFFmpeg()) {
    throw new Error('FFmpeg 未安装，请先安装 FFmpeg。安装命令：\nWindows: winget install Gyan.FFmpeg\nmacOS: brew install ffmpeg\nLinux: apt install ffmpeg');
  }

  ensureOutputDir(output);
  
  // 创建输入文件列表
  const inputListPath = join(__dirname, '..', '..', 'temp', 'inputlist.txt');
  ensureOutputDir(inputListPath);
  
  // 生成输入列表文件
  const fs = require('fs');
  const inputListContent = inputs.map(input => `file '${input}'`).join('\n');
  fs.writeFileSync(inputListPath, inputListContent);
  
  const command = `ffmpeg -f concat -safe 0 -i "${inputListPath}" -c copy "${output}"`;
  execSync(command, { stdio: 'inherit' });
  
  // 清理临时文件
  fs.unlinkSync(inputListPath);
}

// 添加字幕
export function addTextOverlay(input: string, text: string, position: string, output: string): void {
  if (!checkFFmpeg()) {
    throw new Error('FFmpeg 未安装，请先安装 FFmpeg。安装命令：\nWindows: winget install Gyan.FFmpeg\nmacOS: brew install ffmpeg\nLinux: apt install ffmpeg');
  }

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
  
  const command = `ffmpeg -i "${input}" -vf "drawtext=text='${text}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:x=${pos}" -c:a copy "${output}"`;
  execSync(command, { stdio: 'inherit' });
}

// 调整分辨率
export function resizeVideo(input: string, width: number, height: number, output: string): void {
  if (!checkFFmpeg()) {
    throw new Error('FFmpeg 未安装，请先安装 FFmpeg。安装命令：\nWindows: winget install Gyan.FFmpeg\nmacOS: brew install ffmpeg\nLinux: apt install ffmpeg');
  }

  ensureOutputDir(output);
  
  const command = `ffmpeg -i "${input}" -vf "scale=${width}:${height}" "${output}"`;
  execSync(command, { stdio: 'inherit' });
}

export { checkFFmpeg };