import { describe, expect, it } from 'vitest';
import {
  capacities,
  countByCompartment,
  LeitnerEngine,
  nextCompartment,
  orient,
  pickNext,
  refill,
  refillCount,
  type CardRef,
} from '../src/lib/leitner/core';

let nextId = 1;

/** n palabras en el compartimento k, con antigüedad creciente a partir de seq. */
function cards(k: number, n: number, seq = 1): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ pairId: nextId++, compartment: k, seq: seq + i }));
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

describe('pickNext', () => {
  it('un compartimento que alcanza su capacidad va antes que el 1.º', () => {
    // 2.º: capacidad 40.
    const c2 = cards(2, 40, 100);
    expect(pickNext([...cards(1, 20), ...c2], 20)).toBe(c2[0]);
    expect(pickNext([...cards(1, 20), ...cards(2, 39, 100)], 20)?.compartment).toBe(1);
  });

  it('revisa del 5.º al 2.º', () => {
    const c5 = cards(5, 280, 1000);
    expect(pickNext([...cards(1, 20), ...cards(2, 40, 100), ...c5], 20)).toBe(c5[0]);
  });

  it('elige la más antigua del compartimento', () => {
    const c2 = cards(2, 40).reverse(); // desordenadas a propósito
    expect(pickNext(c2, 20)?.seq).toBe(1);
  });

  it('pregunta el 1.º aunque no esté lleno', () => {
    const c1 = cards(1, 3, 50);
    expect(pickNext([...c1, ...cards(2, 10)], 20)).toBe(c1[0]);
  });

  it('con el 1.º vacío y nada lleno no hay nada que preguntar', () => {
    expect(pickNext([...cards(2, 39), ...cards(3, 99)], 20)).toBeNull();
  });

  it('no pregunta pendientes ni aprendidas', () => {
    expect(pickNext([...cards(0, 50), ...cards(6, 10)], 20)).toBeNull();
  });
});

describe('refill', () => {
  it('mete en el 1.º las pendientes más antiguas que quepan, como las más recientes', () => {
    const pending = cards(0, 5, 1).reverse();
    const all = [...cards(1, 18, 10), ...pending];
    const moved = refill(all, 20);
    expect(moved.map((c) => c.pairId)).toEqual([pending[4].pairId, pending[3].pairId]);
    expect(moved.map((c) => c.seq)).toEqual([28, 29]);
    expect(countByCompartment(all)).toEqual([3, 20, 0, 0, 0, 0, 0]);
    expect(refill(all, 20)).toEqual([]);
  });
});

describe('LeitnerEngine', () => {
  it('una fallada vuelve al 1.º y reaparece tras las demás', () => {
    const [a, b, c] = cards(1, 3, 1);
    const e = new LeitnerEngine([a, b, c], 20);
    const asked: number[] = [];
    for (const correct of [false, true, true]) {
      asked.push(e.current!.pairId);
      e.answer(correct);
    }
    expect(asked).toEqual([a.pairId, b.pairId, c.pairId]);
    expect(e.current?.pairId).toBe(a.pairId);
    expect(e.totalErrors).toBe(1);
    expect(e.correctCount).toBe(2);
  });

  it('las pendientes entran en el 1.º tras cada acierto', () => {
    const e = new LeitnerEngine([...cards(1, 2, 1), ...cards(0, 3, 10)], 2);
    e.answer(true);
    expect(e.counts()).toEqual([2, 2, 1, 0, 0, 0, 0]);
  });

  it('en cuanto el 2.º se llena, la siguiente es del 2.º, y nunca pasa de su capacidad', () => {
    // Capacidades 2/4/10/16/28.
    const e = new LeitnerEngine([...cards(1, 2, 1), ...cards(2, 3, 10), ...cards(0, 40, 100)], 2);
    e.answer(true); // del 1.º al 2.º: el 2.º llega a 4
    expect(e.current?.compartment).toBe(2);
    for (let i = 0; i < 500 && !e.finished; i++) {
      e.answer(i % 3 !== 0);
      const counts = e.counts();
      capacities(2).forEach((cap, k) => {
        if (k > 0) expect(counts[k + 1]).toBeLessThanOrEqual(cap);
      });
    }
  });

  it('termina cuando el 1.º se vacía y ninguno está lleno', () => {
    const e = new LeitnerEngine(cards(1, 2), 20);
    e.answer(true);
    e.answer(true);
    expect(e.finished).toBe(true);
    expect(e.counts()).toEqual([0, 0, 2, 0, 0, 0, 0]);
  });

  it('«La IA se equivocó» lleva la palabra adonde habría ido con un acierto', () => {
    const c3 = cards(3, 100, 1);
    const e = new LeitnerEngine([...c3, ...cards(1, 5, 200)], 20);
    const asked = e.current!;
    expect(asked.compartment).toBe(3);
    e.answer(false, 'x');
    expect(e.counts()[1]).toBe(6);
    e.overrideLastAsCorrect();
    expect(e.answers[0]).toMatchObject({ correct: true, overridden: true });
    expect(e.totalErrors).toBe(0);
    expect(e.counts()).toEqual([0, 5, 0, 99, 1, 0, 0]);
  });

  it('quitar una palabra ya respondida hace que no vuelva a salir', () => {
    const e = new LeitnerEngine(cards(1, 2), 20);
    const first = e.current!;
    e.answer(false);
    e.removeCard(first.pairId);
    expect(e.current?.pairId).not.toBe(first.pairId);
    e.answer(true);
    expect(e.finished).toBe(true);
  });

  it('takeChanges devuelve exactamente lo cambiado desde la última vez', () => {
    const [x, y] = cards(1, 2, 1);
    const p = cards(0, 1, 10)[0];
    const e = new LeitnerEngine([x, y, p], 2);
    expect(e.takeChanges()).toEqual([]);
    e.answer(true); // x sube al 2.º y la pendiente entra en el 1.º
    expect(e.takeChanges()).toEqual([
      { pairId: x.pairId, compartment: 2, seq: 11 },
      { pairId: p.pairId, compartment: 1, seq: 12 },
    ]);
    expect(e.takeChanges()).toEqual([]);
    expect(x.compartment).toBe(1); // las cartas originales no se tocan
  });
});

describe('orient', () => {
  const ref = { a: 'en', b: 'es' };
  const card = (a: string, b: string, langA: string, langB: string) => ({ pairId: 1, a, b, langA, langB });

  it('da la vuelta a las palabras de un cuestionario con los idiomas al revés', () => {
    expect(orient(card('perro', 'dog', 'es', 'en'), ref)).toEqual(card('dog', 'perro', 'en', 'es'));
  });

  it('deja igual las del mismo orden, las de otro par y las de una caja sin idiomas', () => {
    const same = card('dog', 'perro', 'en', 'es');
    const other = card('chien', 'perro', 'fr', 'es');
    expect(orient(same, ref)).toBe(same);
    expect(orient(other, ref)).toBe(other);
    expect(orient(card('perro', 'dog', 'es', 'en'), null)).toEqual(card('perro', 'dog', 'es', 'en'));
  });

  it('no da la vuelta si los dos idiomas son el mismo', () => {
    const mono = card('big', 'large', 'en', 'en');
    expect(orient(mono, { a: 'en', b: 'en' })).toBe(mono);
  });
});
