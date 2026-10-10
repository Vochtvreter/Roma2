// src/render/art/glyphs.ts — the hand-drawn 12×12 glyphs behind the resource, want and status icons (DESIGN §16.3
// "Icons 12×12"). Owner: WP-G (art, part 2). Each glyph carries its own `k` outline (icons are not auto-outlined),
// is lit from the top-left, and keeps one free pixel of margin where it can so it reads at 12 and 24 px.
import type { Grid } from '../sprites';

/** A gold coin stamped with the denarius' X. */
export const COIN: Grid = [
  '...kkkkkk...',
  '..kyyyyyyk..',
  '.kyyyyyyyYk.',
  'kyyNyyyyNyYk',
  'kyyyNyyNyyYk',
  'kyyyyNNyyyYk',
  'kyyyyNNyyyYk',
  'kyyyNyyNyyYk',
  'kyyNyyyyNYNk',
  '.kYyyyyyYNk.',
  '..kYYYYNNk..',
  '...kkkkkk...',
];

/** An ear of wheat with a leaf (grain and the fed want). */
export const SHEAF: Grid = [
  '.....kk.....',
  '....kyYk.k..',
  '...kkyYkkLk.',
  '..kyYkkyYLk.',
  '..kyYkkyYkk.',
  '...kkyYkk...',
  '..kyYkkyYk..',
  '..kyYkkyYk..',
  '...kkYYkk...',
  '....kYYk....',
  '...kLkYk....',
  '...kk.kk....',
];

/** A water drop. */
export const DROP: Grid = [
  '.....kk.....',
  '....kcck....',
  '....kcck....',
  '...kccCCk...',
  '...kwcCCk...',
  '..kcwccCCk..',
  '..kwcccCCk..',
  '.kcccccCCCk.',
  '.kccccccCCk.',
  '.kCcccCCCCk.',
  '..kCCCCCCk..',
  '...kkkkkk...',
];

/** Two logs, bark and a cut end. */
export const LOGS: Grid = [
  '............',
  '..kkkkkkkk..',
  '.knnBnnBkTk.',
  'knBBBBBkTnTk',
  'kbBbBbBkTtTk',
  '.kkkkkkkkTk.',
  '.knnBnnBkkk.',
  'knBBBBBkTk..',
  'kbBbBbkTnTk.',
  'kbbbbbbkTtk.',
  '.kkkkkkkkk..',
  '............',
];

/** Squared tufa blocks in a little pyramid. */
export const BLOCKS: Grid = [
  '............',
  '...kkkkkk...',
  '...kaaaaik..',
  '...kiOOOQk..',
  '...kOOOOQk..',
  'kkkkkkkkkkkk',
  'kaaaaikaaaik',
  'kiOOOQkiOOQk',
  'kOOOOQkOOOQk',
  'kOOOQQkOOQQk',
  'kkkkkkkkkkkk',
  '............',
];

/** A stack of terracotta roof tiles (tegulae with raised flanges). */
export const TILES: Grid = [
  '............',
  '..kkkkkkkk..',
  '.kossssssok.',
  '.kuuuuuuuuk.',
  '.kvkkkkkkvk.',
  '.kossssssok.',
  '.kuuuuuuuuk.',
  '.kvkkkkkkvk.',
  '.kossssssok.',
  '.kuuuuuuuuk.',
  '.kvvvvvvvvk.',
  '..kkkkkkkk..',
];

/** A block of grey concrete with its aggregate. */
export const CONCRETE: Grid = [
  '............',
  '...kkkkkkk..',
  '..kWWzWWWWk.',
  '.kWzWWWzWGk.',
  'kkkkkkkkkGGk',
  'kgGgggGgkGGk',
  'kggGgggGkGjk',
  'kgggGgGgkGjk',
  'kGggggGgkjjk',
  'kgGgGgggkjk.',
  'kkkkkkkkkk..',
  '............',
];

/** A lump of rust-veined ore. */
export const ORE: Grid = [
  '............',
  '.....kkk....',
  '...kkgGGkk..',
  '..kgGvGGjGk.',
  '.kgGGRvGGjk.',
  '.kGvGGGjvGjk',
  'kgGGjRvGGGjk',
  'kGGGGvGGRjjk',
  'kGjvGGjGjjk.',
  '.kjjjjjjjk..',
  '..kkkkkkk...',
  '............',
];

/** Two iron ingots. */
export const INGOTS: Grid = [
  '............',
  '............',
  '...kkkkkk...',
  '..kzzgggGk..',
  '.kxGGGGGjxk.',
  '.kkkkkkkkkk.',
  '.kzzggkzzgk.',
  'kxGGGGkGGGjk',
  'kxjjjjkjjjxk',
  'kkkkkkkkkkkk',
  '............',
  '............',
];

/** A tool kit: hammer and chisel crossed. */
export const KIT: Grid = [
  '............',
  '.kkkk....kk.',
  'kzzzzk..kzk.',
  'kGGzGk.kzk..',
  '.kkBkk.kzk..',
  '...kBkkzk...',
  '....kBBk....',
  '...kBkBk....',
  '..kbk.kBk...',
  '.kbk...kBk..',
  '.kk.....kBk.',
  '.........kk.',
];

/** A golden drop of olive oil with an olive sprig. */
export const OIL: Grid = [
  '......k.kk..',
  '.....kdkVVk.',
  '....kk.kVdk.',
  '....kYk.kk..',
  '...kyYk.....',
  '...kyYYk....',
  '..kyyYYNk...',
  '..kyYYYNk...',
  '.kyyYYYNNk..',
  '.kyYYYYNNk..',
  '..kNNNNNk...',
  '...kkkkk....',
];

/** A bunch of grapes with a leaf. */
export const GRAPES: Grid = [
  '.....kk.kk..',
  '....kbkkLLk.',
  '...kkbkLlLdk',
  '..kppkpkkdk.',
  '.kpPpkpPpk..',
  '.kPPkpPkPk..',
  '..kkpPkpPk..',
  '..kpPkpPkk..',
  '...kPkpPk...',
  '...kkpPk....',
  '....kPk.....',
  '.....k......',
];

/** An amphora: stopper X and shoulder band N are recoloured for the oil and wine wants. */
export const AMPHORA: Grid = [
  '....kkkk....',
  '....kXXk....',
  '..kk.kk.kk..',
  '.k.kkuukk.k.',
  '.k.kuuuuk.k.',
  '..kuNNNNuk..',
  '..kuNNNNvk..',
  '..kuuuuuvk..',
  '...kuuuvk...',
  '....kuvk....',
  '.....kk.....',
  '............',
];

/** A small shrine (aedicula) with a votive flame. */
export const SHRINE: Grid = [
  '.....yy.....',
  '.....oy.....',
  '....kkkk....',
  '...kaaaik...',
  '..kaaaaiik..',
  '.kkkkkkkkkk.',
  '..kakqqkik..',
  '..kakqokik..',
  '..kakqqkik..',
  '.kkkkkkkkkk.',
  '.kaaaaaiiQk.',
  '.kkkkkkkkkk.',
];

/** A basket of market goods. */
export const BASKET: Grid = [
  '............',
  '...k.k.k....',
  '..krkLkrk...',
  '.krRkLlkRk..',
  'kkkkkkkkkkk.',
  'ktTtTtTtTtk.',
  'kTtTtTtTtTk.',
  '.ktTtTtTtk..',
  '.kTtTtTtTk..',
  '..kkkkkkk...',
  '............',
  '............',
];

/** A temple front: pediment, four columns, steps. */
export const TEMPLE: Grid = [
  '.....kk.....',
  '...kkaakk...',
  '.kkaaaaiikk.',
  'kkkkkkkkkkkk',
  '.kaaaaaaaik.',
  '.kwkwkwkwik.',
  '.kakakakaik.',
  '.kakakakaik.',
  '.kakakakaik.',
  'kkkkkkkkkkkk',
  'kaaaaaaaiiQk',
  'kkkkkkkkkkkk',
];

/** A laurel wreath tied with a red ribbon. */
export const LAUREL: Grid = [
  '..kk....kk..',
  '.klLk..kLdk.',
  'klLk....kLdk',
  'kLk......kdk',
  'klLk....kLdk',
  'kLk......kdk',
  '.klLk..kLdk.',
  '..kLLkkLdk..',
  '...kkrrkk...',
  '....krRk....',
  '...kRk.kRk..',
  '...kk...kk..',
];

/** Steam over a bath basin. */
export const BATH: Grid = [
  '...w...w....',
  '..w...w...w.',
  '..w...w...w.',
  '...w...w..w.',
  '............',
  'kkkkkkkkkkkk',
  'kaccccccccik',
  'kacwcccCCCik',
  'kaCCCCCCCCik',
  'kiiiiiiiiiQk',
  'kkkkkkkkkkkk',
  '............',
];

/** A market hall's round tholos under a tiled cone. */
export const THOLOS: Grid = [
  '.....kk.....',
  '....kssk....',
  '...kssuvk...',
  '..ksuuuuvk..',
  '.kkkkkkkkkk.',
  '.kaiaiaiaik.',
  '.kakqkqkqik.',
  '.kakqkqkqik.',
  '.kakqkqkqik.',
  'kkkkkkkkkkkk',
  'kaaaaaaiiiQk',
  'kkkkkkkkkkkk',
];

/** A sealed charter scroll. */
export const SCROLL: Grid = [
  '............',
  '.kkkkkkkkk..',
  'kTtkeeeeeek.',
  'ktTkeEEEeek.',
  '.kkkeeeeeek.',
  '...keEEEEek.',
  '...keeeeeek.',
  '...keEEEeek.',
  '...keeekkkkk',
  '...kkkkrRktk',
  '......kRrkkk',
  '.......kk...',
];

/** A wooden crate of materials. */
export const CRATE: Grid = [
  '............',
  'kkkkkkkkkkkk',
  'kTtttttttnBk',
  'ktkknnnnkkBk',
  'ktnkknnkknBk',
  'ktnnkkkknnBk',
  'ktnnkkkknnBk',
  'ktnkknnkknBk',
  'ktkknnnnkkBk',
  'knBBBBBBBBbk',
  'kkkkkkkkkkkk',
  '............',
];

/** A paved street with kerbs. */
export const STREET: Grid = [
  '............',
  'kkkkkkkkkkkk',
  'kOOOOOOOOOOk',
  'kkkkkkkkkkkk',
  'kXgXXgXXXgXk',
  'kGXXgXXgXXGk',
  'kXXgXXgXgXXk',
  'kXgXXXgXXgXk',
  'kkkkkkkkkkkk',
  'kOOOOOOOOOOk',
  'kkkkkkkkkkkk',
  '............',
];

/** Two people (souls). */
export const SOULS: Grid = [
  '............',
  '..kk....kk..',
  '.kmmk..kAAk.',
  '.khhk..khhk.',
  '.kHhk..kHhk.',
  'kFFFFkkCCCCk',
  'kFFFFkkCCCCk',
  'khFFhkkhCChk',
  '.kFFk..kCCk.',
  '.khhk..khhk.',
  '.kkkk..kkkk.',
  '............',
];

/** A bed (lectus) with a pillow and blanket. */
export const BED: Grid = [
  '............',
  '............',
  '.kk.........',
  '.knk........',
  '.knkkkkkkkk.',
  '.knwwkFFFFFk',
  '.knwkFrrrrFk',
  '.kkkkkkkkkkk',
  '.knBBBBBBBnk',
  '.kbk.....kbk',
  '.kk.......kk',
  '............',
];
