export interface AutomationEngine {
  login(platform: string, account: AccountInfo): Promise<LoginResult>
  publishVideo(platform: string, account: AccountInfo, videoPath: string, caption: string): Promise<PublishResult>
  sendPrivateMessage(platform: string, account: AccountInfo, targetUser: string, message: string): Promise<MessageResult>
  collectLeads(platform: string, account: AccountInfo, keywords: string[]): Promise<LeadResult>
  getAccountStatus(platform: string, account: AccountInfo): Promise<StatusResult>
}

export interface AccountInfo {
  id: string
  platform: string
  accountId: string
  accountName: string
  bindType: 'official' | 'manual' | 'device'
  cookies?: string
  token?: string
  profilePath?: string
  deviceName?: string
}

export interface LoginResult {
  success: boolean
  message: string
  sessionId?: string
  expiresAt?: Date
}

export interface PublishResult {
  success: boolean
  message: string
  postId?: string
  url?: string
}

export interface MessageResult {
  success: boolean
  message: string
  messageId?: string
}

export interface LeadResult {
  success: boolean
  message: string
  leads?: LeadInfo[]
  totalCount?: number
}

export interface LeadInfo {
  userId: string
  nickname: string
  avatar?: string
  followers?: number
  bio?: string
  contact?: string
}

export interface StatusResult {
  success: boolean
  message: string
  isLoggedIn: boolean
  followers?: number
  following?: number
  postCount?: number
  status: 'online' | 'offline' | 'busy'
}