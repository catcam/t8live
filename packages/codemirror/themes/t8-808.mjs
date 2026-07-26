import { tags as t } from '@lezer/highlight';
import { createTheme } from './theme-helper.mjs';

// Colors lifted from the Roland TR-808: matte black chassis, cream number-pad
// buttons, rust-orange sliders/knobs, and the red step-trigger LEDs.
export const settings = {
  background: '#161412',
  lineBackground: '#16141299',
  foreground: '#f2e8d5',
  muted: '#8c7d6b66',
  caret: '#ff3b30',
  selection: 'rgba(217, 83, 30, 0.35)',
  selectionMatch: '#d9531e40',
  lineHighlight: '#00000060',
  gutterBackground: 'transparent',
  gutterForeground: '#8c7d6b99',
};

export default createTheme({
  theme: 'dark',
  settings,
  styles: [
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#ff3b30' },
    { tag: t.labelName, color: '#ff3b30' },
    { tag: t.keyword, color: '#e0662d' },
    { tag: t.operator, color: '#f2e8d5' },
    { tag: t.special(t.variableName), color: '#f2e8d5' },
    { tag: t.typeName, color: '#d9a441' },
    { tag: t.atom, color: '#e0662d' },
    { tag: t.number, color: '#ff3b30' },
    { tag: t.definition(t.variableName), color: '#e88a4c' },
    { tag: t.string, color: '#d9a441' },
    { tag: t.special(t.string), color: '#d9a441' },
    { tag: t.comment, color: '#8c7d6b' },
    { tag: t.variableName, color: '#e0662d' },
    { tag: t.tagName, color: '#d9a441' },
    { tag: t.bracket, color: '#8c7d6b' },
    { tag: t.meta, color: '#ff3b30' },
    { tag: t.attributeName, color: '#e0662d' },
    { tag: t.propertyName, color: '#e0662d' },
    { tag: t.className, color: '#d9a441' },
    { tag: t.invalid, color: '#f2e8d5' },
    { tag: [t.unit, t.punctuation], color: '#e88a4c' },
  ],
});
