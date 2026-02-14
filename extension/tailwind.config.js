/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        doom: {
          bg: '#0a0a0a',
          surface: '#141414',
          border: '#1f1f1f',
          muted: '#6b7280',
        },
        neon: {
          green: '#39ff14',
          pink: '#ff2d78',
          cyan: '#00f0ff',
          purple: '#bf5af2',
          yellow: '#ffe600',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'neon-green': '0 0 10px rgba(57, 255, 20, 0.3), 0 0 40px rgba(57, 255, 20, 0.1)',
        'neon-pink': '0 0 10px rgba(255, 45, 120, 0.3), 0 0 40px rgba(255, 45, 120, 0.1)',
        'neon-cyan': '0 0 10px rgba(0, 240, 255, 0.3), 0 0 40px rgba(0, 240, 255, 0.1)',
      },
      animation: {
        'pulse-neon': 'pulse-neon 2s ease-in-out infinite',
        'float-up': 'float-up 3s ease-out forwards',
      },
      keyframes: {
        'pulse-neon': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'float-up': {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(-100px)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
