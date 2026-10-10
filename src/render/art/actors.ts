// src/render/art/actors.ts — walkers, carts, the merchant wagon, veterans' tent and animals (ARCHITECTURE §12.3 Actors,
// DESIGN §16.3 sizes). Owner: WP-G (art, part 2). Anchored at the feet; the `k` outline is added at rasterisation
// (a_ prefix). People use the tint placeholders S (tunic), A (hair) and U (belt/leggings) so WP-F can dye them per
// labour category (§12.6); patricians wear white togas, elders white hair. Vehicles and animals face right (east);
// WP-F mirrors them for westward travel.
import { registerArt } from '../sprites';
import type { Grid } from '../sprites';

// ── people, 7×10 (the k outline fills the free border) ──
const PERSON_IDLE: Grid = [
  '.......',
  '..AAA..',
  '.AhhhA.',
  '..hHh..',
  '.SSSSS.',
  '.hSSSh.',
  '.hSUSh.',
  '..SSS..',
  '..H.H..',
  '..b.b..',
];
const PERSON_WALK0: Grid = [
  '.......',
  '..AAA..',
  '.AhhhA.',
  '..hHh..',
  '.SSSSS.',
  'hSSSSS.',
  '.SSUSh.',
  '..SSS..',
  '.H...H.',
  '.b...b.',
];
const PERSON_WALK1: Grid = [
  '.......',
  '..AAA..',
  '.AhhhA.',
  '..hHh..',
  '.SSSSS.',
  '.SSSSSh',
  '.hSUSS.',
  '..SSS..',
  '..HH...',
  '..bb...',
];
/** Working: a basket of goods carried on the shoulder. */
const PERSON_WORK: Grid = [
  '....nt.',
  '..AAntn',
  '.AhhhBn',
  '..hHhh.',
  '.SSSSS.',
  '.hSSSS.',
  '.hSUSS.',
  '..SSS..',
  '..H.H..',
  '..b.b..',
];

// ── children, 5×6 ──
const CHILD_IDLE: Grid = ['.....', '.AAA.', '.hhh.', '.SSS.', '.SSS.', '.H.H.'];
const CHILD_WALK0: Grid = ['.....', '.AAA.', '.hhh.', 'hSSS.', '.SSSh', 'H...H'];
const CHILD_WALK1: Grid = ['.....', '.AAA.', '.hhh.', '.SSSh', 'hSSS.', '.HH..'];

// ── elders, 7×10: white hair, a stoop and a staff ──
const ELDER_IDLE: Grid = [
  '.......',
  '..WWW..',
  '.WhhhW.',
  '..hHh.b',
  '.SSSSSb',
  '.hSSShb',
  '.hSUS.b',
  '..SSS.b',
  '..H.H.b',
  '..b.b.b',
];
const ELDER_WALK0: Grid = [
  '.......',
  '..WWW..',
  '.WhhhW.',
  '..hHh.b',
  '.SSSSSb',
  '.hSSShb',
  '.hSUS.b',
  '..SSS.b',
  '.H..H.b',
  '.b..b.b',
];
const ELDER_WALK1: Grid = [
  '.......',
  '..WWW..',
  '.WhhhW.',
  '..hHh..',
  '.SSSSS.',
  '.hSSSSh',
  '.hSUS.b',
  '..SSS.b',
  '..HH..b',
  '..bb..b',
];

// ── patricians, 7×10: a white toga with the purple clavus ──
const PATRICIAN_IDLE: Grid = [
  '.......',
  '..AAA..',
  '.AhhhA.',
  '..hHh..',
  '.wwIWW.',
  '.hwIWh.',
  '.wwIWW.',
  '.wwIWW.',
  '..wWW..',
  '..b.b..',
];
const PATRICIAN_WALK0: Grid = [
  '.......',
  '..AAA..',
  '.AhhhA.',
  '..hHh..',
  '.wwIWW.',
  'hwwIWW.',
  '.wwIWWh',
  '.wwIWW.',
  '.wW..W.',
  '.b...b.',
];
const PATRICIAN_WALK1: Grid = [
  '.......',
  '..AAA..',
  '.AhhhA.',
  '..hHh..',
  '.wwIWW.',
  '.wwIWWh',
  'hwwIWW.',
  '.wwIWW.',
  '..wW...',
  '..bb...',
];

// ── legionary, 9×12: crested helmet, lorica, red tunic, scutum and pilum (two marching frames) ──
const LEGIONARY_0: Grid = [
  '.....r..z',
  '....rrr.z',
  '...gGGGgb',
  '...ghhhgb',
  '...hhHhgb',
  '.rrzgzgzb',
  'rFNrgzgzh',
  'rNyNFFFFb',
  'rFNrFFFFb',
  '.rrrH.H.b',
  '....H..Hb',
  '....b..b.',
];
const LEGIONARY_1: Grid = [
  '.....r..z',
  '....rrr.z',
  '...gGGGgb',
  '...ghhhgb',
  '...hhHhgb',
  '.rrzgzgzb',
  'rFNrgzgzh',
  'rNyNFFFFb',
  'rFNrFFFFb',
  '.rrrHH..b',
  '....HH..b',
  '....bb...',
];

// ── priest, 7×10: veiled head (capite velato), white robe, a gilt patera; frame 1 lifts it ──
const PRIEST_0: Grid = [
  '.......',
  '..www..',
  '.wwhhW.',
  '.whHhW.',
  '.wwwWW.',
  '.wwwWhN',
  '.wwIWW.',
  '.wwIWW.',
  '.wwIWW.',
  '..b.b..',
];
const PRIEST_1: Grid = [
  '......N',
  '..www.h',
  '.wwhhWh',
  '.whHhWw',
  '.wwwWW.',
  '.wwwWW.',
  '.wwIWW.',
  '.wwIWW.',
  '.wwIWW.',
  '..b.b..',
];

// ── ox-cart, 20×12 (facing east): a solid-wheeled plaustrum of sacks and amphorae behind an ox ──
const OXCART_0: Grid = [
  '....................',
  '..EeE.u.............',
  '.EEeEuvu........e.e.',
  '.EEEEuvu.........BB.',
  'BnnnnnnnB...nnnnnBnB',
  'BbbbbbbbBbbbBBBBBBBh',
  '.bbBBb.....BBBBBBB..',
  '.bBnnBb....B.B..B.B.',
  '.BnbbnB....B..B.B..B',
  '.bBnnBb....b..b.b..b',
  '..bBBb..............',
  '....................',
];
const OXCART_1: Grid = [
  '....................',
  '..EeE.u.............',
  '.EEeEuvu........e.e.',
  '.EEEEuvu.........BB.',
  'BnnnnnnnB...nnnnnBnB',
  'BbbbbbbbBbbbBBBBBBBh',
  '.bbBBb.....BBBBBBB..',
  '.bBnbBb.....BB...BB.',
  '.BbbbbB.....B.B..B.B',
  '.bBnbBb.....b.b..b.b',
  '..bBBb..............',
  '....................',
];

// ── mule train, 24×12: two pack mules with red-and-ochre panniers ──
const MULES_0: Grid = [
  '........................',
  '.................G.G....',
  '...F.........FF..GG.....',
  '..FFs.......FFsGGGGx....',
  '.GGGGGG.....GGGGGGGGx...',
  'GGgGGGGGG..GgGGGGGG.....',
  'G.GGGGGGG.GGGGGGGG......',
  '..G.G..G.G..G.G..G......',
  '..G..G.G.....G..G.......',
  '..x..x.x.....x..x.......',
  '........................',
  '........................',
];
const MULES_1: Grid = [
  '........................',
  '.................G.G....',
  '...F.........FF..GG.....',
  '..FFs.......FFsGGGGx....',
  '.GGGGGG.....GGGGGGGGx...',
  'GGgGGGGGG..GgGGGGGG.....',
  'G.GGGGGGG.GGGGGGGG......',
  '...GG.G.G....GG.G.......',
  '...G..GG.....G.G........',
  '...x..xx.....x.x........',
  '........................',
  '........................',
];

// ── merchant wagon, 24×14: a striped awning on hoops, two spoked wheels, a draught horse ──
const WAGON_0: Grid = [
  '........................',
  '..errerreerr............',
  '.eerreerreerr...........',
  '.eerreerreerr...........',
  '.eerreerreerr........n..',
  '.Bnnnnnnnnnnn.......nBB.',
  '.BbbbbbbbbbbbbbbBBBBBBBt',
  '..bBnBb..bBnBb..BBBBBn..',
  '..BnbnB..BnbnB..nB..nB..',
  '..bBnBb..bBnBb..B...B...',
  '...bbb....bbb...b...b...',
  '........................',
  '........................',
  '........................',
];
const WAGON_1: Grid = [
  '........................',
  '..errerreerr............',
  '.eerreerreerr...........',
  '.eerreerreerr...........',
  '.eerreerreerr........n..',
  '.Bnnnnnnnnnnn.......nBB.',
  '.BbbbbbbbbbbbbbbBBBBBBBt',
  '..bnBnb..bnBnb..BBBBBn..',
  '..BbnbB..BbnbB...nBnB...',
  '..bnBnb..bnBnb...B.B....',
  '...bbb....bbb....b.b....',
  '........................',
  '........................',
  '........................',
];

// ── veterans' tent, 16×10: a red legion papilio with its flap tied back ──
const VETTENT: Grid = [
  '................',
  '.......rF.......',
  '......rrFF......',
  '.....rrrFFF.....',
  '....rrrFqFFF....',
  '...rrrrqqFFFF...',
  '..rrrrqqqFFFFF..',
  '.rrrrSqqqqFFFFF.',
  'rrrrSSqqqqqFFFFR',
  'b..............b',
];

// ── plough ox, 16×10: the white sacrificial ox drawing the bronze ploughshare of the sulcus primigenius ──
const OX_0: Grid = [
  '................',
  '..........e..e..',
  '...........ee...',
  '.WwwwwwwwW.wwW..',
  'bWwwwwwwwWwwwwh.',
  'NbWWWWWWWWwwW...',
  'Nb.wW.W..wW.....',
  'NN.w..W..w.W....',
  '...W..W..W.W....',
  '...k..k..k.k....',
];
const OX_1: Grid = [
  '................',
  '..........e..e..',
  '...........ee...',
  '.WwwwwwwwW.wwW..',
  'bWwwwwwwwWwwwwh.',
  'NbWWWWWWWWwwW...',
  'Nb..wWW...wW....',
  'NN..w.W...ww....',
  '....W.W...WW....',
  '....k.k...kk....',
];

// ── birds, sheep, fish ──
const BIRD_0: Grid = ['.....', 'x...x', '.x.x.', '..x..'];
const BIRD_1: Grid = ['.....', '.....', 'xx.xx', '..x..'];
const SHEEP: Grid = ['.......', '.wwwww.', 'wWwwwwG', 'wwwwWwk', '.G..G..', '.......'];
const FISH: Grid = ['.....', '.Cc..', 'CccwC', '.Cc..'];

/** A legion-red cloak (sagum) over the shoulders and down the back (the sprites face right, so the back is column 0–1). */
function cloaked(rows: Grid): string[] {
  return rows.map((r, y) => {
    const c = [...r];
    if (y === 4) for (let x = 0; x < c.length; x++) if (c[x] === 'S') c[x] = 'r';
    if (y === 5 || y === 6) { c[0] = 'R'; c[1] = 'r'; }
    if (y === 7) c[1] = 'R';
    return c.join('');
  });
}

/** A citizen's plain toga: the patrician's toga without the purple clavus (Ius Latii, DESIGN §9.2). */
function plainToga(rows: Grid): string[] {
  return rows.map((r) => r.replace(/I/g, 'i'));
}

/** Registers this group's sprites with registerArt()/registerDraw() (no canvas work at registration). */
export function registerActors(): void {
  const frames: [string, Grid][] = [
    ['a_person_idle', PERSON_IDLE], ['a_person_walk0', PERSON_WALK0], ['a_person_walk1', PERSON_WALK1], ['a_person_work', PERSON_WORK],
    ['a_child_idle', CHILD_IDLE], ['a_child_walk0', CHILD_WALK0], ['a_child_walk1', CHILD_WALK1],
    ['a_elder_idle', ELDER_IDLE], ['a_elder_walk0', ELDER_WALK0], ['a_elder_walk1', ELDER_WALK1],
    ['a_patrician_idle', PATRICIAN_IDLE], ['a_patrician_walk0', PATRICIAN_WALK0], ['a_patrician_walk1', PATRICIAN_WALK1],
    ['a_legionary_0', LEGIONARY_0], ['a_legionary_1', LEGIONARY_1],
    ['a_priest_0', PRIEST_0], ['a_priest_1', PRIEST_1],
    ['a_oxcart_0', OXCART_0], ['a_oxcart_1', OXCART_1],
    ['a_mules_0', MULES_0], ['a_mules_1', MULES_1],
    ['a_wagon_0', WAGON_0], ['a_wagon_1', WAGON_1],
    ['a_ox_0', OX_0], ['a_ox_1', OX_1],
    ['a_bird_0', BIRD_0], ['a_bird_1', BIRD_1],
    ['a_vettent', VETTENT], ['a_sheep', SHEEP], ['a_fish', FISH],
  ];
  // the path looks of the walkers (DESIGN §9.2): veterans' cloaks (Colonia veteranorum), citizens' togas (Ius Latii)
  for (const [f, rows] of [['idle', PERSON_IDLE], ['walk0', PERSON_WALK0], ['walk1', PERSON_WALK1], ['work', PERSON_WORK]] as const)
    frames.push([`a_veteran_${f}`, cloaked(rows)]);
  for (const [f, rows] of [['idle', PATRICIAN_IDLE], ['walk0', PATRICIAN_WALK0], ['walk1', PATRICIAN_WALK1]] as const)
    frames.push([`a_citizen_${f}`, plainToga(rows)]);
  for (const [name, rows] of frames) registerArt(name, rows, { outline: !name.startsWith('a_bird') && name !== 'a_fish' });
}
