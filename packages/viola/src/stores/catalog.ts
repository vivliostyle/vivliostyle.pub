import { appOrigin } from '../libs/origins';

export const officialTemplates = {
  blank: {
    title: 'Blank Book Template',
    description: 'A minimal template to start from scratch.',
    source: `${appOrigin()}/_templates/minimal.tar.gz`,
  },
  basic: {
    title: 'Basic Book Template',
    description: 'A simple template with common sections for a book.',
    source: `${appOrigin()}/_templates/basic.tar.gz`,
  },
} as const;

export type OfficialTemplateId = keyof typeof officialTemplates;

export const officialThemes = {
  '@vivliostyle/theme-base': { title: 'Base Theme' },
  '@vivliostyle/theme-techbook': { title: 'Techbook' },
  '@vivliostyle/theme-academic': { title: 'Academic' },
  '@vivliostyle/theme-bunko': { title: 'Bunko' },
  '@vivliostyle/theme-gutenberg': { title: 'Gutenberg' },
  '@vivliostyle/theme-slide': { title: 'Slide' },
} as const;

export type OfficialThemePackageName = keyof typeof officialThemes;
