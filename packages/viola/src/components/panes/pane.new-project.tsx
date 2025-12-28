import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@v/ui/command';
import {
  StackedRadioGroup,
  StackedRadioGroupItem,
} from '@v/ui/custom/stacked-radio';
import { ChevronDownIcon } from '@v/ui/icon';
import { Input } from '@v/ui/input';
import { cn } from '@v/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@v/ui/popover';
import { createPane, PaneContainer, ScrollOverflow } from './util';

const languages = {
  aa: 'Afar',
  ab: 'Abkhazian',
  af: 'Afrikaans',
  ak: 'Akan',
  am: 'Amharic',
  an: 'Aragonese',
  ar: 'Arabic',
  'ar-001': 'Modern Standard Arabic',
  as: 'Assamese',
  az: 'Azerbaijani',
  ba: 'Bashkir',
  be: 'Belarusian',
  bg: 'Bulgarian',
  bm: 'Bambara',
  bn: 'Bangla',
  bo: 'Tibetan',
  br: 'Breton',
  bs: 'Bosnian',
  ca: 'Catalan',
  ce: 'Chechen',
  co: 'Corsican',
  cs: 'Czech',
  cu: 'Church Slavic',
  cv: 'Chuvash',
  cy: 'Welsh',
  da: 'Danish',
  de: 'German',
  'de-AT': 'Austrian German',
  'de-CH': 'Swiss High German',
  dv: 'Divehi',
  dz: 'Dzongkha',
  ee: 'Ewe',
  el: 'Greek',
  en: 'English',
  'en-AU': 'Australian English',
  'en-CA': 'Canadian English',
  'en-GB': 'British English',
  'en-US': 'American English',
  eo: 'Esperanto',
  es: 'Spanish',
  'es-419': 'Latin American Spanish',
  'es-ES': 'European Spanish',
  'es-MX': 'Mexican Spanish',
  et: 'Estonian',
  eu: 'Basque',
  fa: 'Persian',
  'fa-AF': 'Dari',
  ff: 'Fula',
  fi: 'Finnish',
  fo: 'Faroese',
  fr: 'French',
  'fr-CA': 'Canadian French',
  'fr-CH': 'Swiss French',
  fy: 'Western Frisian',
  ga: 'Irish',
  gd: 'Scottish Gaelic',
  gl: 'Galician',
  gn: 'Guarani',
  gu: 'Gujarati',
  gv: 'Manx',
  ha: 'Hausa',
  he: 'Hebrew',
  hi: 'Hindi',
  'hi-Latn': 'Hindi (Latin)',
  hr: 'Croatian',
  ht: 'Haitian Creole',
  hu: 'Hungarian',
  hy: 'Armenian',
  ia: 'Interlingua',
  id: 'Indonesian',
  ie: 'Interlingue',
  ig: 'Igbo',
  ii: 'Sichuan Yi',
  io: 'Ido',
  is: 'Icelandic',
  it: 'Italian',
  iu: 'Inuktitut',
  ja: 'Japanese',
  jv: 'Javanese',
  ka: 'Georgian',
  ki: 'Kikuyu',
  kk: 'Kazakh',
  kl: 'Kalaallisut',
  km: 'Khmer',
  kn: 'Kannada',
  ko: 'Korean',
  ks: 'Kashmiri',
  ku: 'Kurdish',
  kw: 'Cornish',
  ky: 'Kyrgyz',
  la: 'Latin',
  lb: 'Luxembourgish',
  lg: 'Ganda',
  ln: 'Lingala',
  lo: 'Lao',
  lt: 'Lithuanian',
  lu: 'Luba-Katanga',
  lv: 'Latvian',
  mg: 'Malagasy',
  mi: 'Māori',
  mk: 'Macedonian',
  ml: 'Malayalam',
  mn: 'Mongolian',
  mr: 'Marathi',
  ms: 'Malay',
  mt: 'Maltese',
  my: 'Burmese',
  nb: 'Norwegian Bokmål',
  nd: 'North Ndebele',
  ne: 'Nepali',
  nl: 'Dutch',
  'nl-BE': 'Flemish',
  nn: 'Norwegian Nynorsk',
  no: 'Norwegian',
  nr: 'South Ndebele',
  nv: 'Navajo',
  ny: 'Nyanja',
  oc: 'Occitan',
  om: 'Oromo',
  or: 'Odia',
  os: 'Ossetic',
  pa: 'Punjabi',
  pl: 'Polish',
  ps: 'Pashto',
  pt: 'Portuguese',
  'pt-BR': 'Brazilian Portuguese',
  'pt-PT': 'European Portuguese',
  qu: 'Quechua',
  rm: 'Romansh',
  rn: 'Rundi',
  ro: 'Romanian',
  'ro-MD': 'Moldavian',
  ru: 'Russian',
  rw: 'Kinyarwanda',
  sa: 'Sanskrit',
  sc: 'Sardinian',
  sd: 'Sindhi',
  se: 'Northern Sami',
  sg: 'Sango',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  sn: 'Shona',
  so: 'Somali',
  sq: 'Albanian',
  sr: 'Serbian',
  ss: 'Swati',
  st: 'Southern Sotho',
  su: 'Sundanese',
  sv: 'Swedish',
  sw: 'Swahili',
  'sw-CD': 'Congo Swahili',
  ta: 'Tamil',
  te: 'Telugu',
  tg: 'Tajik',
  th: 'Thai',
  ti: 'Tigrinya',
  tk: 'Turkmen',
  tn: 'Tswana',
  to: 'Tongan',
  tr: 'Turkish',
  ts: 'Tsonga',
  tt: 'Tatar',
  ug: 'Uyghur',
  uk: 'Ukrainian',
  ur: 'Urdu',
  uz: 'Uzbek',
  ve: 'Venda',
  vi: 'Vietnamese',
  vo: 'Volapük',
  wa: 'Walloon',
  wo: 'Wolof',
  xh: 'Xhosa',
  yi: 'Yiddish',
  yo: 'Yoruba',
  za: 'Zhuang',
  zh: 'Chinese',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  zu: 'Zulu',
};

type NewProjectPaneProps = object;

declare global {
  interface PanePropertyMap {
    'new-project': NewProjectPaneProps;
  }
}

export const Pane = createPane<NewProjectPaneProps>({
  title: () => 'Create New Project',
  content: (props) => (
    <ScrollOverflow>
      <PaneContainer>
        <Content {...props} />
      </PaneContainer>
    </ScrollOverflow>
  ),
});

function Content(_: NewProjectPaneProps) {
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        All fields are optional and can be changed later in project settings.
      </p>

      <form className="contents">
        <label className="grid gap-2">
          <span className="text-l font-bold">Book title</span>
          <div>
            <Input type="text" name="bookTitle" />
          </div>
        </label>

        <label className="grid gap-2">
          <span className="text-l font-bold">Author</span>
          <Input type="text" name="author" />
        </label>

        <div className="grid gap-2">
          <span className="text-l font-bold">Language</span>

          <Popover>
            {/** biome-ignore lint/a11y/useSemanticElements: Combobox with search */}
            <PopoverTrigger
              role="combobox"
              className={cn(
                "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                'w-[280px]',
              )}
            >
              Choose language
              <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0">
              <Command>
                <CommandInput placeholder="Search language..." />
                <CommandList>
                  <CommandEmpty>No language found.</CommandEmpty>
                  <CommandGroup>
                    {Object.entries(languages).map(([code, name]) => (
                      <CommandItem key={code}>
                        {name}
                        <span className="text-muted-foreground">({code})</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid gap-2">
          <h3 className="text-l font-bold">Template</h3>
          <StackedRadioGroup className="grid-cols-2">
            <StackedRadioGroupItem value="blank">
              Blank Book Template
              <p className="text-xs text-muted-foreground">
                A minimal template to start from scratch.
              </p>
            </StackedRadioGroupItem>
            <StackedRadioGroupItem value="basic">
              Basic Book Template
              <p className="text-xs text-muted-foreground">
                A simple template with common sections for a book.
              </p>
            </StackedRadioGroupItem>
          </StackedRadioGroup>
        </div>

        <div className="grid gap-2">
          <h3 className="text-l font-bold">Theme</h3>
          <StackedRadioGroup className="grid-cols-2">
            <StackedRadioGroupItem value="@vivliostyle/theme-base">
              Base Theme
            </StackedRadioGroupItem>
            <StackedRadioGroupItem value="@vivliostyle/theme-techbook">
              Techbook
            </StackedRadioGroupItem>
            <StackedRadioGroupItem value="@vivliostyle/theme-academic">
              Academic
            </StackedRadioGroupItem>
            <StackedRadioGroupItem value="@vivliostyle/theme-bunko">
              Bunko
            </StackedRadioGroupItem>
            <StackedRadioGroupItem value="@vivliostyle/theme-gutenberg">
              Gutenberg
            </StackedRadioGroupItem>
            <StackedRadioGroupItem value="@vivliostyle/theme-slide">
              Slide
            </StackedRadioGroupItem>
          </StackedRadioGroup>
        </div>
      </form>
    </div>
  );
}
