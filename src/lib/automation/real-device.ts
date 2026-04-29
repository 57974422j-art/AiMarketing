import { AutomationEngine, AccountInfo, LoginResult, PublishResult, MessageResult, LeadResult, StatusResult, LeadInfo } from './engine'

export class RealDeviceEngine implements AutomationEngine {
  private deviceName: string

  constructor(deviceName: string = '') {
    this.deviceName = deviceName
  }

  async login(platform: string, account: AccountInfo): Promise<LoginResult> {
    const targetDevice = this.deviceName || account.deviceName || 'default_device'
    console.log(`[Real Device] 连接真机: ${targetDevice}`)
    console.log(`[Real Device] 在 ${targetDevice} 上登录 ${platform}`)
    
    const mockSessionId = `device_${targetDevice}_${platform}_${Date.now()}`
    
    return {
      success: true,
      message: `${targetDevice} 真机登录成功`,
      sessionId: mockSessionId,
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
    }
  }

  async publishVideo(platform: string, account: AccountInfo, videoPath: string, caption: string): Promise<PublishResult> {
    const targetDevice = this.deviceName || account.deviceName || 'default_device'
    console.log(`[Real Device] ${targetDevice} 发布视频: ${videoPath}`)
    
    const mockPostId = `device_post_${Date.now()}`
    const mockUrl = `https://${platform}.com/device/${mockPostId}`
    
    return {
      success: true,
      message: `视频通过真机 ${targetDevice} 发布成功`,
      postId: mockPostId,
      url: mockUrl
    }
  }

  async sendPrivateMessage(platform: string, account: AccountInfo, targetUser: string, message: string): Promise<MessageResult> {
    const targetDevice = this.deviceName || account.deviceName || 'default_device'
    console.log(`[Real Device] ${targetDevice} 发送私信给: ${targetUser}`)
    
    const mockMessageId = `device_msg_${Date.now()}`
    
    return {
      success: true,
      message: `私信通过真机 ${targetDevice} 发送成功`,
      messageId: mockMessageId
    }
  }

  async collectLeads(platform: string, account: AccountInfo, keywords: string[]): Promise<LeadResult> {
    const targetDevice = this.deviceName || account.deviceName || 'default_device'
    console.log(`[Real Device] ${targetDevice} 采集意向用户`)
    
    const mockLeads: LeadInfo[] = Array.from({ length: 10 }, (_, i) => ({
      userId: `device_user_${i + 1}`,
      nickname: `真机用户${i + 1}`,
      avatar: `https://example.com/device_avatar${i + 1}.jpg`,
      followers: Math.floor(Math.random() * 10000),
      bio: '通过真机采集的用户',
      contact: `device_user${i + 1}@example.com`
    }))
    
    return {
      success: true,
      message: `通过真机 ${targetDevice} 成功采集到 ${mockLeads.length} 个意向用户`,
      leads: mockLeads,
      totalCount: mockLeads.length
    }
  }

  async getAccountStatus(platform: string, account: AccountInfo): Promise<StatusResult> {
    const targetDevice = this.deviceName || account.deviceName || 'default_device'
    console.log(`[Real Device] ${targetDevice} 获取账号状态`)
    
    return {
      success: true,
      message: `${targetDevice} 状态获取成功`,
      isLoggedIn: true,
      followers: Math.floor(Math.random() * 100000),
      following: Math.floor(Math.random() * 10000),
      postCount: Math.floor(Math.random() * 1000),
      status: 'online'
    }
  }
}