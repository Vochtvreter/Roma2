// tests/smoke.test.ts — newGame + 100 ticks without throwing; serialise round trip (ARCHITECTURE §15).
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/game/types';
import { deserialize, serialize } from '../src/game/save';
import { view } from '../src/game/sim';
import { getMap } from '../src/game/map';
import { formatRoman } from '../src/game/calendar';
import { fresh, noNaN, run } from './util';

describe('smoke', () => {
  it('founds a colony with the DESIGN §18.1 shape', () => {
    const s = fresh(42);
    expect(s.day).toBe(90);
    expect(formatRoman(s.day, { year: true })).toBe('Kal. Apr. AUC DCCC');
    expect(s.people.length).toBe(24);
    expect(s.families.length).toBe(6);
    expect(s.buildings.filter((b) => b.type === 'area' && b.house?.tier === 'tentoria').length).toBe(6);
    expect(s.buildings.filter((b) => b.type === 'puteus').length).toBe(1);
    expect(s.buildings.filter((b) => b.type === 'ager').length).toBe(1);
    expect(s.buildings.filter((b) => b.type === 'principia').length).toBe(1);
    for (const b of s.buildings) expect(BUILDINGS).toContain(b.type);
    expect(s.res.denarii).toBe(600);
    expect(s.res.grain).toBe(480);
    expect(s.res.water).toBe(240);
    expect(s.morale).toBe(65);
    expect(s.log.length).toBeGreaterThan(0);
    expect(noNaN(s)).toEqual([]);
  });

  it('keeps entity lists sorted by id and roads sorted unique', () => {
    const s = fresh(42);
    const sorted = (a: number[]): boolean => a.every((v, i) => i === 0 || a[i - 1] < v);
    expect(sorted(s.buildings.map((b) => b.id))).toBe(true);
    expect(sorted(s.people.map((p) => p.id))).toBe(true);
    expect(sorted(s.families.map((f) => f.id))).toBe(true);
    expect(sorted(s.roads)).toBe(true);
    expect(s.buildings[0].id).toBeGreaterThanOrEqual(1);
    const sv = getMap(s.seed).survey;
    for (const g of sv.gates) expect(s.roads).toContain(g.tile);
    for (const i of sv.via) expect(s.roads).toContain(i);
  });

  it('houses every founder and staffs the field and the well', () => {
    const s = fresh(42);
    const homes = new Set(s.buildings.filter((b) => b.type === 'area').map((b) => b.id));
    for (const p of s.people) expect(homes.has(p.home ?? -1)).toBe(true);
    const ager = s.buildings.find((b) => b.type === 'ager')!;
    const well = s.buildings.find((b) => b.type === 'puteus')!;
    expect(s.people.filter((p) => p.work === ager.id).length).toBe(1);
    expect(s.people.filter((p) => p.work === well.id).length).toBe(2);
  });

  it('runs 100 ticks without throwing or NaN', () => {
    const s = fresh(42);
    run(s, 100);
    expect(s.day).toBe(190);
    expect(noNaN(s)).toEqual([]);
    const v = view(s);
    expect(v.d).toBeTruthy();
    expect(v.c).toBeTruthy();
  });

  it('round-trips through serialise / deserialise', () => {
    const s = run(fresh(7), 30);
    const json = serialize(s);
    expect(JSON.parse(json)).toEqual(s);
    const back = deserialize(json);
    expect(back).not.toBeNull();
    expect(back).toEqual(s);
  });

  it('is deterministic for one seed', () => {
    const a = serialize(run(fresh(3), 100));
    const b = serialize(run(fresh(3), 100));
    expect(a).toBe(b);
  });
});
