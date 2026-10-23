import type { Config } from 'tailwindcss'

// Colour tokens, spacing, radius and type scale come from design-system-and-checklist.txt (Part 1),
// identical to the Tailwind config in all 18 mockups.
const type = (size: string, lineHeight: string, fontWeight: string, letterSpacing?: string): [string, Record<string, string>] =>
  [size, letterSpacing ? { lineHeight, fontWeight, letterSpacing } : { lineHeight, fontWeight }]

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'surface-variant': '#dce2f3', 'on-secondary': '#ffffff', 'on-secondary-fixed': '#151c23',
        'surface-container-high': '#e1e5eb', 'on-primary-fixed': '#00174b', error: '#b3261e',
        'inverse-primary': '#b4c5ff', 'on-error-container': '#8f1b13', 'tertiary-fixed-dim': '#62df7d',
        'surface-container-lowest': '#ffffff', 'on-secondary-fixed-variant': '#434b57',
        'surface-container-highest': '#d9dee6', 'secondary-fixed': '#e9ecf1', 'on-primary-container': '#eeefff',
        'on-secondary-container': '#5e656d', 'on-tertiary-container': '#c7ffca', 'secondary-fixed-dim': '#c0c7d0',
        'on-tertiary-fixed': '#002109', 'surface-container-low': '#f1f3f6', 'outline-variant': '#d3d8e0',
        'on-background': '#10161f', outline: '#6b7280', 'on-surface': '#10161f', 'tertiary-fixed': '#e1f0e6',
        background: '#f5f6f8', 'error-container': '#fbe7e4', primary: '#0f3b8f', 'tertiary-container': '#007f36',
        'on-primary-fixed-variant': '#0a2c70', 'on-tertiary': '#ffffff', 'inverse-surface': '#2a313d',
        'primary-container': '#1a4fc4', secondary: '#585f67', 'primary-fixed': '#e3ebfb', 'surface-tint': '#0053db',
        'surface-container': '#e8ebf0', tertiary: '#1b6a38', 'inverse-on-surface': '#ebf1ff',
        'on-surface-variant': '#454d5a', 'primary-fixed-dim': '#b4c5ff', 'surface-bright': '#f5f6f8',
        surface: '#f5f6f8', 'surface-dim': '#d3daea', 'on-tertiary-fixed-variant': '#175530', 'on-error': '#ffffff',
        'secondary-container': '#e9ecf1', 'on-primary': '#ffffff',
        // amber status colours (warnings: low stock, expiring, held, part paid)
        warn: '#8a5300', 'warn-container': '#fbefd5', 'warn-border': '#ecd9a8',
      },
      borderRadius: { DEFAULT: '0.1875rem', md: '0.25rem', lg: '0.375rem', xl: '0.5rem', full: '9999px' },
      spacing: {
        'space-xl': '2rem', 'space-sm': '0.5rem', 'space-lg': '1.5rem', gutter: '1rem', 'margin-mobile': '1rem',
        'gutter-compact': '0.5rem', 'space-md': '1rem', 'space-xs': '0.25rem', margin: '1.5rem',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'body-md-medium': type('14px', '20px', '500'),
        'label-md': type('14px', '20px', '500'),
        'headline-sm': type('14px', '20px', '600'),
        'body-md': type('14px', '20px', '400'),
        'headline-lg': type('24px', '32px', '700', '-0.02em'),
        'label-sm': type('12px', '16px', '500', '0.01em'),
        'body-lg': type('16px', '24px', '400'),
        'headline-md': type('15px', '22px', '600', '-0.005em'),
        'body-sm': type('13px', '18px', '400'),
        'label-xs': type('11px', '14px', '600', '0.03em'),
      },
    },
  },
  plugins: [],
}
export default config
