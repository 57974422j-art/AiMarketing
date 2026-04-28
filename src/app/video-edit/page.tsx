'use client';
import { useState, useRef, useCallback } from 'react';

interface VideoFile {
  file: File;
  name: string;
  size: string;
  duration: string;
  preview: string;
}

export default function VideoEditPage() {
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [template, setTemplate] = useState('mix');
  const [duration, setDuration] = useState(30);
  const [style, setStyle] = useState('dynamic');
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getVideoDuration = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve(formatDuration(video.duration));
        URL.revokeObjectURL(video.src);
      };
      video.onerror = () => {
        resolve('未知');
        URL.revokeObjectURL(video.src);
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    
    setErrorMessage('');
    const newVideos: VideoFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validExtensions = ['.mp4', '.mov', '.avi'];
      const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      
      if (!validExtensions.includes(extension)) {
        setErrorMessage(`文件 ${file.name} 格式不支持，仅支持 mp4、mov、avi 格式`);
        continue;
      }

      const duration = await getVideoDuration(file);
      const preview = URL.createObjectURL(file);

      newVideos.push({
        file,
        name: file.name,
        size: formatFileSize(file.size),
        duration,
        preview,
      });
    }

    setVideos(prev => [...prev, ...newVideos]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.remove('border-primary');
    }
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.add('border-primary');
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.remove('border-primary');
    }
  }, []);

  const removeVideo = (index: number) => {
    const videoToRemove = videos[index];
    URL.revokeObjectURL(videoToRemove.preview);
    setVideos(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllVideos = () => {
    videos.forEach(video => URL.revokeObjectURL(video.preview));
    setVideos([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (videos.length === 0) {
      setErrorMessage('请至少上传一个视频文件');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setOutputUrl('');
    setErrorMessage('');

    const formData = new FormData();
    videos.forEach(video => {
      formData.append('videos', video.file);
    });
    formData.append('template', template);
    formData.append('duration', duration.toString());
    formData.append('style', style);

    try {
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return 90;
          return prev + Math.random() * 15;
        });
      }, 500);

      const response = await fetch('/api/video', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();

      if (data.success) {
        setOutputUrl(data.outputUrl);
        setTimeout(() => setIsProcessing(false), 500);
      } else {
        setErrorMessage(data.message || '视频处理失败');
        setIsProcessing(false);
      }
    } catch (error) {
      setErrorMessage('上传失败，请检查网络连接或服务器状态');
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">视频批量剪辑</h1>

      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传视频
              <span className="text-gray-400 ml-2">支持 mp4、mov、avi 格式</span>
            </label>
            <div
              ref={dropZoneRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".mp4,.mov,.avi"
                className="hidden"
                id="video-upload"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
              <label htmlFor="video-upload" className="cursor-pointer text-primary hover:text-primary-dark">
                <div className="flex flex-col items-center">
                  <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span>点击或拖拽视频文件到此处</span>
                </div>
              </label>
            </div>
          </div>

          {videos.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-700">已上传 {videos.length} 个文件</h3>
                <button
                  type="button"
                  onClick={clearAllVideos}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  清空全部
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {videos.map((video, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4 flex items-center gap-4">
                    <video
                      src={video.preview}
                      className="w-20 h-12 object-cover rounded"
                      controls={false}
                      muted
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{video.name}</p>
                      <p className="text-xs text-gray-500">
                        {video.size} · {video.duration}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVideo(index)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                模板类型
              </label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="mix">混剪</option>
                <option value="quick">快剪</option>
                <option value="story">故事板</option>
                <option value="loop">循环</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                视频时长 (秒)
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Math.min(300, Number(e.target.value))))}
                min="1"
                max="300"
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                风格
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="dynamic">动感</option>
                <option value="elegant">优雅</option>
                <option value="vintage">复古</option>
                <option value="minimal">极简</option>
              </select>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isProcessing || videos.length === 0}
              className="w-full py-3 bg-primary text-white rounded-md hover:bg-primary-dark disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isProcessing ? '处理中...' : '开始剪辑'}
            </button>
          </div>

          {isProcessing && (
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-primary h-4 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-600 mt-2">处理进度: {Math.round(progress)}%</p>
            </div>
          )}
        </form>
      </div>

      {outputUrl && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">处理完成</h3>
          <div className="flex flex-col md:flex-row items-center gap-6">
            <video
              src={outputUrl}
              controls
              className="max-w-md w-full rounded-lg shadow"
            />
            <div className="flex-1">
              <p className="text-gray-600 mb-4">视频已处理完成，点击下方按钮下载</p>
              <a
                href={outputUrl}
                download
                className="inline-flex items-center px-6 py-2 bg-primary text-white rounded-md hover:bg-primary-dark transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载视频
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}