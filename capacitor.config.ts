import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.aimarketing.agent',
  appName: 'AiMarketing Agent',
  webDir: 'out',
  server: {
    // 生产环境：直接加载远程URL，无需本地构建
    url: 'https://120.55.43.195:3000/agent',
    // 开发时可切换为本地
    // url: 'http://localhost:3000/agent',
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#0a0a0f',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0f'
    }
  }
}

export default config
