const mockTasks = [
  {
    id: 1,
    name: '抖音评论区采集',
    platform: '抖音',
    targetUrl: 'https://www.douyin.com/video/xxxxxx',
    keywords: ['想了解', '多少钱', '怎么买', '联系方式'],
    status: 'running',
    collectedCount: 156,
    createdAt: '2026-04-25T09:00:00Z',
    updatedAt: '2026-04-28T14:30:00Z'
  },
  {
    id: 2,
    name: '小红书笔记互动采集',
    platform: '小红书',
    targetUrl: 'https://www.xiaohongshu.com/discovery/item/xxxxxx',
    keywords: ['求链接', '求分享', '哪里买', '好想要'],
    status: 'completed',
    collectedCount: 89,
    createdAt: '2026-04-23T10:00:00Z',
    updatedAt: '2026-04-27T16:00:00Z'
  },
  {
    id: 3,
    name: 'B站视频评论采集',
    platform: 'B站',
    targetUrl: 'https://www.bilibili.com/video/xxxxxx',
    keywords: ['求资源', '教程', '学习', '分享'],
    status: 'pending',
    collectedCount: 0,
    createdAt: '2026-04-28T08:00:00Z',
    updatedAt: '2026-04-28T08:00:00Z'
  },
  {
    id: 4,
    name: '快手直播弹幕采集',
    platform: '快手',
    targetUrl: 'https://live.kuaishou.com/xxxxxx',
    keywords: ['报名', '参加', '咨询', '了解'],
    status: 'running',
    collectedCount: 234,
    createdAt: '2026-04-26T14:00:00Z',
    updatedAt: '2026-04-28T15:00:00Z'
  }
];

const mockLeads = [
  {
    id: 1,
    taskId: 1,
    taskName: '抖音评论区采集',
    username: '美妆达人小美',
    avatar: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=beautiful%20asian%20woman%20avatar%20professional%20portrait&image_size=square',
    content: '想了解这个产品怎么买，多少钱呀？',
    contact: 'wechat: meizhuangxiaomei',
    platform: '抖音',
    createdAt: '2026-04-28T14:25:00Z'
  },
  {
    id: 2,
    taskId: 1,
    taskName: '抖音评论区采集',
    username: '爱购物的小王',
    avatar: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=young%20asian%20man%20casual%20avatar%20portrait&image_size=square',
    content: '这个看起来不错，联系方式是什么？',
    contact: 'phone: 138****8888',
    platform: '抖音',
    createdAt: '2026-04-28T14:18:00Z'
  },
  {
    id: 3,
    taskId: 2,
    taskName: '小红书笔记互动采集',
    username: '时尚辣妈',
    avatar: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=elegant%20asian%20woman%20mother%20avatar%20portrait&image_size=square',
    content: '求链接！好喜欢这个包包',
    contact: 'wechat: fashionshuma',
    platform: '小红书',
    createdAt: '2026-04-27T15:30:00Z'
  },
  {
    id: 4,
    taskId: 4,
    taskName: '快手直播弹幕采集',
    username: '创业青年阿杰',
    avatar: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=young%20asian%20man%20business%20casual%20avatar&image_size=square',
    content: '我想报名参加这个课程',
    contact: 'wechat: chuangyejie',
    platform: '快手',
    createdAt: '2026-04-28T15:05:00Z'
  },
  {
    id: 5,
    taskId: 1,
    taskName: '抖音评论区采集',
    username: '精致女孩Lisa',
    avatar: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=beautiful%20asian%20girl%20kawaii%20avatar%20portrait&image_size=square',
    content: '多少钱呀？看起来很好用',
    contact: 'wechat: lisa_jingzhi',
    platform: '抖音',
    createdAt: '2026-04-28T13:45:00Z'
  },
  {
    id: 6,
    taskId: 2,
    taskName: '小红书笔记互动采集',
    username: '宝妈朵朵',
    avatar: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=young%20asian%20mother%20warm%20smile%20avatar&image_size=square',
    content: '求分享链接，太喜欢了',
    contact: 'wechat: baoma_duoduo',
    platform: '小红书',
    createdAt: '2026-04-27T14:20:00Z'
  }
];

const platforms = ['抖音', '快手', '小红书', 'B站', '微博', '视频号'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'tasks';
  const taskId = url.searchParams.get('taskId');
  
  let data = type === 'leads' ? mockLeads : mockTasks;
  
  if (taskId && type === 'leads') {
    data = mockLeads.filter((lead: any) => lead.taskId === parseInt(taskId));
  }
  
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'tasks';
  const body = await request.json();
  
  if (type === 'leads') {
    const newId = Math.max(...mockLeads.map((l: any) => l.id)) + 1;
    const newLead = {
      id: newId,
      ...body,
      createdAt: new Date().toISOString()
    };
    return new Response(JSON.stringify({ success: true, data: newLead }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } else {
    const newId = Math.max(...mockTasks.map((t: any) => t.id)) + 1;
    const newTask = {
      id: newId,
      ...body,
      status: 'pending',
      collectedCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return new Response(JSON.stringify({ success: true, data: newTask }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function PUT(request: Request) {
  const body = await request.json();
  const { id, ...updateData } = body;
  
  const mockIndex = mockTasks.findIndex((t: any) => t.id === id);
  if (mockIndex !== -1) {
    mockTasks[mockIndex] = {
      ...mockTasks[mockIndex],
      ...updateData,
      updatedAt: new Date().toISOString()
    };
  }
  
  return new Response(JSON.stringify({ success: true, data: mockTasks.find((t: any) => t.id === id) }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0');
  
  const index = mockTasks.findIndex((t: any) => t.id === id);
  if (index !== -1) {
    mockTasks.splice(index, 1);
  }
  
  return new Response(JSON.stringify({ success: true, message: '删除成功' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export { platforms };