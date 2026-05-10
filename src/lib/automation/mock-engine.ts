import { AutomationEngine, AccountInfo, LoginResult, PublishResult, MessageResult, LeadResult, StatusResult, LeadInfo } from './engine'

export class MockEngine implements AutomationEngine {
  async login(platform: string, account: AccountInfo): Promise<LoginResult> {
    console.log(`[Mock] 模拟登录 ${platform} 账号: ${account.accountName}`)
    return {
      success: true, message: `${platform} 模拟登录成功`,
      sessionId: `mock_session_${platform}_${Date.now()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }
  }

  async publishVideo(platform: string, account: AccountInfo, videoPath: string, caption: string): Promise<PublishResult> {
    console.log(`[Mock] 模拟发布视频到 ${platform}: ${videoPath}`)
    const mockPostId = `mock_post_${platform}_${Date.now()}`
    return { success: true, message: '视频模拟发布成功', postId: mockPostId, url: `https://${platform}.com/video/${mockPostId}` }
  }

  async sendPrivateMessage(platform: string, account: AccountInfo, targetUser: string, message: string): Promise<MessageResult> {
    console.log(`[Mock] 模拟发送私信给 ${targetUser}`)
    return { success: true, message: '私信模拟发送成功', messageId: `mock_msg_${Date.now()}` }
  }

  async collectLeads(platform: string, account: AccountInfo, keywords: string[]): Promise<LeadResult> {
    console.log(`[Mock] 模拟采集意向用户，关键词: ${keywords.join(', ')}`)
    const mockLeads: LeadInfo[] = Array.from({ length: 3 }, (_, i) => ({
      userId: `mock_user_${i}`, nickname: `模拟用户${i + 1}`,
      avatar: '', followers: Math.floor(Math.random() * 500),
      bio: '模拟用户', contact: '',
    }))
    return { success: true, message: `模拟采集到 ${mockLeads.length} 个用户`, leads: mockLeads, totalCount: mockLeads.length }
  }

  async getAccountStatus(platform: string, account: AccountInfo): Promise<StatusResult> {
    return { success: true, message: '模拟状态正常', isLoggedIn: true, followers: 1000, following: 100, postCount: 50, status: 'online' }
  }
}
