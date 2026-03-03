// /var/www/acousticmaster-dev/frontend/vite.config.ts
import { defineConfig, loadEnv } from 'vite';

// 核心：加载对应环境的.env文件
export default defineConfig(({ mode }) => {
  // 加载环境变量（第二个参数填.env文件所在目录，这里是项目根目录）
  const env = loadEnv(mode, process.cwd());
  
  return {
    server: {
      // 读取环境变量中的端口，默认3000（防止环境变量未配置）
      port: Number(env.VITE_DEV_PORT) || 8101,
      host: '0.0.0.0', // 允许外部访问
      strictPort: true, // 端口被占用时直接报错，不自动换端口（便于排查）
    },
    // 可选：配置代理（开发时避免跨域，和VITE_API_BASE二选一）


  };
});