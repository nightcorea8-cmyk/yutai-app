/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2d5f3f',
          light: '#e8f0eb',
          dark: '#24502f',
        },
        accent: {
          DEFAULT: '#c47c2b',
          light: '#faf0e2',
        },
        bg: '#f5f0eb',
        surface: '#ffffff',
        surface2: '#f0efe9',
        danger: {
          DEFAULT: '#b83232',
          light: '#fbeaea',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
