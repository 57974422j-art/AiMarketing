export interface AutomationConfig {
  engine: 'official-api' | 'fingerprint' | 'real-device' | 'mock'
  fingerprintBrowser: 'adspower' | 'bitbrowser'
  fingerprintProfilePath: string
  deviceName: string
}

export function getAutomationConfig(): AutomationConfig {
  return {
    engine: (process.env.AUTOMATION_ENGINE as AutomationConfig['engine']) || 'mock',
    fingerprintBrowser: (process.env.FINGERPRINT_BROWSER as AutomationConfig['fingerprintBrowser']) || 'adspower',
    fingerprintProfilePath: process.env.FINGERPRINT_PROFILE_PATH || '',
    deviceName: process.env.DEVICE_NAME || ''
  }
}