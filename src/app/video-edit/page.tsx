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
        credentials: 'include',
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();

      if (data.success) {
        setOutputUrl(data.downloadUrl);
        setIsProcessing(false);
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
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <p className="text-label mb-2">工作区 / WORKSPACE</p>
          <h1 className="text-mono-lg text-white">视频批量编辑 / VIDEO BATCH EDITOR</h1>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 text-red-400">
            {errorMessage}
          </div>
        )}

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mb-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-label mb-2">
                UPLOAD VIDEO
                <span className="text-gray-500 ml-2">MP4/MOV/AVI</span>
              </label>
              <div
                ref={dropZoneRef}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-emerald-500/50 transition-colors cursor-pointer bg-white/5"
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
                <label htmlFor="video-upload" className="cursor-pointer">
                  <div className="flex flex-col items-center">
                    <svg className="w-12 h-12 text-emerald-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-gray-400">DROP FILES OR CLICK TO UPLOAD</span>
                  </div>
                </label>
              </div>
            </div>

            {videos.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-label">UPLOADED {videos.length} FILES</h3>
                  <button
                    type="button"
                    onClick={clearAllVideos}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    CLEAR ALL
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {videos.map((video, index) => (
                    <div key={index} className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4 flex items-center gap-4">
                      <video
                        src={video.preview}
                        className="w-20 h-12 object-cover rounded-lg"
                        controls={false}
                        muted
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-mono truncate">{video.name}</p>
                        <p className="text-xs text-gray-500 font-mono">
                          {video.size} · {video.duration}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeVideo(index)}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
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
                <label className="block text-label mb-2">TEMPLATE</label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="mix" className="bg-gray-900">MIX</option>
                  <option value="quick" className="bg-gray-900">QUICK CUT</option>
                  <option value="story" className="bg-gray-900">STORYBOARD</option>
                  <option value="loop" className="bg-gray-900">LOOP</option>
                </select>
              </div>

              <div>
                <label className="block text-label mb-2">DURATION (SEC)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(Math.max(1, Math.min(300, Number(e.target.value))))}
                  min="1"
                  max="300"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white font-mono focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <label className="block text-label mb-2">STYLE</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="dynamic" className="bg-gray-900">DYNAMIC</option>
                  <option value="elegant" className="bg-gray-900">ELEGANT</option>
                  <option value="vintage" className="bg-gray-900">VINTAGE</option>
                  <option value="minimal" className="bg-gray-900">MINIMAL</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={isProcessing || videos.length === 0}
                className="flex-1 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {isProcessing ? 'PROCESSING...' : 'START PROCESSING'}
              </button>
              {isProcessing && (
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>PROGRESS</span>
                    <span className="font-mono">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {outputUrl && (
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
            <h3 className="text-label mb-4">OUTPUT RESULT</h3>
            <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <div>
                <p className="text-emerald-400 font-mono">PROCESSING COMPLETE</p>
                <a href={outputUrl} className="text-white hover:text-emerald-400 mt-1 inline-block">
                  DOWNLOAD VIDEO
                </a>
              </div>
              <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
