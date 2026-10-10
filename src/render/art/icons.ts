// src/render/art/icons.ts — the 12×12 icons (ARCHITECTURE §12.3; DESIGN §16.3): 12 resources, 5 spirit faces, laurel,
// 4 seasons, 13 wants, the status marks (seal, plan ⌛, stake groma, CLAVSVM plank, unpaid coin, unstaffed pip,
// request, souls, beds), 6 tabs, 5 tools, 5 overlays and the star. Owner: WP-G (art, part 2).
// Icons carry their own `k` outline and read on the dark UI panels as well as over the map (want bubbles).
import { registerArt } from '../sprites';
import type { Grid } from '../sprites';
import { recolor } from './brush';
import {
  AMPHORA, BASKET, BATH, BED, BLOCKS, COIN, CONCRETE, CRATE, DROP, GRAPES, INGOTS, KIT, LAUREL, LOGS, OIL, ORE, SCROLL,
  SHEAF, SHRINE, SOULS, STREET, TEMPLE, THOLOS, TILES,
} from './glyphs';

/** The spirits face: a gold disc whose eyes and mouth rows change with the mood (0 gloomiest … 4 merriest). */
function face(mood: 0 | 1 | 2 | 3 | 4): Grid {
  const base = [
    '...kkkkkk...',
    '..kyyyyyyk..',
    '.kyyyyyyyYk.',
    'kyyyyyyyyyYk',
    'kyykyyyykyYk',
    'kyykyyyykyYk',
    'kyyyyyyyyyYk',
    'kyyyyyyyyyYk',
    'kyyyyyyyyYYk',
    '.kyyyyyyYYk.',
    '..kYYYYYYk..',
    '...kkkkkk...',
  ];
  const rows = base.map((r) => [...r]);
  const put = (x: number, y: number, k: string): void => { rows[y][x] = k; };
  if (mood === 0) {
    put(3, 3, 'k'); put(8, 3, 'k');                                   // knitted brows
    put(3, 6, 'c'); put(8, 6, 'c');                                   // tears
    for (const x of [4, 5, 6, 7]) put(x, 7, 'k');
    put(3, 8, 'k'); put(8, 8, 'k');
  } else if (mood === 1) {
    for (const x of [4, 5, 6, 7]) put(x, 7, 'k');
    put(3, 8, 'k'); put(8, 8, 'k');
  } else if (mood === 2) {
    for (const x of [3, 4, 5, 6, 7, 8]) put(x, 7, 'k');
  } else if (mood === 3) {
    put(3, 7, 'k'); put(8, 7, 'k');
    for (const x of [4, 5, 6, 7]) put(x, 8, 'k');
  } else {
    for (const x of [3, 4, 5, 6, 7, 8]) put(x, 6, 'k');
    put(3, 7, 'k'); put(4, 7, 'r'); put(5, 7, 'r'); put(6, 7, 'r'); put(7, 7, 'r'); put(8, 7, 'k');
    for (const x of [4, 5, 6, 7]) put(x, 8, 'k');
    put(2, 6, 'f'); put(9, 6, 'f');                                   // rosy cheeks
  }
  return rows.map((r) => r.join(''));
}

const SEASON_ICONS: Grid[] = [
  [ // Ver: a blossom
    '...kk.kk....',
    '..kwfkffk...',
    '..kffyffk...',
    '...kfffk.kk.',
    '..kffkffkLk.',
    '...kk.kk.Lk.',
    '.....kLkkLk.',
    '..kk.kLLLk..',
    '.kLlkkLk....',
    '..kLLLLk....',
    '...kkLk.....',
    '.....kk.....',
  ],
  [ // Aestas: the sun
    '.....kk.....',
    '.k...yy...k.',
    '..ky....yk..',
    '....kkkk....',
    '...kyyyyk...',
    'kyykyyyYYkyk',
    'kyykyyYYYkyk',
    '...kyYYYNk..',
    '....kkkk....',
    '..ky....yk..',
    '.k...yy...k.',
    '.....kk.....',
  ],
  [ // Autumnus: a vine leaf turning
    '.....kk.....',
    '..k.kYok.k..',
    '.kYkYooukuk.',
    '.kYoYoouuuk.',
    'kYYooYouuuuk',
    '.kYooYouuuk.',
    '..kYoYouuk..',
    '.kkYooouukk.',
    '..kkkbkkk...',
    '.....bk.....',
    '.....kb.....',
    '......k.....',
  ],
  [ // Hiems: frost
    '.....k......',
    '.k..kck..k..',
    '.kckkwkkck..',
    '..kcwwwck...',
    'kkkkwcwkkkk.',
    'kcwwcwcwwck.',
    'kkkkwcwkkkk.',
    '..kcwwwck...',
    '.kckkwkkck..',
    '.k..kck..k..',
    '.....k......',
    '............',
  ],
];

const STAR: Grid = [
  '.....kk.....',
  '....kyyk....',
  '....kyyk....',
  'kkkkkyyYkkkk',
  'kyyyyyyYYYYk',
  '.kyyyyYYYYk.',
  '..kyyyYYYk..',
  '..kyyYYYNk..',
  '.kyyYkkYNNk.',
  '.kyYk..kYNk.',
  '.kkk....kkk.',
  '............',
];

const MARKS: Record<string, Grid> = {
  i_seal: [
    '...kkkkkk...',
    '..kFrrrrFk..',
    '.kFrrFFrrRk.',
    'kFrFNNNNFrRk',
    'kFrNFFFFNrRk',
    'krFNFrrFNFRk',
    'krFNFrrFNFRk',
    'kFrNFFFFNRRk',
    'kFrFNNNNFRRk',
    '.kRrFFFFRRk.',
    '..kRRRRRRk..',
    '...kkkkkk...',
  ],
  i_plan: [
    '.kkkkkkkkkk.',
    '.kBnnnnnnBk.',
    '..kwwwwwWk..',
    '..kwyyyyWk..',
    '...kwyyWk...',
    '....kwWk....',
    '....kwWk....',
    '...kwwyWk...',
    '..kwwyyyWk..',
    '..kwyyyyyk..',
    '.kBnnnnnnBk.',
    '.kkkkkkkkkk.',
  ],
  i_stake: [
    '............',
    '.kkkkkkkkkk.',
    '.kBnBBnBBnk.',
    '.kkkkBkkkkk.',
    '.k...nk...k.',
    '.k...Bk...k.',
    '.N...nk...N.',
    '.....Bk.....',
    '.....nk.....',
    '.....Bk.....',
    '....kBbk....',
    '...kkkkkk...',
  ],
  i_closed: [
    '.....kk.....',
    '....kNNk....',
    '...k....k...',
    '..k......k..',
    'kkkkkkkkkkkk',
    'kTtTtTtTtTnk',
    'ktkkktkktknk',
    'kTkTkTktkTnk',
    'ktkkktkkktnk',
    'knnnnnnnnnBk',
    'kkkkkkkkkkkk',
    '............',
  ],
  i_unstaffed: [
    '............',
    '..kk....kk..',
    '.kggk..krrk.',
    '.kggk..krrk.',
    '.kkkk..krrk.',
    'kGGGGk.krrk.',
    'kGGGGk.krrk.',
    'kgGGgk..kk..',
    '.kGGk..kkkk.',
    '.kggk..krrk.',
    '.kkkk..kkkk.',
    '............',
  ],
  i_request: [
    '...kkkkkk...',
    '..kIIIIIIk..',
    '.kIIIIyIIIk.',
    'kIIIIkyIIIIk',
    'kIyyyyyyyyIk',
    'kIIyyyyyyIIk',
    'kIIIyyyyIIIk',
    'kIIIyIIyIIIk',
    'kIIyIIIIyIIk',
    '.kIIIIIIIIk.',
    '..kIIIIIIk..',
    '...kkkkkk...',
  ],
};

const TABS: Record<string, Grid> = {
  council: [
    '............',
    '.kkkkkkkkk..',
    '.kTtTtTtTnk.',
    '.ktkkkkktnk.',
    '.kTtTtTtTnk.',
    '.ktkkkkTtnk.',
    '.kTtTtTtTnk.',
    '.ktkkkkkknk.',
    '.kTtTtkkkkk.',
    '.kttttkrRk..',
    '.kkkkkkRrk..',
    '.......kk...',
  ],
  advisors: [
    '...kkkk.....',
    '..kLlLLk....',
    '.kLkhhhLk...',
    '.kAhhhhhk...',
    '.kAhhkhhk...',
    '..khhhhhHk..',
    '..khhhHHk...',
    '...kkhHk....',
    '..kFFFFFk...',
    '.kFwFFFFFk..',
    '.kFFFFFFFk..',
    '.kkkkkkkkk..',
  ],
  build: [
    '............',
    '..kkkkkkk...',
    '.kzzzzzWzk..',
    '.kGGGGGzGk..',
    '..kkkBkkk...',
    '....kBk.....',
    '....kBkkkkkk',
    '....kBkkuusk',
    '....kBkkvuuk',
    '....kbkkkkkk',
    '....kkkkuusk',
    '.......kkkkk',
  ],
  people: SOULS,
  trade: [
    '.....k......',
    '..kkkBkkk...',
    '..kwwBwWk...',
    '..kwrBrWk...',
    '..kwwBwWk...',
    '..kkkBkkk...',
    'k....B....k.',
    'kkkkkkkkkkk.',
    'kBnnnnnnnBk.',
    '.kBnBnBnBk..',
    '..kkkkkkk...',
    '.cCcCcCcCc..',
  ],
  annals: [
    '............',
    '.kkkk..kkkk.',
    'kweeekkeeewk',
    'kekkekkekkek',
    'keeeekkeeeek',
    'kekkekkekkek',
    'keeeekkeeeek',
    'kekkekkekkek',
    'keeeekkeeeek',
    'kkkkkkkkkkkk',
    '.kBBBkkBBBk.',
    '..kkk..kkk..',
  ],
};

const TOOLS: Record<string, Grid> = {
  pin: [
    '.kk.........',
    '.kBkkkkkk...',
    '.kBkrrrrrk..',
    '.kBkrRrrrrk.',
    '.kBkrrrrrk..',
    '.kBkkkkkk...',
    '.kBk........',
    '.kBk........',
    '.kBk........',
    '.kBk........',
    'kkBkk.......',
    'kGgGk.......',
  ],
  road: [
    '............',
    'kkkkkkkkkkkk',
    'kLlLLLlLLlLk',
    'kkkkkkkkkkkk',
    'knBnnBnnnBnk',
    'kBnnnBnnBnnk',
    'knnBnnnBnnBk',
    'kBnnBnnnBnnk',
    'kkkkkkkkkkkk',
    'kLLlLLLlLLLk',
    'kkkkkkkkkkkk',
    '............',
  ],
  pave: STREET,
  reserve: [
    '.kk......kk.',
    'kNYk.ww.kNYk',
    'kNNk....kNNk',
    '.kk..kk..kk.',
    '.w..kIIk..w.',
    '....kIFk....',
    '.w..kIIk..w.',
    '....kkkk....',
    '.kk..kk..kk.',
    'kNYk....kNYk',
    'kNNk.ww.kNNk',
    '.kk......kk.',
  ],
  demolish: [
    '............',
    '..kkkkkkk...',
    '.kzzzzzzzk..',
    'kzkkkBkkkzk.',
    'kk..kBk...kk',
    '.....kBk....',
    '......kBk...',
    '.......kBk..',
    '.kk.....kBk.',
    'kOQk.....kBk',
    'kQOQk.....kk',
    '.kkk........',
  ],
};

const OVERLAYS: Record<string, Grid> = {
  aqua: [
    '............',
    'kkkkkkkkkkkk',
    'kccccccccCCk',
    'kkkkkkkkkkkk',
    'kaaaaaaaaiik',
    'kaakkaakkaik',
    'kakqqkkqqkik',
    'kakqqkkqqkik',
    'kakqqkkqqkik',
    'kakqqkkqqkQk',
    'kkkkkkkkkkkk',
    '............',
  ],
  domus: [
    '.....kk.....',
    '....kssk....',
    '...ksuuvk...',
    '..ksuuuuvk..',
    '.ksuuuuuuvk.',
    'kkkkkkkkkkkk',
    '.kssssssnnk.',
    '.kskkskqqnk.',
    '.kskkskqqnk.',
    '.ksssskqqnk.',
    '.kkkkkkkkkk.',
    '............',
  ],
  officia: [
    '...kkkkkk...',
    '..k......k..',
    '.k..kkkk..k.',
    'k..k....k..k',
    'k.k..kk..k.k',
    'k.k.kyyk.k.k',
    'k.k.kYNk.k.k',
    'k.k..kk..k.k',
    'k..k....k..k',
    '.k..kkkk..k.',
    '..k......k..',
    '...kkkkkk...',
  ],
  desir: LAUREL,
  terra: [
    '............',
    '.....kk.....',
    '....kOOk..kk',
    '...kOaOQkkLk',
    '..kOaOOQQkLk',
    '.kOaOOOQQQkk',
    'kLlLLLLLLLLk',
    'kyYyYyYyYyYk',
    'kYyYyYyYyYyk',
    'kyYyYyYyYyYk',
    'kkkkkkkkkkkk',
    '............',
  ],
};

/** The coverage-rings glyph tinted: the outer rings in water blue so they read on the dark overlay bar. */
function rings(g: Grid): Grid {
  return g.map((r, y) => [...r].map((k, x) => (k === 'k' && Math.abs(x - 5.5) + Math.abs(y - 5.5) >= 4 ? 'c' : k)).join(''));
}

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerIcons(): void {
  const add = (name: string, g: Grid): void => registerArt(name, g, { outline: false });
  // resources
  const RES: Record<string, Grid> = {
    denarii: COIN, grain: SHEAF, water: DROP, timber: LOGS, stone: BLOCKS, tiles: TILES, concrete: CONCRETE,
    ore: ORE, iron: INGOTS, tools: KIT, oil: OIL, wine: GRAPES,
  };
  for (const [r, g] of Object.entries(RES)) add(`i_${r}`, g);
  // spirits, laurel, seasons, star
  for (const m of [0, 1, 2, 3, 4] as const) add(`i_face_${m}`, face(m));
  add('i_laurel', LAUREL);
  SEASON_ICONS.forEach((g, k) => add(`i_season_${k}`, g));
  add('i_star', STAR);
  // what the house wants (DESIGN §7.7)
  const WANTS: Record<string, Grid> = {
    street: STREET, water: DROP, fed: SHEAF, religion: SHRINE, market: BASKET, temple: TEMPLE, desirability: LAUREL,
    baths: BATH, macellum: THOLOS, rank: SCROLL, materials: CRATE,
    oil: recolor(AMPHORA, { X: 'Y', N: 'V' }), wine: recolor(AMPHORA, { X: 'I', N: 'P' }),
  };
  for (const [n, g] of Object.entries(WANTS)) add(`i_want_${n}`, g);
  // status marks
  for (const [n, g] of Object.entries(MARKS)) add(n, g);
  add('i_unpaid', COIN.map((r, y) => [...r].map((k, x) => (k !== '.' && Math.abs(x - (11 - y)) <= 0 ? 'r' : k !== '.' && Math.abs(x - (11 - y)) === 1 ? 'k' : k)).join('')));
  add('i_souls', SOULS);
  add('i_beds', BED);
  // tabs, tools, overlays
  for (const [t, g] of Object.entries(TABS)) add(`i_tab_${t}`, g);
  for (const [t, g] of Object.entries(TOOLS)) add(`i_tool_${t}`, g);
  for (const [o, g] of Object.entries(OVERLAYS)) add(`i_ov_${o}`, o === 'officia' ? rings(g) : g);
}
