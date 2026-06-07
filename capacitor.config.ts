const config = {
  appId: 'com.aimarketing.agent',
  appName: 'AiMarketing Agent',
  webDir: 'out',
  server: {
    url: 'https://120.55.43.195:3000/agent',
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
