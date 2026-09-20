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
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        accent: 'var(--color-accent)',
        dark: 'var(--color-dark)',
        bg: 'var(--color-bg)',
        card: 'var(--color-card)',
        border: 'var(--color-border)',
        textMuted: 'var(--color-text-muted)',

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
