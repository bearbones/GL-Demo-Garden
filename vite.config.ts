import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  base: '/GL-Demo-Garden/',
  plugins: [glsl()],
});
