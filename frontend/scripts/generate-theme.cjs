const fs = require('node:fs');
const { colors: c } = require('../src/theme/tokens.json');
const roles = {
  background: c.canvas, foreground: c.ink, surface: c.surface,
  'surface-foreground': c.ink, 'surface-secondary': c.canvas,
  overlay: c.surface, 'overlay-foreground': c.ink, muted: c.muted,
  accent: c.primary, 'accent-foreground': c.surface, default: c.canvas,
  'default-foreground': c.ink, border: c.border, separator: c.border,
  focus: c.primary, link: c.primary, danger: c.critical,
  'danger-foreground': c.surface, warning: c.caution, 'warning-foreground': c.surface,
  'field-background': c.surface, 'field-foreground': c.ink,
  'field-placeholder': c.muted, 'field-border': c.border,
};
const css = `@import 'tailwindcss';
@import 'uniwind';
@import 'heroui-native/styles';

@theme {
  --font-sans: 'System';
  --field-radius: 12px;
}

@layer theme {
  :root {
    @variant android {
      --font-sans: 'Inter';
    }
    @variant light {
${Object.entries(roles).map(([k, v]) => `      --${k}: ${v};`).join('\n')}
    }
  }
}
`;
fs.writeFileSync(require('node:path').join(__dirname, '../global.css'), css);
