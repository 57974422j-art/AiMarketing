'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/app/providers';
import { useLocale } from '@/i18n/context';

interface VideoFile {
  file: File;
  name: string;
  size: string;
  duration: string;
  preview: string;
}

interface VideoTask {
  id: number;
  template: string;
  duration: number;
  style: string;
  outputPath?: string;
  downloadUrl?: string;
  createdAt: string;
}

// 后期处理选项
interface PostProcessingOptions {
  enableTTS: boolean;        // 配音
  enableSubtitle: boolean;   // 字幕生成
  enableTranslateSubtitle: boolean; // 翻译字幕
  enableFaceSwap: boolean;   // 换脸
  enableLipSync: boolean;    // 对口型
}

export default function VideoEditPage() {
  const { user, loading: authLoading } = useAuth()
  const { t } = useLocale()
  
  // 基础视频剪辑状态
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [template, setTemplate] = useState('mix');
  const [duration, setDuration] = useState(30);
  const [style, setStyle] = useState('dynamic');
  const [resolution, setResolution] = useState('1080p');
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [historyList, setHistoryList] = useState<VideoTask[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  // 后期处理选项状态
  const [postProcessing, setPostProcessing] = useState<PostProcessingOptions>({
    enableTTS: false,
    enableSubtitle: false,
    enableTranslateSubtitle: false,
    enableFaceSwap: false,
    enableLipSync: false,
  });
  const [targetLanguage, setTargetLanguage] = useState('zh');
  const [ttsScript, setTtsScript] = useState('');        // 配音文案
  const [faceImage, setFaceImage] = useState<File | null>(null);
  const [faceImagePreview, setFaceImagePreview] = useState<string>('');
  const [currentProcessStep, setCurrentProcessStep] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false); // 语音识别中
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const faceInputRef = useRef<HTMLInputElement>(null);

  const templateNames: Record<string, string> = {
    mix: t.videoEdit.mix,
    quick: t.videoEdit.quickCut,
    story: t.videoEdit.storyboard,
    loop: t.videoEdit.loop
  }

  const resolutionNames: Record<string, string> = {
    'original': t.common.locale === 'zh' ? '原始' : 'Original',
    '720p': '720p (1280×720)',
    '1080p': '1080p (1920×1080)',
    '4k': '4K (3840×2160)',
    '9:16': t.common.locale === 'zh' ? '竖屏' : 'Portrait',
    '1:1': t.common.locale === 'zh' ? '方形' : 'Square',
    '4:3': '4:3',
    '16:9': '16:9',
  }

  // 语言选项
  const languageOptions = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: '英语' },
    { value: 'ja', label: '日语' },
    { value: 'ko', label: '韩语' },
    { value: 'fr', label: '法语' },
    { value: 'de', label: '德语' },
    { value: 'es', label: '西班牙语' },
    { value: 'pt', label: '葡萄牙语' },
    { value: 'ru', label: '俄语' },
    { value: 'ar', label: '阿拉伯语' },
  ]

  // 配音角色选项
  const voiceOptions = [
    { value: 'aixia', label: '艾夏 (女声)' },
    { value: 'aiobtn', label: '艾奥 (男声)' },
    { value: 'xiaomeng', label: '小梦 (活泼女声)' },
    { value: 'yina', label: '依娜 (温柔女声)' },
    { value: 'aibai', label: '艾白 (成熟女声)' },
  ]
  const [selectedVoice, setSelectedVoice] = useState('aixia');

  // 解析 style 中的分辨率信息
  const parseStyleWithResolution = (styleStr: string) => {
    const parts = styleStr.split('|')
    return {
      style: parts[0] || styleStr,
      resolution: parts[1] || 'original'
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadHistory()
    }
  }, [authLoading, user])

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/video', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setHistoryList(data)
      }
    } catch (error) {
      console.error('Load history failed:', error)
    }
  }

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
        resolve(t.videoEdit.unknown);
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
        setErrorMessage(t.videoEdit.unsupportedFormat.replace('{name}', file.name));
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
  }, [t.videoEdit.unsupportedFormat, t.videoEdit.unknown]);

  const handleFaceImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFaceImage(file)
      setFaceImagePreview(URL.createObjectURL(file))
    }
  }

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

  // 更新后期处理选项
  const updatePostProcessing = (key: keyof PostProcessingOptions, value: boolean) => {
    setPostProcessing(prev => ({ ...prev, [key]: value }))
  }

  // 处理视频（包括后期处理）
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (videos.length === 0) {
      setErrorMessage(t.videoEdit.pleaseUploadVideo);
      return;
    }

    // 验证后期处理选项
    if (postProcessing.enableTTS && !ttsScript.trim()) {
      setErrorMessage('请输入配音文案');
      return;
    }
    if (postProcessing.enableFaceSwap && !faceImage) {
      setErrorMessage('请上传人脸照片');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setOutputUrl('');
    setErrorMessage('');
    setCurrentProcessStep('');

    const formData = new FormData();
    videos.forEach(video => {
      formData.append('videos', video.file);
    });
    formData.append('template', template);
    formData.append('duration', duration.toString());
    formData.append('style', style);
    formData.append('resolution', resolution);

    // 添加后期处理参数
    formData.append('postProcessing', JSON.stringify(postProcessing));
    if (postProcessing.enableTTS) {
      formData.append('ttsScript', ttsScript);
      formData.append('ttsVoice', selectedVoice);
    }
    if (postProcessing.enableTranslateSubtitle) {
      formData.append('subtitleLanguage', targetLanguage);
    }
    if (postProcessing.enableFaceSwap && faceImage) {
      formData.append('faceImage', faceImage);
    }

    try {
      // 第一步：基础视频处理
      setCurrentProcessStep('正在处理视频...');
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return 90;
          return prev + Math.random() * 10;
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
        // 如果有后期处理，调用后期处理API
        if (Object.values(postProcessing).some(v => v)) {
          setCurrentProcessStep('正在处理后期效果...');
          const postRes = await fetch('/api/video/post-process', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoUrl: data.downloadUrl,
              options: postProcessing,
              ttsScript: postProcessing.enableTTS ? ttsScript : undefined,
              ttsVoice: postProcessing.enableTTS ? selectedVoice : undefined,
              subtitleLanguage: postProcessing.enableTranslateSubtitle ? targetLanguage : undefined,
            })
          });
          
          const postData = await postRes.json();
          if (postData.success) {
            setOutputUrl(postData.videoUrl || data.downloadUrl);
          } else {
            setOutputUrl(data.downloadUrl);
            if (postData.message) {
              setErrorMessage(postData.message);
            }
          }
        } else {
          setOutputUrl(data.downloadUrl);
        }
        loadHistory();
        setIsProcessing(false);
        setCurrentProcessStep('');
      } else {
        setErrorMessage(data.message || t.videoEdit.processingFailed);
        setIsProcessing(false);
      }
    } catch (error) {
      setErrorMessage(t.videoEdit.uploadFailed);
      setIsProcessing(false);
    }
  };

  // 自动识别语音
  const handleTranscribe = async () => {
    if (videos.length === 0) {
      setErrorMessage('请先上传视频');
      return;
    }

    setIsTranscribing(true);
    setCurrentProcessStep('正在识别语音...');
    setErrorMessage('');

    try {
      const formData = new FormData();
      formData.append('video', videos[0].file);

      const response = await fetch('/api/video/transcribe', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await response.json();

      if (data.success && data.text) {
        setTtsScript(data.text);
        setErrorMessage('');
      } else {
        setErrorMessage(data.message || '语音识别失败');
      }
    } catch (error) {
      console.error('Transcribe error:', error);
      setErrorMessage('语音识别失败，请重试');
    } finally {
      setIsTranscribing(false);
      setCurrentProcessStep('');
    }
  };

  const handleDeleteHistory = async (task: VideoTask) => {
    if (!confirm(t.videoEdit.confirmDelete)) return

    try {
      const res = await fetch(`/api/video?id=${task.id}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (res.ok) {
        setHistoryList(historyList.filter(item => item.id !== task.id))
        alert(t.videoEdit.deleteSuccess)
      } else {
        alert(t.videoEdit.deleteFailed)
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert(t.videoEdit.deleteFailed)
    }
  }

  const handleShareToLibrary = async () => {
    if (!outputUrl) return
    if (!confirm(t.videoEdit.shareToLibrary + '?')) return

    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'video',
          data: {
            title: `${templateNames[template] || template} ${t.videoEdit.videoTemplate}`,
            description: t.videoEdit.processedVideo.replace('{type}', templateNames[template] || template),
            prompt: `Template: ${template}, Duration: ${duration}s, Style: ${style}, Resolution: ${resolution}`,
            duration,
            style,
            resolution,
            videoUrl: outputUrl
          }
        })
      })

      const data = await res.json()
      if (data.success) {
        alert(t.videoEdit.shareSuccess)
      } else {
        alert(data.message || t.videoEdit.shareFailed)
      }
    } catch (error) {
      console.error('Share failed:', error)
      alert(t.videoEdit.shareFailed)
    }
  }

  // 判断是否有启用的后期处理
  const hasPostProcessingEnabled = Object.values(postProcessing).some(v => v);

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <p className="text-label mb-2">{t.videoEdit.workspace.toUpperCase()}</p>
            <h1 className="text-mono-lg text-white">{t.videoEdit.title}</h1>
          </div>
          {user && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="px-4 py-2 text-sm bg-white/5 border border-white/10 text-gray-300 rounded-lg hover:bg-white/10"
            >
              {showHistory ? t.videoEdit.backToGenerator : t.videoEdit.viewHistory}
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 text-red-400">
            {errorMessage}
          </div>
        )}

        {!showHistory ? (
          <>
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mb-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 视频上传 */}
                <div>
                  <label className="block text-label mb-2">
                    {t.videoEdit.uploadVideo.toUpperCase()}
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
                        <span className="text-gray-400">{t.videoEdit.dragOrClick.toUpperCase()}</span>
                      </div>
                    </label>
                  </div>
                </div>

                {videos.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-label">{t.videoEdit.uploadedFiles.replace('{count}', videos.length.toString()).toUpperCase()}</h3>
                      <button
                        type="button"
                        onClick={clearAllVideos}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        {t.videoEdit.clearAll.toUpperCase()}
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

                {/* 自动识别语音按钮 */}
                {videos.length > 0 && (
                  <div className="flex items-center justify-between p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl">
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      <div>
                        <p className="text-sm text-orange-300">自动识别语音</p>
                        <p className="text-xs text-orange-400/60">将视频中的语音转为文字，可用于字幕、配音、翻译</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleTranscribe}
                      disabled={isTranscribing}
                      className="px-4 py-2 bg-orange-500/20 border border-orange-500/30 text-orange-300 rounded-lg hover:bg-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isTranscribing ? (
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          识别中...
                        </span>
                      ) : (
                        '开始识别'
                      )}
                    </button>
                  </div>
                )}

                {/* 基础剪辑选项 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-label mb-2">{t.videoEdit.template.toUpperCase()}</label>
                    <select
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="mix" className="bg-gray-900">{t.videoEdit.mix}</option>
                      <option value="quick" className="bg-gray-900">{t.videoEdit.quickCut}</option>
                      <option value="story" className="bg-gray-900">{t.videoEdit.storyboard}</option>
                      <option value="loop" className="bg-gray-900">{t.videoEdit.loop}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-label mb-2">{t.videoEdit.duration.toUpperCase()} ({t.videoEdit.seconds})</label>
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
                    <label className="block text-label mb-2">{t.videoEdit.resolution.toUpperCase()}</label>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="original" className="bg-gray-900">原始</option>
                      <option value="720p" className="bg-gray-900">720p (1280×720)</option>
                      <option value="1080p" className="bg-gray-900">1080p (1920×1080)</option>
                      <option value="4k" className="bg-gray-900">4K (3840×2160)</option>
                      <option value="9:16" className="bg-gray-900">竖屏 (1080×1920)</option>
                      <option value="1:1" className="bg-gray-900">方形 (1080×1080)</option>
                      <option value="4:3" className="bg-gray-900">4:3 (1440×1080)</option>
                      <option value="16:9" className="bg-gray-900">宽屏 (1920×1080)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-label mb-2">{t.videoEdit.style.toUpperCase()}</label>
                    <select
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="dynamic" className="bg-gray-900">{t.videoEdit.dynamic}</option>
                      <option value="elegant" className="bg-gray-900">{t.videoEdit.elegant}</option>
                      <option value="vintage" className="bg-gray-900">{t.videoEdit.vintage}</option>
                      <option value="minimal" className="bg-gray-900">{t.videoEdit.minimal}</option>
                    </select>
                  </div>
                </div>

                {/* 后期处理选项 */}
                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-label mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    后期处理选项
                  </h3>

                  {/* 功能开关 */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                    <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableTTS ? 'bg-purple-500/20 border border-purple-500/50' : 'bg-white/5 border border-white/10 hover:border-purple-500/30'}`}>
                      <input
                        type="checkbox"
                        checked={postProcessing.enableTTS}
                        onChange={(e) => updatePostProcessing('enableTTS', e.target.checked)}
                        className="w-4 h-4 rounded accent-purple-500"
                      />
                      <span className={`text-sm ${postProcessing.enableTTS ? 'text-purple-300' : 'text-gray-300'}`}>配音 (TTS)</span>
                    </label>

                    <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableSubtitle ? 'bg-blue-500/20 border border-blue-500/50' : 'bg-white/5 border border-white/10 hover:border-blue-500/30'}`}>
                      <input
                        type="checkbox"
                        checked={postProcessing.enableSubtitle}
                        onChange={(e) => updatePostProcessing('enableSubtitle', e.target.checked)}
                        className="w-4 h-4 rounded accent-blue-500"
                      />
                      <span className={`text-sm ${postProcessing.enableSubtitle ? 'text-blue-300' : 'text-gray-300'}`}>字幕生成</span>
                    </label>

                    <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableTranslateSubtitle ? 'bg-cyan-500/20 border border-cyan-500/50' : 'bg-white/5 border border-white/10 hover:border-cyan-500/30'}`}>
                      <input
                        type="checkbox"
                        checked={postProcessing.enableTranslateSubtitle}
                        onChange={(e) => updatePostProcessing('enableTranslateSubtitle', e.target.checked)}
                        className="w-4 h-4 rounded accent-cyan-500"
                      />
                      <span className={`text-sm ${postProcessing.enableTranslateSubtitle ? 'text-cyan-300' : 'text-gray-300'}`}>翻译字幕</span>
                    </label>

                    <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableFaceSwap ? 'bg-pink-500/20 border border-pink-500/50' : 'bg-white/5 border border-white/10 hover:border-pink-500/30'}`}>
                      <input
                        type="checkbox"
                        checked={postProcessing.enableFaceSwap}
                        onChange={(e) => updatePostProcessing('enableFaceSwap', e.target.checked)}
                        className="w-4 h-4 rounded accent-pink-500"
                      />
                      <span className={`text-sm ${postProcessing.enableFaceSwap ? 'text-pink-300' : 'text-gray-300'}`}>换脸</span>
                    </label>

                    <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableLipSync ? 'bg-amber-500/20 border border-amber-500/50' : 'bg-white/5 border border-white/10 hover:border-amber-500/30'}`}>
                      <input
                        type="checkbox"
                        checked={postProcessing.enableLipSync}
                        onChange={(e) => updatePostProcessing('enableLipSync', e.target.checked)}
                        className="w-4 h-4 rounded accent-amber-500"
                      />
                      <span className={`text-sm ${postProcessing.enableLipSync ? 'text-amber-300' : 'text-gray-300'}`}>对口型</span>
                    </label>
                  </div>

                  {/* 配音选项 */}
                  {postProcessing.enableTTS && (
                    <div className="mb-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-purple-300 mb-2">配音角色</label>
                          <select
                            value={selectedVoice}
                            onChange={(e) => setSelectedVoice(e.target.value)}
                            className="w-full bg-white/5 border border-purple-500/30 rounded-lg px-3 py-2 text-white focus:outline-none"
                          >
                            {voiceOptions.map(voice => (
                              <option key={voice.value} value={voice.value} className="bg-gray-900">
                                {voice.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-purple-300 mb-2">目标语言</label>
                          <select
                            value={targetLanguage}
                            onChange={(e) => setTargetLanguage(e.target.value)}
                            className="w-full bg-white/5 border border-purple-500/30 rounded-lg px-3 py-2 text-white focus:outline-none"
                          >
                            {languageOptions.map(lang => (
                              <option key={lang.value} value={lang.value} className="bg-gray-900">
                                {lang.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm text-purple-300 mb-2">配音文案</label>
                          <textarea
                            value={ttsScript}
                            onChange={(e) => setTtsScript(e.target.value)}
                            placeholder="输入要配音的文案内容..."
                            className="w-full bg-white/5 border border-purple-500/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none h-24 resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 字幕选项 */}
                  {postProcessing.enableSubtitle && !postProcessing.enableTTS && (
                    <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                      <label className="block text-sm text-blue-300 mb-2">目标语言</label>
                      <select
                        value={targetLanguage}
                        onChange={(e) => setTargetLanguage(e.target.value)}
                        className="w-full bg-white/5 border border-blue-500/30 rounded-lg px-3 py-2 text-white focus:outline-none"
                      >
                        {languageOptions.map(lang => (
                          <option key={lang.value} value={lang.value} className="bg-gray-900">
                            {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 翻译字幕选项 */}
                  {postProcessing.enableTranslateSubtitle && !postProcessing.enableSubtitle && (
                    <div className="mb-4 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
                      <label className="block text-sm text-cyan-300 mb-2">翻译目标语言</label>
                      <select
                        value={targetLanguage}
                        onChange={(e) => setTargetLanguage(e.target.value)}
                        className="w-full bg-white/5 border border-cyan-500/30 rounded-lg px-3 py-2 text-white focus:outline-none"
                      >
                        {languageOptions.map(lang => (
                          <option key={lang.value} value={lang.value} className="bg-gray-900">
                            {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 换脸选项 */}
                  {postProcessing.enableFaceSwap && (
                    <div className="mb-4 p-4 bg-pink-500/10 border border-pink-500/20 rounded-xl">
                      <label className="block text-sm text-pink-300 mb-2">上传目标人脸照片</label>
                      <div className="flex items-center gap-4">
                        <input
                          ref={faceInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleFaceImageSelect}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => faceInputRef.current?.click()}
                          className="px-4 py-2 bg-pink-500/20 border border-pink-500/30 text-pink-300 rounded-lg hover:bg-pink-500/30"
                        >
                          选择图片
                        </button>
                        {faceImagePreview && (
                          <div className="flex items-center gap-2">
                            <img src={faceImagePreview} alt="人脸预览" className="w-16 h-16 object-cover rounded-lg border border-pink-500/30" />
                            <button
                              type="button"
                              onClick={() => { setFaceImage(null); setFaceImagePreview(''); }}
                              className="text-pink-400 hover:text-pink-300"
                            >
                              移除
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-pink-400/60 mt-2">支持 JPG、PNG 格式，建议使用正面清晰的证件照或自拍</p>
                    </div>
                  )}

                  {/* 对口型说明 */}
                  {postProcessing.enableLipSync && (
                    <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-amber-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-sm text-amber-300">对口型功能说明</p>
                          <p className="text-xs text-amber-400/60 mt-1">
                            此功能会根据配音自动调整视频中人物的口型匹配度。当前版本会返回模拟处理结果，实际效果取决于视频内容质量。
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 提交按钮 */}
                <div className="flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={isProcessing || videos.length === 0}
                    className="flex-1 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors"
                  >
                    {isProcessing ? (currentProcessStep || t.videoEdit.processing.toUpperCase()) : (hasPostProcessingEnabled ? '开始处理' : t.videoEdit.startProcessing.toUpperCase())}
                  </button>
                  {isProcessing && (
                    <div className="flex-1">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{currentProcessStep || t.videoEdit.progress.toUpperCase()}</span>
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
                <h3 className="text-label mb-4">{t.videoEdit.outputResult.toUpperCase()}</h3>
                <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                  <div>
                    <p className="text-emerald-400 font-mono">{t.videoEdit.processingComplete.toUpperCase()}</p>
                    <a href={outputUrl} className="text-white hover:text-emerald-400 mt-1 inline-block">
                      {t.videoEdit.downloadVideo.toUpperCase()}
                    </a>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handleShareToLibrary}
                      className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-medium transition-colors"
                    >
                      {t.videoEdit.shareToLibrary}
                    </button>
                    <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
            <h3 className="text-label mb-4">{t.videoEdit.history.toUpperCase()}</h3>
            {historyList.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t.videoEdit.noHistory}</p>
            ) : (
              <div className="space-y-4">
                {historyList.map((task) => {
                  const { style: parsedStyle, resolution: taskResolution } = parseStyleWithResolution(task.style)
                  return (
                    <div key={task.id} className="bg-white/5 rounded-xl border border-white/10 p-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-gray-400 text-sm">
                            {templateNames[task.template] || task.template} · {task.duration}{t.videoEdit.seconds} · {resolutionNames[taskResolution] || taskResolution}
                          </p>
                          <p className="text-gray-500 text-xs mt-1">
                            {parsedStyle} · {new Date(task.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {(task.downloadUrl || task.outputPath) && (
                            <a
                              href={task.downloadUrl || task.outputPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1 text-sm bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30"
                            >
                              {t.videoEdit.downloadVideo}
                            </a>
                          )}
                          <button
                            onClick={() => handleDeleteHistory(task)}
                            className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                            title={t.videoEdit.delete}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
