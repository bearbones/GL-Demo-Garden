import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  base: '/gl-demo-garden/',
  plugins: [glsl()],
});
