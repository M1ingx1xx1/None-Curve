// Sample texts for the text input. Line breaks are explicit: the specimen does not wrap, so long
// samples are broken into lines here. The first sample is the text the app starts with.

export const SAMPLES: { label: string; text: string }[] = [
  {
    label: 'Lorem ipsum',
    text: [
      'Lorem ipsum dolor sit amet, consectetur',
      'adipiscing elit, sed do eiusmod tempor',
      'incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud',
      'exercitation ullamco laboris nisi ut aliquip',
      'ex ea commodo consequat.',
    ].join('\n'),
  },
  { label: 'Pangrams', text: 'The quick brown fox jumps over the lazy dog.\nCrazy Fredrick bought many very exquisite opal jewels.' },
  { label: 'Spacing', text: 'Hamburgefontsiv\nAVATAR Typography, Tolerance' },
  { label: 'Alphabet', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789\n.,:;!?()[]{}&@#$%*' },
]

export const DEFAULT_TEXT = SAMPLES[0].text
