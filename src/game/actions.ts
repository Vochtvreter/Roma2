// src/game/actions.ts — FROZEN dispatcher of every player action (ARCHITECTURE §8.7).
// UI, bots and remedies mutate state only through these (plus advisors/remedies.applyRemedy). Every action returns
// an ActionResult, never throws, logs what it changed and calls invalidate/touchPeople as needed.
export { placeBuilding as place, demolish, buildRoad, pave, toggleReserveBlock } from './place';
export { cancelSite, prioritise, setOpen, setPrio } from './construction';
export { setHousePref } from './housing';
export { askOrdo, pinBuild, setOrdo, setManualTarget, applyOnce, setLabourPriority } from './ordo/actions';
export { setFocus, setEdict, setSetting, setSwitch, choosePath, renameColony } from './decisions';
export { chooseOption } from './events';
export { createContract, cancelContract, resumeContract, takeOffer, buyNow } from './trade';
export { hush, mute, unmute } from './advisors/engine';
export { dismissTip } from './guide';
