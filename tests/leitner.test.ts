import { describe, expect, it } from 'vitest';
import {
  capacities,
  countByCompartment,
  LeitnerEngine,
  nextCompartment,
  pickSession,
  refillCount,
} from '../src/lib/leitner/core';
import type { Shuffle } from '../src/lib/quiz/engine';

const identity: Shuffle = (a) => a.slice();

interface Card {
  id: string;
  compartment: number;
  order: number;
}

/** n tarjetas en el compartimento k, con antigüedad creciente. */
function cards(k: number, n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${k}-${i}`, compartment: k, order: i }));
}

describe('reglas básicas', () => {
  it('capacidades en proporción 1:2:5:8:14', () => {
    expect(capacities(20)).toEqual([20, 40, 100, 160, 280]);
  });

  it('acierto sube, fallo vuelve al 1.º, el 5.º acertado queda aprendido', () => {
    expect(nextCompartment(1, true)).toBe(2);
    expect(nextCompartment(4, false)).toBe(1);
    expect(nextCompartment(1, false)).toBe(1);
    expect(nextCompartment(5, true)).toBe(6);
  });

  it('cuenta por compartimento incluyendo pendientes y aprendidas', () => {
    expect(countByCompartment([...cards(0, 3), ...cards(1, 2), ...cards(6, 1)])).toEqual([3, 2, 0, 0, 0, 0, 1]);
  });

  it('las pendientes rellenan el 1.º hasta su capacidad', () => {
    expect(refillCount(0, 50, 20)).toBe(20);
    expect(refillCount(15, 50, 20)).toBe(5);
    expect(refillCount(15, 2, 20)).toBe(2);
    expect(refillCount(25, 50, 20)).toBe(0);
  });
});

describe('pickSession', () => {
  it('con el 1.º lleno lo pregunta entero', () => {
    const picked = pickSession([...cards(1, 20), ...cards(2, 5)], 20, identity);
    expect(picked).toHaveLength(20);
    expect(picked.every((c) => c.compartment === 1)).toBe(true);
  });

  it('de un compartimento lleno que no es el 1.º toma las más antiguas: lo que sobra más un lote', () => {
    // 2.º: capacidad 40, hay 45 → sobran 5, más un lote de 20 = 25.
    const c2 = cards(2, 45).reverse(); // desordenadas a propósito
    const picked = pickSession([...c2, ...cards(1, 3)], 20, identity);
    expect(picked).toHaveLength(25);
    expect(picked.map((c) => c.order)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('repasa los llenos del último al primero', () => {
    const picked = pickSession([...cards(1, 20), ...cards(3, 100)], 20, identity);
    expect(picked.slice(0, 20).every((c) => c.compartment === 3)).toBe(true);
    expect(picked.slice(20).every((c) => c.compartment === 1)).toBe(true);
    expect(picked).toHaveLength(40);
  });

  it('si ninguno está lleno pregunta el 1.º entero', () => {
    const picked = pickSession([...cards(1, 7), ...cards(2, 10)], 20, identity);
    expect(picked).toHaveLength(7);
    expect(picked.every((c) => c.compartment === 1)).toBe(true);
  });

  it('con el 1.º vacío y nada lleno, un lote del más lleno en proporción', () => {
    // 2.º: 30/40 = 75 %; 3.º: 60/100 = 60 % → el 2.º, lote de 20.
    const picked = pickSession([...cards(2, 30), ...cards(3, 60)], 20, identity);
    expect(picked).toHaveLength(20);
    expect(picked.every((c) => c.compartment === 2)).toBe(true);
  });

  it('no pregunta pendientes ni aprendidas', () => {
    expect(pickSession([...cards(0, 50), ...cards(6, 10)], 20, identity)).toEqual([]);
  });
});

describe('LeitnerEngine', () => {
  it('una sola pasada: los fallos no se repiten', () => {
    const e = new LeitnerEngine(['a', 'b', 'c']);
    e.answer(false);
    e.answer(true);
    e.answer(false);
    expect(e.finished).toBe(true);
    expect(e.round).toBe(1);
    expect(e.totalErrors).toBe(2);
    expect(e.correctCount).toBe(1);
  });

  it('«La IA se equivocó» convierte el último fallo en acierto', () => {
    const e = new LeitnerEngine(['a', 'b']);
    e.answer(false, 'x');
    e.overrideLastAsCorrect();
    expect(e.totalErrors).toBe(0);
    expect(e.answers[0]).toMatchObject({ correct: true, overridden: true });
    expect(e.current).toBe('b');
  });

  it('skip quita la palabra actual sin contarla', () => {
    const e = new LeitnerEngine(['a', 'b', 'c']);
    e.answer(true);
    e.skip();
    expect(e.current).toBe('c');
    expect(e.roundSize).toBe(2);
    expect(e.answers).toHaveLength(1);
    e.answer(true);
    expect(e.finished).toBe(true);
  });
});
