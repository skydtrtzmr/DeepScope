import { defineConfig, mergeConfig } from 'vite';
import original from './vite.config';
export default mergeConfig(original, defineConfig({
  base: '/deepscope/',
  build: { outDir: 'dist-workbench', rollupOptions: { input: ['workbench.html', 'graph-preview.html'] } },
}));
