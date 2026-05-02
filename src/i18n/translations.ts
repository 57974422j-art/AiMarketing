export type Locale = 'zh' | 'en';

export interface Translations {
  common: {
    locale: 'zh' | 'en';
    login: string;
    register: string;
    logout: string;
    submit: string;
    cancel: string;
    delete: string;
    edit: string;
    create: string;
    update: string;
    add: string;
    yes: string;
    no: string;
    success: string;
    error: string;
    loading: string;
    search: string;
    save: string;
    back: string;
    confirm: string;
    open: string;
    noData: string;
  };
  auth: {
    account: string;
    email: string;
    password: string;
    confirmPassword: string;
    inviteCode: string;
    rememberMe: string;
    forgotPassword: string;
    dontHaveAccount: string;
    alreadyHaveAccount: string;
    welcome: string;
    signIn: string;
    signUp: string;
    invalidCredentials: string;
    passwordMismatch: string;
    emailRequired: string;
    passwordRequired: string;
    registrationSuccess: string;
    loginSuccess: string;
    pleaseLogin: string;
  };
  nav: {
    dashboard: string;
    projects: string;
    accounts: string;
    aiCopy: string;
    aiAgent: string;
    videoEdit: string;
    leadCollector: string;
    referral: string;
    nfcPromo: string;
    digitalHuman: string;
    textToVideo: string;
    team: string;
    settings: string;
  };
  dashboard: {
    overview: string;
    title: string;
    platformStats: string;
    todayViews: string;
    totalViews: string;
    todayLikes: string;
    totalLikes: string;
    todayComments: string;
    totalComments: string;
    todayFollowers: string;
    totalFollowers: string;
    avgWatchTime: string;
    engagementRate: string;
    platform: string;
    views: string;
    likes: string;
    followers: string;
    videos: string;
  };
  projects: {
    workspace: string;
    title: string;
    newProject: string;
    projectName: string;
    industry: string;
    goal: string;
    style: string;
    createProject: string;
    projectList: string;
    status: string;
    actions: string;
    running: string;
    completed: string;
    pending: string;
    deleteConfirm: string;
  };
  accounts: {
    management: string;
    title: string;
    addAccount: string;
    platform: string;
    accountName: string;
    bindType: string;
    status: string;
    action: string;
    bound: string;
    unbound: string;
    unbind: string;
    unbindConfirm: string;
    official: string;
    manual: string;
    device: string;
    accountAdded: string;
    addFailed: string;
    douyin: string;
    kuaishou: string;
    xigua: string;
    bilibili: string;
    youtube: string;
    tiktok: string;
  };
  aiCopy: {
    workspace: string;
    title: string;
    generate: string;
    keywords: string;
    platform: string;
    tone: string;
    length: string;
    count: string;
    content: string;
    regenerate: string;
    copy: string;
    copied: string;
    humorous: string;
    professional: string;
    casual: string;
    emotional: string;
    short: string;
    medium: string;
    long: string;
  };
  aiAgent: {
    management: string;
    title: string;
    addAgent: string;
    agentName: string;
    description: string;
    knowledge: string;
    replyStyle: string;
    editAgent: string;
    deleteAgent: string;
    deleteConfirm: string;
    documents: string;
    addDocument: string;
    smartReply: string;
    fast: string;
    detailed: string;
    friendly: string;
  };
  leadCollector: {
    management: string;
    title: string;
    addTask: string;
    editTask: string;
    tasks: string;
    leads: string;
    taskName: string;
    targetUrl: string;
    keywords: string;
    start: string;
    stop: string;
    delete: string;
    running: string;
    pending: string;
    done: string;
    allTasks: string;
    noData: string;
    contact: string;
    view: string;
  };
  referral: {
    management: string;
    title: string;
    triggerTest: string;
    reset: string;
  };
  videoEdit: {
    workspace: string;
    title: string;
    batchEdit: string;
    uploadVideo: string;
    dragOrClick: string;
    clearAll: string;
    uploadedFiles: string;
    template: string;
    duration: string;
    style: string;
    resolution: string;
    startProcessing: string;
    processing: string;
    progress: string;
    outputResult: string;
    processingComplete: string;
    downloadVideo: string;
    shareToLibrary: string;
    shareSuccess: string;
    shareFailed: string;
    history: string;
    noHistory: string;
    delete: string;
    deleteSuccess: string;
    deleteFailed: string;
    confirmDelete: string;
    backToGenerator: string;
    viewHistory: string;
    mix: string;
    quickCut: string;
    storyboard: string;
    loop: string;
    dynamic: string;
    elegant: string;
    vintage: string;
    minimal: string;
    seconds: string;
    unsupportedFormat: string;
    pleaseUploadVideo: string;
    uploadFailed: string;
    processingFailed: string;
    unknown: string;
    videoTemplate: string;
    processedVideo: string;
  };
  nfcPromo: {
    title: string;
    tapPromo: string;
  };
  digitalHuman: {
    workspace: string;
    title: string;
  };
  textToVideo: {
    workspace: string;
    title: string;
    createNew: string;
    titleOptional: string;
    promptRequired: string;
    describeVideo: string;
    duration: string;
    style: string;
    cameraMovement: string;
    generate: string;
    generating: string;
    generatingProgress: string;
    analyzingPrompt: string;
    renderingFrames: string;
    processingLight: string;
    synthesizingAudio: string;
    promptTips: string;
    describeScene: string;
    specifyCamera: string;
    describeMotion: string;
    specifyStyle: string;
    sceneSuggestions: string;
    citySkyline: string;
    citySkylineDesc: string;
    productDisplay: string;
    productDisplayDesc: string;
    natureScenery: string;
    natureSceneryDesc: string;
    foodCloseUp: string;
    foodCloseUpDesc: string;
    useCases: string;
    socialMedia: string;
    ecommerce: string;
    brandPromotion: string;
    educational: string;
    personalIp: string;
    historyRecords: string;
    preview: string;
    download: string;
    seconds: string;
    pleaseInputPrompt: string;
    videoGenerated: string;
  };
  team: {
    management: string;
    title: string;
    addMember: string;
    username: string;
    role: string;
    admin: string;
    editor: string;
    viewer: string;
    removeMember: string;
    removeConfirm: string;
  };
  home: {
    initialized: string;
    videoProcessing: string;
    aiModules: string;
    accounts: string;
    quota: string;
    systemStatus: string;
    projects: string;
    online: string;
    launch: string;
    videoEdit: string;
    aiCopy: string;
    aiAgent: string;
  };
}

export const zh: Translations = {
  common: {
    locale: 'zh',
    login: '登录',
    register: '注册',
    logout: '退出登录',
    submit: '提交',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    create: '创建',
    update: '更新',
    add: '添加',
    yes: '是',
    no: '否',
    success: '成功',
    error: '错误',
    loading: '加载中...',
    search: '搜索',
    save: '保存',
    back: '返回',
    confirm: '确认',
    open: '打开',
    noData: '暂无数据',
  },
  auth: {
    account: '账号',
    email: '邮箱',
    password: '密码',
    confirmPassword: '确认密码',
    inviteCode: '邀请码',
    rememberMe: '记住我',
    forgotPassword: '忘记密码',
    dontHaveAccount: '还没有账号？',
    alreadyHaveAccount: '已有账号？',
    welcome: '欢迎回来',
    signIn: '登录',
    signUp: '注册',
    invalidCredentials: '邮箱或密码错误',
    passwordMismatch: '两次输入的密码不一致',
    emailRequired: '请输入邮箱',
    passwordRequired: '请输入密码',
    registrationSuccess: '注册成功',
    loginSuccess: '登录成功',
    pleaseLogin: '请先登录',
  },
  nav: {
    dashboard: '仪表盘',
    projects: '项目',
    accounts: '账号',
    aiCopy: '文案生成',
    aiAgent: 'AI员工',
    videoEdit: '视频剪辑',
    leadCollector: '客户采集',
    referral: '导流配置',
    nfcPromo: 'NFC推广',
    digitalHuman: '数字人',
    textToVideo: '文生视频',
    team: '团队',
    settings: '设置',
  },
  dashboard: {
    overview: '总览',
    title: '仪表盘',
    platformStats: '平台数据详情',
    todayViews: '今日播放',
    totalViews: '累计播放',
    todayLikes: '今日点赞',
    totalLikes: '累计点赞',
    todayComments: '今日评论',
    totalComments: '累计评论',
    todayFollowers: '今日新增',
    totalFollowers: '累计粉丝',
    avgWatchTime: '平均观看时长',
    engagementRate: '互动率',
    platform: '平台',
    views: '播放量',
    likes: '点赞',
    followers: '粉丝',
    videos: '视频数',
  },
  projects: {
    workspace: '工作区',
    title: '项目管理',
    newProject: '新建项目',
    projectName: '项目名称',
    industry: '行业',
    goal: '目标',
    style: '风格',
    createProject: '创建项目',
    projectList: '项目列表',
    status: '状态',
    actions: '操作',
    running: '进行中',
    completed: '已完成',
    pending: '待开始',
    deleteConfirm: '确定要删除此项目吗？',
  },
  accounts: {
    management: '平台管理',
    title: '账号管理',
    addAccount: '添加账号',
    platform: '平台',
    accountName: '账号名称',
    bindType: '绑定类型',
    status: '状态',
    action: '操作',
    bound: '已绑定',
    unbound: '未绑定',
    unbind: '解绑',
    unbindConfirm: '确定要解绑此账号吗？',
    official: '官方授权',
    manual: '手动录入',
    device: '设备绑定',
    accountAdded: '账号添加成功',
    addFailed: '添加失败',
    douyin: '抖音',
    kuaishou: '快手',
    xigua: '西瓜视频',
    bilibili: 'B站',
    youtube: 'YouTube',
    tiktok: 'TikTok',
  },
  aiCopy: {
    workspace: 'AI工作区',
    title: '文案生成',
    generate: '生成文案',
    keywords: '关键词',
    platform: '平台',
    tone: '风格',
    length: '长度',
    count: '数量',
    content: '内容',
    regenerate: '重新生成',
    copy: '复制',
    copied: '已复制',
    humorous: '幽默风趣',
    professional: '专业严谨',
    casual: '轻松随意',
    emotional: '情感丰富',
    short: '简短',
    medium: '中等',
    long: '长篇',
  },
  aiAgent: {
    management: 'AI员工管理',
    title: '智能体',
    addAgent: '添加智能体',
    agentName: '智能体名称',
    description: '描述',
    knowledge: '知识库',
    replyStyle: '回复风格',
    editAgent: '编辑智能体',
    deleteAgent: '删除智能体',
    deleteConfirm: '确定要删除此智能体吗？',
    documents: '文档管理',
    addDocument: '添加文档',
    smartReply: '智能回复',
    fast: '快速回复',
    detailed: '详细解答',
    friendly: '友好亲切',
  },
  leadCollector: {
    management: '意向客户管理',
    title: '客户采集',
    addTask: '添加任务',
    editTask: '编辑任务',
    tasks: '任务',
    leads: '客户',
    taskName: '任务名称',
    targetUrl: '目标网址',
    keywords: '关键词',
    start: '启动',
    stop: '停止',
    delete: '删除',
    running: '运行中',
    pending: '待启动',
    done: '已完成',
    allTasks: '全部任务',
    noData: '暂无数据',
    contact: '联系',
    view: '查看',
  },
  referral: {
    management: '导流管理',
    title: '导流配置',
    triggerTest: '导流触发测试',
    reset: '重置',
  },
  videoEdit: {
    workspace: '工作区',
    title: '视频批量编辑',
    batchEdit: '批量编辑',
    uploadVideo: '上传视频',
    dragOrClick: '拖拽文件或点击上传',
    clearAll: '清除全部',
    uploadedFiles: '已上传 {count} 个文件',
    template: '模板',
    duration: '时长',
    style: '风格',
    resolution: '分辨率',
    startProcessing: '开始处理',
    processing: '处理中...',
    progress: '进度',
    outputResult: '输出结果',
    processingComplete: '处理完成',
    downloadVideo: '下载视频',
    shareToLibrary: '分享到创意库',
    shareSuccess: '已提交到创意库，待审核后展示',
    shareFailed: '分享失败',
    history: '历史记录',
    noHistory: '暂无历史记录',
    delete: '删除',
    deleteSuccess: '删除成功',
    deleteFailed: '删除失败',
    confirmDelete: '确定要删除这个视频吗？',
    backToGenerator: '返回生成',
    viewHistory: '查看历史',
    mix: '混剪',
    quickCut: '快剪',
    storyboard: '故事板',
    loop: '循环',
    dynamic: '动感',
    elegant: '优雅',
    vintage: '复古',
    minimal: '简约',
    seconds: '秒',
    unsupportedFormat: '文件 {name} 格式不支持，仅支持 mp4、mov、avi 格式',
    pleaseUploadVideo: '请至少上传一个视频文件',
    uploadFailed: '上传失败，请检查网络连接或服务器状态',
    processingFailed: '视频处理失败',
    unknown: '未知',
    videoTemplate: '视频模板',
    processedVideo: '使用{type}模板处理的视频',
  },
  nfcPromo: {
    title: 'NFC推广',
    tapPromo: '碰一碰推广',
  },
  digitalHuman: {
    workspace: 'AI工作区',
    title: '数字人视频',
  },
  textToVideo: {
    workspace: 'AI工作区',
    title: '文生视频',
    createNew: '创建新视频',
    titleOptional: '标题（选填）',
    promptRequired: '视频描述（必填）',
    describeVideo: '描述你的视频场景...',
    duration: '时长',
    style: '风格',
    cameraMovement: '镜头运动',
    generate: '生成视频',
    generating: '生成中...',
    generatingProgress: '生成进度',
    analyzingPrompt: '分析提示词内容...',
    renderingFrames: '渲染关键帧...',
    processingLight: '处理光影效果...',
    synthesizingAudio: '合成音频...',
    promptTips: '提示词技巧',
    describeScene: '描述场景：地点、时间、天气、光线',
    specifyCamera: '指定镜头：航拍、特写、平移等',
    describeMotion: '描述主体运动：移动和变化',
    specifyStyle: '指定风格：电影感、纪录片、动画',
    sceneSuggestions: '场景推荐',
    citySkyline: '城市天际线',
    citySkylineDesc: '日落时分的城市航拍',
    productDisplay: '产品展示',
    productDisplayDesc: '3D产品360度旋转',
    natureScenery: '自然风光',
    natureSceneryDesc: '日出云海',
    foodCloseUp: '美食特写',
    foodCloseUpDesc: '慢动作烹饪过程',
    useCases: '使用场景',
    socialMedia: '社交媒体内容',
    ecommerce: '电商产品视频',
    brandPromotion: '品牌宣传片',
    educational: '在线教育课程',
    personalIp: '个人IP视频',
    historyRecords: '历史记录',
    preview: '预览',
    download: '下载',
    seconds: '秒',
    pleaseInputPrompt: '请输入视频描述',
    videoGenerated: '视频已生成',
  },
  team: {
    management: '团队管理',
    title: '团队',
    addMember: '添加成员',
    username: '用户名',
    role: '角色',
    admin: '管理员',
    editor: '编辑者',
    viewer: '查看者',
    removeMember: '移除成员',
    removeConfirm: '确定要移除此成员吗？',
  },
  home: {
    initialized: '系统已就绪',
    videoProcessing: '视频处理',
    aiModules: 'AI模块',
    accounts: '账号',
    quota: '配额',
    systemStatus: '系统状态',
    projects: '项目',
    online: '在线',
    launch: '启动系统',
    videoEdit: '视频剪辑',
    aiCopy: 'AI文案',
    aiAgent: 'AI员工',
  },
};

export const en: Translations = {
  common: {
    locale: 'en',
    login: 'Login',
    register: 'Register',
    logout: 'Logout',
    submit: 'Submit',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    update: 'Update',
    add: 'Add',
    yes: 'Yes',
    no: 'No',
    success: 'Success',
    error: 'Error',
    loading: 'Loading...',
    search: 'Search',
    save: 'Save',
    back: 'Back',
    confirm: 'Confirm',
    open: 'Open',
    noData: 'No data',
  },
  auth: {
    account: 'Account',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    inviteCode: 'Invite Code',
    rememberMe: 'Remember Me',
    forgotPassword: 'Forgot Password',
    dontHaveAccount: "Don't have an account?",
    alreadyHaveAccount: 'Already have an account?',
    welcome: 'Welcome Back',
    signIn: 'Sign In',
    signUp: 'Sign Up',
    invalidCredentials: 'Invalid email or password',
    passwordMismatch: 'Passwords do not match',
    emailRequired: 'Please enter email',
    passwordRequired: 'Please enter password',
    registrationSuccess: 'Registration successful',
    loginSuccess: 'Login successful',
    pleaseLogin: 'Please login first',
  },
  nav: {
    dashboard: 'Dashboard',
    projects: 'Projects',
    accounts: 'Accounts',
    aiCopy: 'AI Copy',
    aiAgent: 'AI Agent',
    videoEdit: 'Video Edit',
    leadCollector: 'Lead Collector',
    referral: 'Referral',
    nfcPromo: 'NFC Promo',
    digitalHuman: 'Digital Human',
    textToVideo: 'Text to Video',
    team: 'Team',
    settings: 'Settings',
  },
  dashboard: {
    overview: 'Overview',
    title: 'Dashboard',
    platformStats: 'Platform Stats',
    todayViews: 'Today Views',
    totalViews: 'Total Views',
    todayLikes: 'Today Likes',
    totalLikes: 'Total Likes',
    todayComments: 'Today Comments',
    totalComments: 'Total Comments',
    todayFollowers: 'Today Followers',
    totalFollowers: 'Total Followers',
    avgWatchTime: 'Avg Watch Time',
    engagementRate: 'Engagement Rate',
    platform: 'Platform',
    views: 'Views',
    likes: 'Likes',
    followers: 'Followers',
    videos: 'Videos',
  },
  projects: {
    workspace: 'Workspace',
    title: 'Project Manager',
    newProject: 'New Project',
    projectName: 'Project Name',
    industry: 'Industry',
    goal: 'Goal',
    style: 'Style',
    createProject: 'Create Project',
    projectList: 'Project List',
    status: 'Status',
    actions: 'Actions',
    running: 'Running',
    completed: 'Completed',
    pending: 'Pending',
    deleteConfirm: 'Are you sure you want to delete this project?',
  },
  accounts: {
    management: 'Platform Management',
    title: 'Accounts',
    addAccount: 'Add Account',
    platform: 'Platform',
    accountName: 'Account Name',
    bindType: 'Bind Type',
    status: 'Status',
    action: 'Action',
    bound: 'Bound',
    unbound: 'Unbound',
    unbind: 'Unbind',
    unbindConfirm: 'Are you sure you want to unbind this account?',
    official: 'Official',
    manual: 'Manual',
    device: 'Device',
    accountAdded: 'Account added successfully',
    addFailed: 'Add failed',
    douyin: 'Douyin',
    kuaishou: 'Kuaishou',
    xigua: 'Xigua',
    bilibili: 'Bilibili',
    youtube: 'YouTube',
    tiktok: 'TikTok',
  },
  aiCopy: {
    workspace: 'AI Workspace',
    title: 'Copy Writer',
    generate: 'Generate Copy',
    keywords: 'Keywords',
    platform: 'Platform',
    tone: 'Tone',
    length: 'Length',
    count: 'Count',
    content: 'Content',
    regenerate: 'Regenerate',
    copy: 'Copy',
    copied: 'Copied',
    humorous: 'Humorous',
    professional: 'Professional',
    casual: 'Casual',
    emotional: 'Emotional',
    short: 'Short',
    medium: 'Medium',
    long: 'Long',
  },
  aiAgent: {
    management: 'AI Employee',
    title: 'AI Agents',
    addAgent: 'Add Agent',
    agentName: 'Agent Name',
    description: 'Description',
    knowledge: 'Knowledge',
    replyStyle: 'Reply Style',
    editAgent: 'Edit Agent',
    deleteAgent: 'Delete Agent',
    deleteConfirm: 'Are you sure you want to delete this agent?',
    documents: 'Documents',
    addDocument: 'Add Document',
    smartReply: 'Smart Reply',
    fast: 'Fast Reply',
    detailed: 'Detailed',
    friendly: 'Friendly',
  },
  leadCollector: {
    management: 'Lead Management',
    title: 'Lead Collector',
    addTask: 'Add Task',
    editTask: 'Edit Task',
    tasks: 'Tasks',
    leads: 'Leads',
    taskName: 'Task Name',
    targetUrl: 'Target URL',
    keywords: 'Keywords',
    start: 'Start',
    stop: 'Stop',
    delete: 'Delete',
    running: 'Running',
    pending: 'Pending',
    done: 'Done',
    allTasks: 'All Tasks',
    noData: 'No Data',
    contact: 'Contact',
    view: 'View',
  },
  referral: {
    management: 'Referral Management',
    title: 'Referral Config',
    triggerTest: 'Referral Trigger Test',
    reset: 'Reset',
  },
  videoEdit: {
    workspace: 'Workspace',
    title: 'Video Batch Editor',
    batchEdit: 'Batch Edit',
    uploadVideo: 'Upload Video',
    dragOrClick: 'Drop files or click to upload',
    clearAll: 'Clear All',
    uploadedFiles: '{count} files uploaded',
    template: 'Template',
    duration: 'Duration',
    style: 'Style',
    resolution: 'Resolution',
    startProcessing: 'Start Processing',
    processing: 'Processing...',
    progress: 'Progress',
    outputResult: 'Output Result',
    processingComplete: 'Processing Complete',
    downloadVideo: 'Download Video',
    shareToLibrary: 'Share to Library',
    shareSuccess: 'Submitted to library, pending review',
    shareFailed: 'Share failed',
    history: 'History',
    noHistory: 'No history records',
    delete: 'Delete',
    deleteSuccess: 'Deleted successfully',
    deleteFailed: 'Delete failed',
    confirmDelete: 'Are you sure you want to delete this video?',
    backToGenerator: 'Back to Generator',
    viewHistory: 'View History',
    mix: 'Mix',
    quickCut: 'Quick Cut',
    storyboard: 'Storyboard',
    loop: 'Loop',
    dynamic: 'Dynamic',
    elegant: 'Elegant',
    vintage: 'Vintage',
    minimal: 'Minimal',
    seconds: 's',
    unsupportedFormat: 'File {name} format not supported. Only MP4, MOV, AVI formats are allowed',
    pleaseUploadVideo: 'Please upload at least one video file',
    uploadFailed: 'Upload failed, please check network connection or server status',
    processingFailed: 'Video processing failed',
    unknown: 'Unknown',
    videoTemplate: 'Video Template',
    processedVideo: 'Video processed with {type} template',
  },
  nfcPromo: {
    title: 'NFC Promo',
    tapPromo: 'NFC Tap Promo',
  },
  digitalHuman: {
    workspace: 'AI Workspace',
    title: 'Digital Human',
  },
  textToVideo: {
    workspace: 'AI Workspace',
    title: 'Text to Video',
    createNew: 'Create New Video',
    titleOptional: 'Title (Optional)',
    promptRequired: 'Prompt (Required)',
    describeVideo: 'Describe your video scene...',
    duration: 'Duration',
    style: 'Style',
    cameraMovement: 'Camera Movement',
    generate: 'Generate Video',
    generating: 'Generating...',
    generatingProgress: 'Generating Progress',
    analyzingPrompt: 'Analyzing prompt content...',
    renderingFrames: 'Rendering key frames...',
    processingLight: 'Processing light and shadow...',
    synthesizingAudio: 'Synthesizing audio...',
    promptTips: 'Prompt Tips',
    describeScene: 'Describe scene: location, time, weather, lighting',
    specifyCamera: 'Specify camera: aerial, close-up, pan, etc.',
    describeMotion: 'Describe subject motion: movement and changes',
    specifyStyle: 'Specify style: cinematic, documentary, animation',
    sceneSuggestions: 'Scene Suggestions',
    citySkyline: 'City Skyline',
    citySkylineDesc: 'Aerial view of city at sunset',
    productDisplay: 'Product Display',
    productDisplayDesc: '3D product 360 rotation',
    natureScenery: 'Nature Scenery',
    natureSceneryDesc: 'Sea of clouds at sunrise',
    foodCloseUp: 'Food Close-Up',
    foodCloseUpDesc: 'Slow motion cooking process',
    useCases: 'Use Cases',
    socialMedia: 'Social Media Content',
    ecommerce: 'E-commerce Product Video',
    brandPromotion: 'Brand Promotion',
    educational: 'Educational Courses',
    personalIp: 'Personal IP Video',
    historyRecords: 'History Records',
    preview: 'Preview',
    download: 'Download',
    seconds: 's',
    pleaseInputPrompt: 'Please input video description',
    videoGenerated: 'Video generated',
  },
  team: {
    management: 'Team Management',
    title: 'Team',
    addMember: 'Add Member',
    username: 'Username',
    role: 'Role',
    admin: 'Admin',
    editor: 'Editor',
    viewer: 'Viewer',
    removeMember: 'Remove Member',
    removeConfirm: 'Are you sure you want to remove this member?',
  },
  home: {
    initialized: 'System Initialized',
    videoProcessing: 'Video Processing',
    aiModules: 'AI Modules',
    accounts: 'Accounts',
    quota: 'Quota',
    systemStatus: 'System Status',
    projects: 'Projects',
    online: 'Online',
    launch: 'Launch System',
    videoEdit: 'Video Edit',
    aiCopy: 'AI Copy',
    aiAgent: 'AI Agent',
  },
};

export const translations: Record<Locale, Translations> = { zh, en };

export const useTranslation = () => {
  const { locale } = { locale: 'zh' } // useLocale;
  return translations[locale];
};
