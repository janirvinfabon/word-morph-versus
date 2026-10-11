import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  content: [
    './components/**/*.{vue,js,ts}',
    './composables/**/*.{js,ts}',
    './pages/**/*.{vue,js,ts}',
    './app.vue'
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Baloo 2"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },
      colors: {
        arcade: {
          bg: '#0f0a1e',
          panel: '#1b1335',
          p1: '#38bdf8',
          p2: '#fb7185',
          gold: '#fbbf24',
          good: '#4ade80',
          bad: '#f87171'
        }
      },
      boxShadow: {
        tile: '0 6px 0 0 rgba(0,0,0,0.35)',
        glow: '0 0 24px rgba(56,189,248,0.45)'
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '70%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        shake: {
          '10%, 90%': { transform: 'translateX(-2px)' },
          '20%, 80%': { transform: 'translateX(4px)' },
          '30%, 50%, 70%': { transform: 'translateX(-8px)' },
          '40%, 60%': { transform: 'translateX(8px)' }
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' }
        }
      },
      animation: {
        pop: 'pop 0.25s ease-out',
        shake: 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both',
        float: 'float 3s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
