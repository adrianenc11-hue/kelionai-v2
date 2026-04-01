import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.kelionai.v2',
  appName: 'KelionAI',
  webDir: 'dist/client',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    hostname: 'kelionai.app',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0f172a',
      showSpinner: true,
      spinnerColor: '#3b82f6',
    },
    Keyboard: {
      resize: 'body' as any,
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'dark' as any,
      backgroundColor: '#0f172a',
    },
    Camera: {
      permissions: ['camera', 'microphone'],
    },
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'KelionAI',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
