import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        cairo: ['var(--font-baloo)', 'Playpen Sans Arabic', 'Cairo', 'Tajawal', 'sans-serif'],
        tajawal: ['var(--font-baloo)', 'Playpen Sans Arabic', 'Tajawal', 'Cairo', 'sans-serif'],
        jakarta: ['var(--font-baloo)', 'Playpen Sans Arabic', 'Cairo', 'Tajawal', 'sans-serif'],
        baloo: ['var(--font-baloo)', 'Cairo', 'Tajawal', 'sans-serif'],
        playpen: ['Playpen Sans Arabic', 'var(--font-baloo)', 'Cairo', 'Tajawal', 'sans-serif'],
      },
      boxShadow: {
        'neo-raised': '6px 6px 12px rgba(0,0,0,0.08), -6px -6px 12px rgba(255,255,255,0.6)',
        'neo-inset': 'inset 4px 4px 8px rgba(0,0,0,0.06), inset -4px -4px 8px rgba(255,255,255,0.5)',
      }
    },
  },
  plugins: [],
};
export default config;
