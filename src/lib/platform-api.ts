import { AutomationEngine, AccountInfo, LoginResult, PublishResult, MessageResult, LeadResult, StatusResult } from './automation/engine'
import { OfficialApiEngine } from './automation/official-api'
import { FingerprintBrowserEngine } from './automation/fingerprint-browser'
import { RealDeviceEngine } from './automation/real-device'
import { getAutomationConfig } from './automation/config'

let engineInstance: AutomationEngine | null = null

function getEngine(): AutomationEngine {
  if (engineInstance) {
    return engineInstance
  }

  const config = getAutomationConfig()

  switch (config.engine) {
    case 'official-api':
      engineInstance = new OfficialApiEngine()
      break
    case 'fingerprint':
      engineInstance = new FingerprintBrowserEngine(
        config.fingerprintBrowser,
        config.fingerprintProfilePath
      )
      break
    case 'real-device':
      engineInstance = new RealDeviceEngine(config.deviceName)
      break
    case 'mock':
    default:
      engineInstance = new OfficialApiEngine()
      break
  }

  return engineInstance
}

export async function login(platform: string, account: AccountInfo): Promise<LoginResult> {
  const engine = getEngine()
  return engine.login(platform, account)
}

export async function publishVideo(platform: string, account: AccountInfo, videoPath: string, caption: string): Promise<PublishResult> {
  const engine = getEngine()
  return engine.publishVideo(platform, account, videoPath, caption)
}

export async function sendPrivateMessage(platform: string, account: AccountInfo, targetUser: string, message: string): Promise<MessageResult> {
  const engine = getEngine()
  return engine.sendPrivateMessage(platform, account, targetUser, message)
}

export async function collectLeads(platform: string, account: AccountInfo, keywords: string[]): Promise<LeadResult> {
  const engine = getEngine()
  return engine.collectLeads(platform, account, keywords)
}

export async function getAccountStatus(platform: string, account: AccountInfo): Promise<StatusResult> {
  const engine = getEngine()
  return engine.getAccountStatus(platform, account)
}

export type { AccountInfo, LoginResult, PublishResult, MessageResult, LeadResult, StatusResult }

export function getCurrentEngineType(): string {
  const config = getAutomationConfig()
  return config.engine
}