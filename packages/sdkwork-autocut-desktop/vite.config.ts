import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

function createAutoCutManualChunk(id: string): string | undefined {
  if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react-router-dom/')) {
    return 'autocut-react';
  }

  if (id.includes('/node_modules/pixi.js/') || id.includes('/node_modules/@pixi/')) {
    return 'autocut-pixi';
  }

  if (id.includes('/node_modules/ai/') || id.includes('/node_modules/@ai-sdk/')) {
    return 'autocut-ai';
  }

  if (id.includes('/node_modules/@tauri-apps/api/')) {
    return 'autocut-tauri';
  }

  if (id.includes('/node_modules/lucide-react/')) {
    return 'autocut-icons';
  }

  const packageMatch = id.match(/[\\/]packages[\\/]sdkwork-autocut-([^\\/]+)[\\/]src[\\/]index\.ts$/u);
  if (packageMatch) {
    return `autocut-feature-${packageMatch[1]}`;
  }

  return undefined;
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        {
          find: 'react/jsx-runtime',
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        },
        {
          find: 'react/jsx-dev-runtime',
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: 'react',
          replacement: path.resolve(__dirname, 'node_modules/react/index.js'),
        },
        {
          find: /^@sdkwork\/autocut-([^/]+)$/,
          replacement: path.resolve(__dirname, '../sdkwork-autocut-$1/src/index.ts'),
        },
      ],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks: createAutoCutManualChunk,
        },
      },
    },
  };
});
