import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: { 900: '#0a3d2a', 800: '#0d4a33', 700: '#0f5c3e' },
        gold: { 400: '#d4af37', 500: '#b78d28' },
        chip: { red: '#dc2626', green: '#16a34a', blue: '#2563eb', black: '#0f172a' },
      },
      fontFamily: { sans: ['Inter', 'sans-serif'], display: ['Cinzel', 'serif'], mono: ['JetBrains Mono', 'monospace'] },
      keyframes: {
        deal: { '0%': { transform: 'translateY(-50px) rotate(15deg)', opacity: '0' }, '100%': { transform: 'translateY(0) rotate(0)', opacity: '1' } },
        chipPush: { '0%': { transform: 'scale(0.5)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(212,175,55,.7)' }, '100%': { boxShadow: '0 0 0 12px rgba(212,175,55,0)' } },
      },
      animation: {
        deal: 'deal 320ms ease-out',
        chipPush: 'chipPush 220ms ease-out',
        pulseRing: 'pulseRing 1.6s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
