// /var/www/acousticmaster-dev/frontend/vite.config.ts
import { defineConfig, loadEnv } from 'vite';

// 核心：加载对应环境的.env文件
export default defineConfig(({ mode }) => {
  // 加载环境变量（第二个参数填.env文件所在目录，这里是项目根目录）
  const env = loadEnv(mode, process.cwd());
  const devPort = Number(env.VITE_DEV_PORT) || 8101;
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://115.231.236.153:3002';
  const aiChatTarget = env.VITE_DEV_AI_CHAT_TARGET || 'http://115.231.236.153:3003';
  const aiSystemTarget = env.VITE_DEV_AI_SYSTEM_TARGET || 'http://115.231.236.153:4000';
  
  return {
    server: {
      // 读取环境变量中的端口，默认3000（防止环境变量未配置）
      port: devPort,
      host: '0.0.0.0', // 允许外部访问
      strictPort: true, // 端口被占用时直接报错，不自动换端口（便于排查）
      proxy: {
        '/api/system': {
          target: aiSystemTarget,
          changeOrigin: true,
        },
        '/api/chat-assistant': {
          target: aiChatTarget,
          changeOrigin: true,
        },
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});