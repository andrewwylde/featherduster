/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        vermilion: {
          50: '#fff1ef',
          100: '#ffe1dc',
          200: '#ffc7be',
          300: '#ffa193',
          400: '#f87171',
          500: '#d93829', // Core editorial vermilion accent
          600: '#c23022',
          700: '#a32418',
          800: '#841f16',
          900: '#691c14',
          950: '#45120c',
        },
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        desk: {
          bg: {
            light: '#fbfbfb',
            dark: '#0c0f17',
          },
          panel: {
            light: '#ffffff',
            dark: '#121622',
          },
          card: {
            light: '#ffffff',
            dark: '#161c2b',
          },
          border: {
            light: '#e2e8f0',
            dark: '#1e293b',
          },
        },
      },
      borderRadius: {
        desk: '10px',
      },
    },
  },
  plugins: [],
};
