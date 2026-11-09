import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor 8 的配置入口。
// webDir 必须与 vite 的构建输出目录一致：vite.config.ts 没有改 outDir，默认输出 dist。
//
// server.androidScheme 显式写成 http（Capacitor 8 的默认值是 https）：
// 用默认 https 时 WebView 的 origin 是 https://localhost，页面再去 fetch
// http://10.0.2.2:8000 就变成「HTTPS 页面请求 HTTP 资源」，WebView 会按
// 混合内容（mixed content）直接拦掉，控制台留一条含糊的 net::ERR_FAILED。
// 改成 http 后页面 origin 是 http://localhost，与本地后端的协议一致，
// 只剩 Android 9+ 的明文流量限制要处理，见
// android/app/src/debug/res/xml/network_security_config.xml。
// 注意 http://localhost 仍然属于 secure context，localStorage / IndexedDB /
// crypto.subtle 都可用，不影响现有登录态存储。
const config: CapacitorConfig = {
  appId: 'com.liushuchang.activityassistant',
  appName: '久坐活动助手',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
  },
}

export default config
