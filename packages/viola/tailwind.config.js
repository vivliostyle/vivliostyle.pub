import config from '#ui/tailwind.config.js';

/** @type {import('tailwindcss').Config} */
export default {
  ...config,
  content: [...config.content, './src/**/*.{ts,tsx,js,jsx}'],
};
