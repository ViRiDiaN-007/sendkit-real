/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./src/**/*.js",
    "./views/**/*.ejs"
  ],
  theme: {
    extend: {
      colors: {
        'pump-purple': '#00ff88',
        'pump-pink': '#00cc6a',
        'pump-blue': '#3B82F6',
        'pump-green': '#10B981',
        'pump-orange': '#F59E0B',
        'pump-red': '#EF4444',
        'dark-bg': '#0F0F23',
        'dark-card': '#1A1A2E',
        'dark-border': '#2D2D44'
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace']
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
        'glow': 'glow 2s ease-in-out infinite alternate'
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #00ff88' },
          '100%': { boxShadow: '0 0 20px #00ff88, 0 0 30px #00ff88' }
        }
      },
      boxShadow: {
        'glow-green': '0 10px 15px -3px rgb(74 222 128 / 0.25), 0 4px 6px -4px rgb(74 222 128 / 0.25)'
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      extend: {
        colors: {
          'green-400/30': 'rgb(74 222 128 / 0.3)',
          'green-600/30': 'rgb(34 197 94 / 0.3)',
          'green-500/25': 'rgb(34 197 94 / 0.25)'
        }
      }
    }
  },
  plugins: []
}
