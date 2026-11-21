import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ base: '/hex-island-game/', build: { rollupOptions: { input: { index: resolve('index.html'), manual: resolve('manual.html'), diagnostics: resolve('diagnostics.html') } } } });
