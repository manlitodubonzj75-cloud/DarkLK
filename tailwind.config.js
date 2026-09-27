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
        primary: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary-rgb) / <alpha-value>)',
        accent: 'rgb(var(--color-accent-rgb) / <alpha-value>)',
        dark: 'rgb(var(--color-dark-rgb) / <alpha-value>)',
        bg: 'rgb(var(--color-bg-rgb) / <alpha-value>)',
        card: 'rgb(var(--color-card-rgb) / <alpha-value>)',
        border: 'rgb(var(--color-border-rgb) / <alpha-value>)',
        textMuted: 'rgb(var(--color-text-muted-rgb) / <alpha-value>)',

        // Фирменная тёмная палитра MSAL+
        charcoal: '#12151B',
        slatePanel: '#1F2430',
        accentCyan: '#22869A',
        accentCyanDark: '#1E6685',
        softGrey: '#8E98A8',
        clearWhite: '#FFFFFF',
        amberTag: '#E5983A',
        amberTagBg: '#34251B',
        amberTagBorder: '#4A3323',
      },
    },
  },
  plugins: [],
}
