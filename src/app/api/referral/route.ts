const mockReferrals = [
  {
    id: 1,
    name: '抖音直播间导流',
    platform: '抖音',
    triggerType: '直播间评论',
    keyword: '福利',
    responseMessage: '感谢您的关注！私信回复【福利】领取专属优惠券~',
    qrcodeUrl: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=QR%20code%20for%20WeChat%20group%20invitation%20simple%20clean%20design&image_size=square',
    status: 'active',
    dailyLimit: 100,
    todayCount: 45,
    createdAt: '2026-04-20T10:00:00Z',
    updatedAt: '2026-04-27T15:30:00Z'
  },
  {
    id: 2,
    name: '小红书私信导流',
    platform: '小红书',
    triggerType: '私信关键词',
    keyword: '加群',
    responseMessage: '哈喽~ 点击下方链接加入我们的专属社群，获取更多干货内容！',
    qrcodeUrl: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=QR%20code%20for%20community%20group%20invitation%20pink%20style&image_size=square',
    status: 'active',
    dailyLimit: 50,
    todayCount: 23,
    createdAt: '2026-04-22T09:00:00Z',
    updatedAt: '2026-04-28T10:00:00Z'
  },
  {
    id: 3,
    name: '快手短视频评论',
    platform: '快手',
    triggerType: '视频评论',
    keyword: '666',
    responseMessage: '感谢支持！私信我【666】领取神秘礼物~',
    qrcodeUrl: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=QR%20code%20gift%20promotion%20orange%20color%20theme&image_size=square',
    status: 'paused',
    dailyLimit: 80,
    todayCount: 0,
    createdAt: '2026-04-18T14:00:00Z',
    updatedAt: '2026-04-25T11:00:00Z'
  },
  {
    id: 4,
    name: 'B站视频置顶评论',
    platform: 'B站',
    triggerType: '置顶评论',
    keyword: '',
    responseMessage: '欢迎来到我的频道！关注后私信【资源】获取学习资料包~',
    qrcodeUrl: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=QR%20code%20learning%20materials%20blue%20academic%20style&image_size=square',
    status: 'active',
    dailyLimit: 200,
    todayCount: 156,
    createdAt: '2026-04-15T08:00:00Z',
    updatedAt: '2026-04-28T09:00:00Z'
  }
];

const platforms = ['抖音', '快手', '小红书', 'B站', '微博', '视频号'];
const triggerTypes = ['直播间评论', '私信关键词', '视频评论', '置顶评论', '自动回复'];

export async function GET(request: Request) {
  return new Response(JSON.stringify({ success: true, data: mockReferrals }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, platform, triggerType, keyword, responseMessage, dailyLimit } = body;
  
  const newId = Math.max(...mockReferrals.map((r: any) => r.id)) + 1;
  const newReferral = {
    id: newId,
    name,
    platform,
    triggerType,
    keyword: keyword || '',
    responseMessage,
    qrcodeUrl: `https://neeko-copilot.bytedance.net/api/text_to_image?prompt=QR%20code%20${encodeURIComponent(name)}&image_size=square`,
    status: 'active',
    dailyLimit: dailyLimit || 100,
    todayCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  return new Response(JSON.stringify({ success: true, data: newReferral }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const { id, ...updateData } = body;
  
  const mockIndex = mockReferrals.findIndex((r: any) => r.id === id);
  if (mockIndex !== -1) {
    mockReferrals[mockIndex] = {
      ...mockReferrals[mockIndex],
      ...updateData,
      updatedAt: new Date().toISOString()
    };
  }
  
  return new Response(JSON.stringify({ success: true, data: mockReferrals.find((r: any) => r.id === id) }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0');
  
  const index = mockReferrals.findIndex((r: any) => r.id === id);
  if (index !== -1) {
    mockReferrals.splice(index, 1);
  }
  
  return new Response(JSON.stringify({ success: true, message: '删除成功' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

