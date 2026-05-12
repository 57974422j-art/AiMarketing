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
  enableSpeakerDiarization: boolean; // 说话人分离
  enableBackgroundAudio?: boolean; // 保留背景音
  enableOriginalSubtitle?: boolean; // 删除原字幕
}

// 后期处理步骤类型
type PostProcessStepKey = 'transcribe' | 'translate' | 'subtitle' | 'tts' | 'lipsync' | 'faceswap';

interface StepState {
  status: 'pending' | 'active' | 'completed' | 'skipped';
  completed: boolean;
  message?: string;
}

// 步骤定义（顺序与实际处理流程一致：识别→翻译→配音→字幕烧录）
const POST_PROCESS_STEPS: Array<{ key: PostProcessStepKey; label: string; color: string }> = [
  { key: 'transcribe', label: '语音识别', color: 'orange' },
  { key: 'translate', label: '翻译字幕', color: 'cyan' },
  { key: 'tts', label: '配音', color: 'purple' },
  { key: 'subtitle', label: '字幕烧录', color: 'blue' },
  { key: 'lipsync', label: '对口型', color: 'amber' },
  { key: 'faceswap', label: '换脸', color: 'pink' },
];

// 配音角色选项（支持多人配音）
interface VoiceAssignment {
  speakerId: string;
  voice: string;
  label: string;
}

// 配音角色预设（火山方舟 TTS speaker 名）
const voicePresets = [
  // 青年女声
  { id: 'zh_female_vv_uranus_bigtts', label: '青年女声-通用', voice: 'zh_female_vv_uranus_bigtts', category: '青年女声' },
  { id: 'zh_female_vv_yuheng_bigtts', label: '青年女声-甜美', voice: 'zh_female_vv_yuheng_bigtts', category: '青年女声' },
  { id: 'zh_female_vv_magic_bigtts', label: '青年女声-温柔', voice: 'zh_female_vv_magic_bigtts', category: '青年女声' },
  // 青年男声
  { id: 'zh_male_vv_uranus_bigtts', label: '青年男声-通用', voice: 'zh_male_vv_uranus_bigtts', category: '青年男声' },
  { id: 'zh_male_vv_yezhu_bigtts', label: '青年男声-磁性', voice: 'zh_male_vv_yezhu_bigtts', category: '青年男声' },
  { id: 'zh_male_vv_shuhao_bigtts', label: '青年男声-沉稳', voice: 'zh_male_vv_shuhao_bigtts', category: '青年男声' },
  // 英文
  { id: 'en_male_tim_uranus_bigtts', label: '英文男声(Tim)', voice: 'en_male_tim_uranus_bigtts', category: '英文' },
  { id: 'en_female_dacey_uranus_bigtts', label: '英文女声(Dacey)', voice: 'en_female_dacey_uranus_bigtts', category: '英文' },
  { id: 'en_female_stokie_uranus_bigtts', label: '英文女声(Stokie)', voice: 'en_female_stokie_uranus_bigtts', category: '英文' },
];

export default function VideoEditPage() {
  const { user, loading: authLoading } = useAuth()
  const { t } = useLocale()
  
  // 页面模式切换
  const [pageMode, setPageMode] = useState<'edit' | 'postProcess' | 'textToVideo'>('edit');
  
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
  const [successMessage, setSuccessMessage] = useState('');
  const [historyList, setHistoryList] = useState<VideoTask[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  // 后期处理选项状态
  const [postProcessing, setPostProcessing] = useState<PostProcessingOptions>({
    enableTTS: false,
    enableSubtitle: false,
    enableTranslateSubtitle: false,
    enableFaceSwap: false,
    enableLipSync: false,
    enableSpeakerDiarization: false,
  });
  const [targetLanguage, setTargetLanguage] = useState('zh');
  const [ttsScript, setTtsScript] = useState('');        // 配音文案
  const [ttsVoice, setTtsVoice] = useState('zh_female_vv_uranus_bigtts'); // 配音音色
  // ASR 时间戳结果（segments: {text, start, end, speaker}）
  const [asrSegments, setAsrSegments] = useState<Array<{text: string; start: number; end: number; speaker: string}>>([]);

  // 根据目标语言自动匹配默认音色（仅切换语言时触发）
  useEffect(() => {
    if (targetLanguage === 'en') {
      setTtsVoice('en_male_tim_uranus_bigtts');
    } else {
      setTtsVoice('zh_female_vv_uranus_bigtts');
    }
  }, [targetLanguage]);
  const [faceImage, setFaceImage] = useState<File | null>(null);
  const [faceImagePreview, setFaceImagePreview] = useState<string>('');
  const [currentProcessStep, setCurrentProcessStep] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false); // 语音识别中
  const [transcribedVideoUrl, setTranscribedVideoUrl] = useState<string>(''); // 语音识别后返回的视频URL
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false); // 等待用户确认识别文案
  const [useCloudProcessing, setUseCloudProcessing] = useState(false); // false=本地处理, true=阿里云处理
  
  // 后期处理步骤链状态
  const [stepStates, setStepStates] = useState<Record<PostProcessStepKey, StepState>>({
    transcribe: { status: 'pending', completed: false },
    translate: { status: 'pending', completed: false },
    subtitle: { status: 'pending', completed: false },
    tts: { status: 'pending', completed: false },
    lipsync: { status: 'pending', completed: false },
    faceswap: { status: 'pending', completed: false },
  });
  const [currentStepKey, setCurrentStepKey] = useState<PostProcessStepKey | null>(null);
  
  // 说话人分离结果
  const [speakerDiarization, setSpeakerDiarization] = useState<Array<{speaker: string; text: string; voice: string}>>([]);
  const [voiceAssignments, setVoiceAssignments] = useState<VoiceAssignment[]>([]);
  
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

  // 配音角色选项 (火山方舟 TTS)
  const voiceOptions = voicePresets.map(p => ({ value: p.voice, label: p.label }))

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
    // 如果开启说话人分离，重置配音分配
    if (key === 'enableSpeakerDiarization' && value) {
      setPostProcessing(prev => ({ ...prev, enableTTS: true }))
    }
  }

  // 文生视频状态
  const [t2vPrompt, setT2vPrompt] = useState('')
  const [t2vAspectRatio, setT2vAspectRatio] = useState('16:9')
  const [t2vTaskId, setT2vTaskId] = useState('')
  const [t2vVideoUrl, setT2vVideoUrl] = useState('')
  const [t2vPolling, setT2vPolling] = useState(false)
  const [t2vMessage, setT2vMessage] = useState('')

  // 模式切换时重置状态
  const handleModeSwitch = (mode: 'edit' | 'postProcess' | 'textToVideo') => {
    if (mode !== pageMode) {
      setPageMode(mode);
      setOutputUrl('');
      setErrorMessage('');
      setSuccessMessage('');
      // 重置步骤状态
      setStepStates({
        transcribe: { status: 'pending', completed: false },
        translate: { status: 'pending', completed: false },
        subtitle: { status: 'pending', completed: false },
        tts: { status: 'pending', completed: false },
        lipsync: { status: 'pending', completed: false },
        faceswap: { status: 'pending', completed: false },
      });
      setCurrentStepKey(null);
      setT2vTaskId(''); setT2vVideoUrl(''); setT2vPolling(false); setT2vMessage('');
    }
  }

  // 剪辑模式提交
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (videos.length === 0) {
      setErrorMessage(t.videoEdit.pleaseUploadVideo);
      return;
    }

    // 验证后期处理选项
    if (postProcessing.enableTTS && !ttsScript.trim() && speakerDiarization.length === 0) {
      setErrorMessage('请输入配音文案或先进行语音识别');
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
      formData.append('voiceAssignments', JSON.stringify(voiceAssignments));
    }
    if (postProcessing.enableTranslateSubtitle) {
      formData.append('subtitleLanguage', targetLanguage);
    }
    if (postProcessing.enableFaceSwap && faceImage) {
      formData.append('faceImage', faceImage);
    }

    try {
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
          const postBody: Record<string, unknown> = {
            videoUrl: data.downloadUrl,
            options: postProcessing,
            useCloud: useCloudProcessing,
          };
          if (postProcessing.enableTTS && ttsScript) {
            postBody.ttsScript = ttsScript;
            postBody.ttsVoice = ttsVoice;
            if (voiceAssignments.length > 0) postBody.voiceAssignments = voiceAssignments;
          }
          if (postProcessing.enableTranslateSubtitle && targetLanguage) {
            postBody.subtitleLanguage = targetLanguage;
          }
          if (asrSegments.length > 0) {
            postBody.segments = asrSegments;
          }
          console.log('postBody:', JSON.stringify(postBody));
          const postRes = await fetch('/api/video/post-process', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postBody),
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

  // 阶段1: 上传+语音识别 → 暂停让用户确认文案
  const handlePostProcessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (videos.length === 0) {
      setErrorMessage('请上传视频文件');
      return;
    }
    const hasAnyOption = postProcessing.enableTTS || postProcessing.enableSubtitle || 
                         postProcessing.enableTranslateSubtitle || postProcessing.enableFaceSwap || postProcessing.enableLipSync;
    if (!hasAnyOption) {
      setErrorMessage('请至少选择一个后期处理选项');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setOutputUrl('');
    setErrorMessage('');
    setSuccessMessage('');
    setAwaitingConfirmation(false);

    setStepStates({
      transcribe: { status: 'active', completed: false },
      translate: { status: 'pending', completed: false },
      subtitle: { status: 'pending', completed: false },
      tts: { status: 'pending', completed: false },
      lipsync: { status: 'pending', completed: false },
      faceswap: { status: 'pending', completed: false },
    });

    try {
      let videoUrl = transcribedVideoUrl || '';
      let script = ttsScript || '';

      // 只有没有视频URL时才做语音识别
      if (!videoUrl) {
        setCurrentStepKey('transcribe');
        setCurrentProcessStep('🎤 正在语音识别...');
        setProgress(10);

        const formData = new FormData();
        formData.append('video', videos[0].file);
        const res = await fetch('/api/video/transcribe', {
          method: 'POST', credentials: 'include', body: formData,
        });
        const data = await res.json();
        if (!data.success) throw new Error('语音识别失败: ' + (data.message || '未知错误'));

        videoUrl = data.videoUrl || '';
        script = data.text || '';
        setTranscribedVideoUrl(videoUrl);
        if (script) setTtsScript(script);
        // 保存 ASR 时间戳
        if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
          setAsrSegments(data.segments);
          console.log(`保存 ASR 时间戳: ${data.segments.length} 段`);
        } else {
          setAsrSegments([]);
        }
      }

      setProgress(20);
      setStepStates(prev => ({ ...prev, transcribe: { status: 'completed', completed: true, message: '识别完成 ✓' } }));

      // 暂停，等待用户确认文案
      setCurrentProcessStep('📝 请确认或编辑识别文案，然后点击「确认并继续处理」');
      setAwaitingConfirmation(true);
      setIsProcessing(false);

    } catch (error) {
      setErrorMessage('识别失败: ' + (error instanceof Error ? error.message : '未知错误'));
      setIsProcessing(false);
      setCurrentProcessStep('');
      setCurrentStepKey(null);
    }
  };

  // 阶段2: 用户确认文案后，执行所有后期处理步骤
  const handleContinuePostProcess = async () => {
    const currentScript = ttsScript || '';
    const currentVideoUrl = transcribedVideoUrl;
    if (!currentVideoUrl) {
      setErrorMessage('缺少视频URL，请重新开始');
      return;
    }
    // 仅当配音启用时才需要文案
    if (postProcessing.enableTTS && !currentScript) {
      setErrorMessage('配音启用但缺少文案，请先进行语音识别或输入文案');
      return;
    }

    setAwaitingConfirmation(false);
    setIsProcessing(true);
    setProgress(30);
    setErrorMessage('');

    try {
      const steps: { key: PostProcessStepKey; label: string; enabled: boolean; progressMsg: string; doneMsg: string }[] = [];

      if (postProcessing.enableTranslateSubtitle && targetLanguage && targetLanguage !== 'zh') {
        steps.push({ key: 'translate', label: '字幕翻译', enabled: true, progressMsg: '🌐 正在翻译字幕 (AI)...', doneMsg: '翻译完成 ✓' });
      }
      if (postProcessing.enableTTS) {
        steps.push({ key: 'tts', label: '配音', enabled: true, progressMsg: '🎤 正在生成配音 (TTS)...', doneMsg: '配音完成 ✓' });
      }
      if (postProcessing.enableSubtitle || postProcessing.enableTranslateSubtitle) {
        steps.push({ key: 'subtitle', label: '字幕烧录', enabled: true, progressMsg: '📄 正在烧录字幕 (FFmpeg)...', doneMsg: '字幕完成 ✓' });
      }

      // 构造请求体（字幕独立：即使无文案也可由 FunASR 自行识别）
      const postBody: Record<string, unknown> = {
        videoUrl: currentVideoUrl,
        options: {
          enableTTS: postProcessing.enableTTS,
          enableSubtitle: postProcessing.enableSubtitle,
          enableTranslateSubtitle: postProcessing.enableTranslateSubtitle,
          enableFaceSwap: postProcessing.enableFaceSwap,
          enableLipSync: postProcessing.enableLipSync,
          enableSpeakerDiarization: postProcessing.enableSpeakerDiarization,
          enableBackgroundAudio: postProcessing.enableBackgroundAudio,
          enableOriginalSubtitle: postProcessing.enableOriginalSubtitle,
        },
        ttsVoice,
        useCloud: useCloudProcessing,
      };
      // 仅配音启用时传文案，字幕可独立用 FunASR 自行识别
      if (postProcessing.enableTTS && currentScript) {
        postBody.ttsScript = currentScript;
      }
      if (voiceAssignments.length > 0) postBody.voiceAssignments = voiceAssignments;
      if (targetLanguage) postBody.subtitleLanguage = targetLanguage;
      if (asrSegments.length > 0) {
        postBody.segments = asrSegments;
      }

      // 将所有启用的步骤标记为 active（正在处理中），让用户看到完整处理链
      setStepStates(prev => {
        const updated = { ...prev };
        updated.transcribe = { status: 'completed', completed: true, message: '识别完成 ✓' };
        for (const step of steps) {
          updated[step.key] = { status: 'active', completed: false, message: step.progressMsg };
        }
        return updated;
      });
      if (steps.length > 0) {
        setCurrentStepKey(steps[0].key);
        setCurrentProcessStep(`⏳ 正在处理: ${steps.map(s => s.label).join(' → ')}`);
      }
      setProgress(40);
      // 模拟步骤进度，让用户看到动态变化
      const simInterval = setInterval(() => {
        setProgress(prev => prev < 75 ? prev + Math.random() * 5 : prev)
      }, 2000)
      // 在 API 返回前持续更新
      Promise.resolve().then(() => { setTimeout(() => clearInterval(simInterval), 120000) })

      console.log('[Continue] 请求体:', JSON.stringify(postBody));
      const postRes = await fetch('/api/video/post-process', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody),
      });
      const postData = await postRes.json();
      console.log('[Continue] 响应:', postData);

      setProgress(80);

      if (postData.success && postData.videoUrl) {
        setOutputUrl(postData.videoUrl);
        setProgress(100);

        // 根据后端实际执行的步骤更新状态
        // 后端 processSteps: '配音'、'字幕翻译'、'字幕生成'
        const done = postData.processSteps || [];
        const hasTranslate = done.includes('字幕翻译');
        const hasSubtitle = done.includes('字幕生成') || done.includes('字幕翻译'); // 翻译字幕也包含字幕烧录
        const hasTTS = done.includes('配音');

        const newSteps: Record<string, StepState> = {
          transcribe: { status: 'completed', completed: true, message: '识别完成 ✓' },
          translate: { status: hasTranslate ? 'completed' : 'skipped', completed: hasTranslate, message: hasTranslate ? '翻译完成 ✓' : '' },
          tts: { status: hasTTS ? 'completed' : 'skipped', completed: hasTTS, message: hasTTS ? '配音完成 ✓' : '' },
          subtitle: { status: hasSubtitle ? 'completed' : 'skipped', completed: hasSubtitle, message: hasSubtitle ? '字幕完成 ✓' : '' },
          lipsync: { status: 'skipped', completed: false },
          faceswap: { status: 'skipped', completed: false },
        };
        setStepStates(newSteps);

        const msg = done.length > 0 ? `✅ ${done.join('、')}处理完成` : '✅ 后期处理完成';
        setSuccessMessage(msg);
        setCurrentProcessStep(msg);
      } else {
        throw new Error(postData.message || '后期处理失败');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误';
      setErrorMessage('❌ ' + errMsg);
      setCurrentProcessStep('⚠️ 出错: ' + errMsg);
    } finally {
      setIsProcessing(false);
      setCurrentStepKey(null);
    }
  };

  // 文生视频提交
  const handleTextToVideo = async () => {
    if (!t2vPrompt.trim()) { setErrorMessage('请输入视频描述'); return }
    setT2vPolling(true)
    setT2vTaskId('')
    setT2vVideoUrl('')
    setT2vMessage('提交中...')
    setErrorMessage('')
    try {
      const res = await fetch('/api/video/text-to-video', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: t2vPrompt.trim(), aspectRatio: t2vAspectRatio }),
      })
      const data = await res.json()
      if (!data.success) { setErrorMessage(data.message || '提交失败'); setT2vPolling(false); return }

      if (data.videoUrl) {
        setT2vVideoUrl(data.videoUrl)
        setT2vMessage('✅ 生成完成')
        setT2vPolling(false)
        setSuccessMessage('视频生成完成，24 小时内有效')
        return
      }

      setT2vTaskId(data.taskId)
      setT2vMessage('⏳ 任务已提交，轮询中...')
      // 轮询结果
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const qRes = await fetch(`/api/video/text-to-video?taskId=${data.taskId}`, { credentials: 'include' })
        const qData = await qRes.json()
        if (qData.videoUrl) {
          setT2vVideoUrl(qData.videoUrl)
          setT2vMessage('✅ 生成完成')
          setSuccessMessage('视频生成完成，24 小时内有效')
          break
        }
        if (qData.status === 'FAILED') { setErrorMessage('视频生成失败'); break }
        setT2vMessage(`⏳ 生成中... (${i + 1}/120)`)
      }
    } catch (e: any) { setErrorMessage(e.message || '请求失败') }
    finally { setT2vPolling(false) }
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

      console.log('=== 开始语音识别 ===');
      console.log('上传文件:', videos[0].file.name, videos[0].file.size, 'bytes');

      const response = await fetch('/api/video/transcribe', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      console.log('响应状态:', response.status);
      const data = await response.json();
      console.log('完整响应数据:', JSON.stringify(data, null, 2));

      // 兼容多种返回格式
      const recognizedText = data.text || data.content || data.result || data.transcription || '';
      
      if (recognizedText) {
        console.log('提取到的识别文本:', recognizedText.substring(0, 100) + '...');
        setTtsScript(recognizedText);
        setErrorMessage('');
        setSuccessMessage('✅ 识别完成，已填入配音文案');
        // 3秒后清除成功提示
        setTimeout(() => setSuccessMessage(''), 3000);
        
        // 保存 ASR 时间戳（segments）
        if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
          setAsrSegments(data.segments);
          console.log(`保存 ASR 时间戳: ${data.segments.length} 段`);
        } else {
          setAsrSegments([]);
        }
        
        // 保存视频URL（供后续后期处理使用）
        if (data.videoUrl) {
          setTranscribedVideoUrl(data.videoUrl);
          console.log('保存视频URL:', data.videoUrl);
        }
        
        // 更新步骤链状态
        setStepStates(prev => ({
          ...prev,
          transcribe: { status: 'completed', completed: true, message: '识别完成' },
        }));
        // 解锁后续步骤
        setStepStates(prev => ({ ...prev, translate: { ...prev.translate, status: 'active' } }));
        
        // 如果启用了说话人分离，处理分离结果
        const speakerList = data.speaker_labels || data.speakers || [];
        if (postProcessing.enableSpeakerDiarization && speakerList.length > 0) {
          const speakers = speakerList;
          const assignments: VoiceAssignment[] = speakers.map((speaker: string, idx: number) => ({
            speakerId: speaker,
            voice: voicePresets[idx % voicePresets.length].voice,
            label: voicePresets[idx % voicePresets.length].label,
          }));
          setVoiceAssignments(assignments);
        }
      } else {
        console.warn('未获取到识别文本，响应数据:', data);
        setErrorMessage(data.message || '未识别到语音内容');
      }
    } catch (error) {
      console.error('识别失败:', error);
      setErrorMessage('语音识别失败: ' + (error instanceof Error ? error.message : '未知错误'));
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

  // 渲染模式切换开关
  const renderModeSwitch = () => (
    <div className="mb-6 flex items-center justify-center">
      <div className="inline-flex bg-white/5 rounded-xl p-1 border border-white/10">
        <button
          onClick={() => handleModeSwitch('edit')}
          className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
            pageMode === 'edit'
              ? 'bg-emerald-500 text-white shadow-lg'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            剪辑模式
          </span>
        </button>
        <button
          onClick={() => handleModeSwitch('postProcess')}
          className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
            pageMode === 'postProcess'
              ? 'bg-purple-500 text-white shadow-lg'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            后期处理
          </span>
        </button>
        <button
          onClick={() => handleModeSwitch('textToVideo')}
          className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
            pageMode === 'textToVideo'
              ? 'bg-cyan-500 text-white shadow-lg'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            文生视频
          </span>
        </button>
      </div>
    </div>
  );

  // 渲染后期处理选项（仅后期处理模式使用）
  const renderPostProcessingOptions = () => (
    <div className="border-t border-white/10 pt-6">
        <h3 className="text-label mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        后期处理选项
      </h3>

      {/* 本地/云端切换 */}
      <div className="mb-4 p-4 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-white text-sm font-medium whitespace-nowrap"><span>处理引擎</span><span className="text-xs opacity-50 ml-1">/ ENGINE</span></span>
          <p className="text-gray-500 text-xs mt-0.5 truncate">{useCloudProcessing ? '阿里云 / CLOUD' : '本地 / LOCAL'}</p>
        </div>
        <button
          type="button"
          onClick={() => setUseCloudProcessing(!useCloudProcessing)}
          className={`relative w-14 h-7 rounded-full transition-colors shrink-0 ${useCloudProcessing ? 'bg-emerald-500' : 'bg-gray-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${useCloudProcessing ? 'translate-x-7' : ''}`} />
        </button>
      </div>

      {/* 功能开关 */}
      <div className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableTTS ? 'bg-purple-500/20 border border-purple-500/50' : 'bg-white/5 border border-white/10 hover:border-purple-500/30'}`}>
            <input
              type="checkbox"
              checked={postProcessing.enableTTS}
              onChange={(e) => updatePostProcessing('enableTTS', e.target.checked)}
              className="w-4 h-4 rounded accent-purple-500"
            />
            <span className={`text-sm ${postProcessing.enableTTS ? 'text-purple-300' : 'text-gray-300'}`}>配音</span>
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

          <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableSpeakerDiarization ? 'bg-orange-500/20 border border-orange-500/50' : 'bg-white/5 border border-white/10 hover:border-orange-500/30'}`}>
            <input
              type="checkbox"
              checked={postProcessing.enableSpeakerDiarization}
              onChange={(e) => updatePostProcessing('enableSpeakerDiarization', e.target.checked)}
              className="w-4 h-4 rounded accent-orange-500"
            />
            <span className={`text-sm ${postProcessing.enableSpeakerDiarization ? 'text-orange-300' : 'text-gray-300'}`}>说话人分离</span>
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

          <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableBackgroundAudio ? 'bg-emerald-500/20 border border-emerald-500/50' : 'bg-white/5 border border-white/10 hover:border-emerald-500/30'}`}>
            <input
              type="checkbox"
              checked={!!postProcessing.enableBackgroundAudio}
              onChange={(e) => updatePostProcessing('enableBackgroundAudio', e.target.checked)}
              className="w-4 h-4 rounded accent-emerald-500"
            />
            <span className={`text-sm ${postProcessing.enableBackgroundAudio ? 'text-emerald-300' : 'text-gray-300'}`}>保留背景音</span>
          </label>

          <label className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${postProcessing.enableOriginalSubtitle ? 'bg-red-500/20 border border-red-500/50' : 'bg-white/5 border border-white/10 hover:border-red-500/30'}`}>
            <input
              type="checkbox"
              checked={!!postProcessing.enableOriginalSubtitle}
              onChange={(e) => updatePostProcessing('enableOriginalSubtitle', e.target.checked)}
              className="w-4 h-4 rounded accent-red-500"
            />
            <span className={`text-sm ${postProcessing.enableOriginalSubtitle ? 'text-red-300' : 'text-gray-300'}`}>删除原字幕</span>
          </label>
        </div>
      </div>

      {/* 翻译语言选择 */}
      {postProcessing.enableTranslateSubtitle && (
        <div className="mb-4 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
          <label className="flex items-center gap-3">
            <svg className="w-5 h-5 text-cyan-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
            <span className="text-sm text-cyan-300">目标翻译语言</span>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="ml-auto bg-white/10 border border-cyan-500/30 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-cyan-400"
            >
              {languageOptions.map(lang => (
                <option key={lang.value} value={lang.value} className="bg-gray-900">
                  {lang.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* 步骤链（显示进度） */}
      <div className="mb-4">
        <h4 className="text-sm text-gray-400 mb-2">处理进度</h4>
        <div className="flex flex-wrap gap-2">
          {POST_PROCESS_STEPS.map((step, index) => {
            const state = stepStates[step.key];
            const isActive = currentStepKey === step.key;
            const isCompleted = state.status === 'completed';
            const isSkipped = state.status === 'skipped';
            
            const colorClasses: Record<string, string> = {
              orange: isActive ? 'bg-orange-500 border-orange-500 text-white' : isCompleted ? 'bg-green-500/20 border-green-500 text-green-400' : isSkipped ? 'bg-gray-500/20 border-gray-500 text-gray-400' : 'bg-white/5 border-white/20 text-gray-400',
              cyan: isActive ? 'bg-cyan-500 border-cyan-500 text-white' : isCompleted ? 'bg-green-500/20 border-green-500 text-green-400' : isSkipped ? 'bg-gray-500/20 border-gray-500 text-gray-400' : 'bg-white/5 border-white/20 text-gray-400',
              blue: isActive ? 'bg-blue-500 border-blue-500 text-white' : isCompleted ? 'bg-green-500/20 border-green-500 text-green-400' : isSkipped ? 'bg-gray-500/20 border-gray-500 text-gray-400' : 'bg-white/5 border-white/20 text-gray-400',
              purple: isActive ? 'bg-purple-500 border-purple-500 text-white' : isCompleted ? 'bg-green-500/20 border-green-500 text-green-400' : isSkipped ? 'bg-gray-500/20 border-gray-500 text-gray-400' : 'bg-white/5 border-white/20 text-gray-400',
              amber: isActive ? 'bg-amber-500 border-amber-500 text-white' : isCompleted ? 'bg-green-500/20 border-green-500 text-green-400' : isSkipped ? 'bg-gray-500/20 border-gray-500 text-gray-400' : 'bg-white/5 border-white/20 text-gray-400',
              pink: isActive ? 'bg-pink-500 border-pink-500 text-white' : isCompleted ? 'bg-green-500/20 border-green-500 text-green-400' : isSkipped ? 'bg-gray-500/20 border-gray-500 text-gray-400' : 'bg-white/5 border-white/20 text-gray-400',
            };

            return (
              <div key={step.key} className="flex items-center">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${colorClasses[step.color]}`}>
                  {isActive && (
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {isCompleted && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {isSkipped && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  )}
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
                {index < POST_PROCESS_STEPS.length - 1 && (
                  <svg className="w-4 h-4 text-gray-500 mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // 渲染视频上传区域（两个模式共用）
  const renderVideoUpload = () => (
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
  );

  // 渲染已上传视频列表（两个模式共用）
  const renderVideoList = () => (
    videos.length > 0 && (
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
    )
  );

  // 渲染语音识别按钮（两个模式共用）
  const renderTranscribeButton = () => (
    videos.length > 0 && (
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
    )
  );

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <p className="text-label mb-2">{t.videoEdit.workspace.toUpperCase()}</p>
            <h1 className="text-mono-lg text-white">{t.videoEdit.title}</h1>
          </div>
          <div className="flex gap-2">
            {user && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="px-4 py-2 text-sm bg-white/5 border border-white/10 text-gray-300 rounded-lg hover:bg-white/10"
              >
                {showHistory ? t.videoEdit.backToGenerator : t.videoEdit.viewHistory}
              </button>
            )}
            <a href="/image-generator" className="px-4 py-2 text-sm bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 inline-block">
              🖼️ 生成封面
            </a>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 text-red-400">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-500/10 backdrop-blur-sm rounded-2xl border border-green-500/30 text-green-400">
            {successMessage}
          </div>
        )}

        {!showHistory ? (
          <>
            {/* 模式切换开关 */}
            {renderModeSwitch()}

            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mb-6">
              {/* 后期处理模式 */}
              {pageMode === 'postProcess' ? (
                <form onSubmit={handlePostProcessSubmit} className="space-y-6">
                  {renderVideoUpload()}
                  {renderVideoList()}

                  {/* 配音音色选择（启用配音时显示） */}
                  {pageMode === 'postProcess' && postProcessing.enableTTS && (
                    <div className="border-t border-white/10 pt-6">
                      <h3 className="text-label mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        配音音色
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {(() => {
                          // 按 category 分组
                          const categories = [...new Set(voicePresets.map(v => v.category))];
                          return categories.map(cat => (
                            <div key={cat}>
                              <p className="text-xs text-gray-500 mb-2">{cat}</p>
                              <div className="space-y-2">
                                {voicePresets.filter(v => v.category === cat).map(preset => (
                                  <label
                                    key={preset.id}
                                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all text-sm ${
                                      ttsVoice === preset.voice
                                        ? 'bg-purple-500/20 border border-purple-500/50 text-purple-300'
                                        : 'bg-white/5 border border-white/10 text-gray-400 hover:border-purple-500/30'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="ttsVoice"
                                      value={preset.voice}
                                      checked={ttsVoice === preset.voice}
                                      onChange={(e) => setTtsVoice(e.target.value)}
                                      className="accent-purple-500"
                                    />
                                    {preset.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}

                  {/* 多人配音配置（说话人分离后显示） */}
                  {pageMode === 'postProcess' && voiceAssignments.length > 0 && (
                    <div className="border-t border-white/10 pt-6">
                      <h3 className="text-label mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        多人配音分配
                      </h3>
                      <div className="space-y-3">
                        {voiceAssignments.map((assignment, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                            <span className="text-sm text-gray-400 min-w-[80px]">{assignment.speakerId}</span>
                            <select
                              value={assignment.voice}
                              onChange={(e) => {
                                const newAssignments = [...voiceAssignments];
                                const preset = voicePresets.find(p => p.voice === e.target.value);
                                newAssignments[idx] = {
                                  ...assignment,
                                  voice: e.target.value,
                                  label: preset?.label || e.target.value,
                                };
                                setVoiceAssignments(newAssignments);
                              }}
                              className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
                            >
                              {voicePresets.map(preset => (
                                <option key={preset.voice} value={preset.voice} className="bg-gray-900">
                                  {preset.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">已检测到 {voiceAssignments.length} 个说话人，可为每个角色分配不同音色</p>
                    </div>
                  )}

                  {renderPostProcessingOptions()}
                  
                  {/* 提交/确认按钮区域 */}
                  <div className="space-y-4">
                    {awaitingConfirmation ? (
                      <div className="flex flex-col gap-4">
                        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                          <p className="text-sm text-amber-300 mb-2">📝 请确认识别文案是否正确，可编辑修改后继续</p>
                          {ttsScript && (
                            <>
                              {/* 每个时间戳行可直接编辑 */}
                              <div className="mb-2 max-h-80 overflow-y-auto space-y-2 pr-1">
                                {(() => {
                                  const segments = asrSegments.length > 0 ? asrSegments : null
                                  const fmtTime = (s: number) => {
                                    const m = Math.floor(s / 60)
                                    const sec = Math.floor(s % 60)
                                    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
                                  }
                                  if (segments) {
                                    return segments.map((seg, idx) => {
                                      // 实时取当前可编辑的文本
                                      const segValue = asrSegments[idx]?.text || ''
                                      return (
                                        <div key={idx} className="flex items-start gap-2 p-1.5 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                                          <span className="text-xs text-amber-400 font-mono whitespace-nowrap mt-1.5 min-w-[100px]">
                                            {fmtTime(seg.start)} → {fmtTime(seg.end)}
                                          </span>
                                          {seg.speaker && (
                                            <span className="text-xs text-gray-500 font-mono mt-1.5 min-w-[70px]">[{seg.speaker}]</span>
                                          )}
                                          <input
                                            type="text"
                                            value={segValue}
                                            onChange={(e) => {
                                              const newVal = e.target.value
                                              setAsrSegments(prev => {
                                                const updated = prev.map((s, i) =>
                                                  i === idx ? { ...s, text: newVal } : s
                                                )
                                                // 修改任意段后自动拼接到 ttsScript
                                                const combined = updated.map(s => s.text).join('')
                                                setTtsScript(combined)
                                                return updated
                                              })
                                            }}
                                            className="flex-1 bg-transparent border-b border-transparent hover:border-amber-500/30 focus:border-amber-500/50 focus:outline-none text-sm text-gray-200 px-1 py-1 transition-colors"
                                            placeholder="编辑此段..."
                                          />
                                        </div>
                                      )
                                    })
                                  }
                                  // 降级：无声时间戳时显示完整文本
                                  return (
                                    <textarea
                                      value={ttsScript}
                                      onChange={(e) => setTtsScript(e.target.value)}
                                      rows={5}
                                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-amber-500/50 resize-y"
                                      placeholder="编辑文案..."
                                    />
                                  )
                                })()}
                              </div>
                            </>
                          )}
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={handleContinuePostProcess}
                              disabled={isProcessing}
                              className="flex-1 py-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:bg-gray-700 font-medium transition-colors"
                            >
                              ✅ 确认并继续处理
                            </button>
                            <button
                              type="button"
                              onClick={() => { setAwaitingConfirmation(false); setIsProcessing(false); setCurrentProcessStep(''); }}
                              className="px-6 py-3 bg-white/10 text-gray-300 rounded-xl hover:bg-white/20 font-medium transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <button
                          type="submit"
                          disabled={isProcessing || videos.length === 0}
                          className="flex-1 py-3 bg-purple-500 text-white rounded-xl hover:bg-purple-600 disabled:bg-gray-700 disabled:cursor-not-allowed font-medium transition-colors"
                        >
                          {isProcessing ? (currentProcessStep || '处理中...') : '🚀 开始后期处理'}
                        </button>
                        {isProcessing && (
                          <div className="flex-1">
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                              <span className="truncate max-w-[200px]">{currentProcessStep || '进度'}</span>
                              <span className="font-mono ml-2">{Math.round(progress)}%</span>
                            </div>
                            <div className="w-full bg-white/10 rounded-full h-2">
                              <div
                                className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              ) : pageMode === 'textToVideo' ? (
                /* 文生视频模式 */
                <div className="space-y-6">
                  <div>
                    <label className="block text-label mb-2">视频描述 / PROMPT</label>
                    <textarea value={t2vPrompt} onChange={e => { setT2vPrompt(e.target.value); setT2vVideoUrl('') }}
                      placeholder="描述你想生成的视频内容..."
                      className="input-dark min-h-[120px] resize-y" rows={4} />
                  </div>
                  <div>
                    <label className="block text-label mb-2">画面比例 / ASPECT RATIO</label>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { value: '16:9', label: '横屏 16:9' },
                        { value: '9:16', label: '竖屏 9:16' },
                        { value: '1:1', label: '方形 1:1' },
                      ].map(opt => (
                        <button key={opt.value} type="button" onClick={() => setT2vAspectRatio(opt.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs ${t2vAspectRatio === opt.value ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleTextToVideo} disabled={t2vPolling || !t2vPrompt.trim()}
                    className="w-full px-4 py-3 bg-cyan-500 text-white rounded-xl hover:bg-cyan-600 disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors font-mono text-sm">
                    {t2vPolling ? t2vMessage || '提交中...' : '✨ 生成视频'}
                  </button>
                  {t2vTaskId && (
                    <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-xs text-cyan-400 font-mono break-all">
                      任务 ID: {t2vTaskId}<br />{t2vMessage}
                    </div>
                  )}
                  {t2vVideoUrl && (
                    <div>
                      <video src={t2vVideoUrl} controls className="w-full rounded-xl max-h-[400px]" />
                      <p className="text-xs text-gray-500 mt-2 font-mono">链接 24 小时内有效，可右键下载</p>
                    </div>
                  )}
                </div>
              ) : (
                /* 剪辑模式 */
                <form onSubmit={handleEditSubmit} className="space-y-6">
                  {renderVideoUpload()}
                  {renderVideoList()}

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
              )}
            </div>

            {outputUrl && (
              <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                <h3 className="text-label mb-4">{t.videoEdit.outputResult.toUpperCase()}</h3>
                <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                  <div>
                    <p className="text-emerald-400 font-mono">{t.videoEdit.processingComplete.toUpperCase()}</p>
                <a href={outputUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 mt-1 inline-block">
                  {t.videoEdit.downloadVideo.toUpperCase()} ↗
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
                            <a href={task.downloadUrl || task.outputPath} target="_blank" rel="noopener noreferrer"
                              className="px-3 py-1 text-sm bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30">
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

// 解析 style 中的分辨率信息
function parseStyleWithResolution(styleStr: string): { style: string; resolution: string } {
  // 检查是否包含常见分辨率标识
  const resolutionPatterns = ['1080p', '720p', '4k', '9:16', '1:1', '4:3', '16:9', 'original'];
  const parts = styleStr.split('|');
  
  // 如果 style 中包含分辨率信息
  for (const part of parts) {
    if (resolutionPatterns.includes(part)) {
      const style = parts.filter(p => !resolutionPatterns.includes(p)).join('|') || '标准';
      return { style, resolution: part };
    }
  }
  
  // 如果没有分辨率信息，返回默认值
  return { style: '标准', resolution: '1080p' };
}
