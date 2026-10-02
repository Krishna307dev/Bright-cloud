/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
        },
        // Modrinth-style OLED dark palette semantic aliases
        oled: {
          base: '#000000',
          deep: '#0A0A0A',
          surface: '#111111',
          elevated: '#181818',
          border: '#242424',
          text: '#E6E6E6',
          muted: '#8A8A8A',
          accent: '#1DB954',
          'accent-hover': '#1AA34A',
          'accent-active': '#15803D',
        },
        // Modrinth utilitarian dark accent
        accent: {
          DEFAULT: '#1DB954',
          hover: '#1AA34A',
          muted: '#15803D',
          bg: '#1DB9541F',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'micro': '0 1px 3px 0 rgba(0, 0, 0, 0.4)',
        'modal': '0 12px 30px -6px rgba(0, 0, 0, 0.8), 0 0 0 1px #242424',
      },
    },
  },
  plugins: [],
};
