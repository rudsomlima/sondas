/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        accent: 'var(--accent)',
        'accent-dim': '#1d4ed8',
        text: 'var(--text)',
        dim: 'var(--text-dim)',
        faint: 'var(--text-faint)',
        muted: 'var(--muted)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        live: 'var(--status-live)',
        found: 'var(--status-found)',
        lost: 'var(--status-lost)',
        unknown: 'var(--status-unknown)',
        'src-wyoming': 'var(--src-wyoming)',
        'src-radiosondy': 'var(--src-radiosondy)',
        'src-sondehub': 'var(--src-sondehub)',
        day: 'var(--day)',
        night: 'var(--night)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
