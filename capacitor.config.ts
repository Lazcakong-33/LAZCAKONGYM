import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lazcakong.gym',
  appName: 'LAZCAKONG GYM',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    allowNavigation: [
      'lazcakongym.ai.studio',
      'lazcakongym-13537846485.us-east1.run.app',
      'forward-cortex-1ds98.firebaseapp.com',
      'forward-cortex-1ds98.web.app',
      '*.googleapis.com',
      'accounts.google.com',
    ],
  },
  android: {
    backgroundColor: '#090909',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: '#090909',
    contentInset: 'automatic',
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: '#090909',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#090909',
      overlaysWebView: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_lazcakong',
      iconColor: '#CCFF00',
    },
    CapacitorUpdater: {
      autoUpdate: false,
      directUpdate: false,
      resetWhenUpdate: true,
      appReadyTimeout: 10000,
      allowManualBundleError: true,
      statsUrl: '',
    },
  },
};

export default config;
