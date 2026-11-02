import { describe, expect, it } from 'vitest';
import { QuizEngine, type Shuffle } from '../src/lib/quiz/engine';

const identity: Shuffle = (a) => a.slice();

function play(engine: QuizEngine<string>, wrongOnce: Set<string>) {
  const failed = new Set<string>();
  while (!engine.finished) {
    const item = engine.current!;
    const wrong = wrongOnce.has(item) && !failed.has(item);
    if (wrong) failed.add(item);
    engine.answer(!wrong);
  }
}

describe('QuizEngine', () => {
  it('termina en una ronda si no hay fallos', () => {
    const e = new QuizEngine(['a', 'b', 'c'], identity);
    play(e, new Set());
    expect(e.round).toBe(1);
    expect(e.firstRoundErrors).toBe(0);
    expect(e.totalErrors).toBe(0);
  });

  it('repite las falladas al final hasta acertarlas', () => {
    const e = new QuizEngine(['a', 'b', 'c', 'd'], identity);
    e.answer(false); // a
    e.answer(true); // b
    e.answer(false); // c
    e.answer(true); // d
    expect(e.round).toBe(2);
    expect(e.queue).toEqual(['a', 'c']);
    expect(e.roundSize).toBe(2);
    e.answer(false); // a otra vez mal
    e.answer(true); // c
    expect(e.round).toBe(3);
    expect(e.queue).toEqual(['a']);
    e.answer(true);
    expect(e.finished).toBe(true);
    expect(e.firstRoundErrors).toBe(2);
    expect(e.totalErrors).toBe(3);
    expect(e.total).toBe(4);
    expect(e.totalCorrect).toBe(4);
  });

  it('permite corregir el último fallo como acierto', () => {
    const e = new QuizEngine(['a', 'b'], identity);
    e.answer(false); // a
    e.overrideLastAsCorrect();
    e.answer(true); // b
    expect(e.finished).toBe(true);
    expect(e.totalErrors).toBe(0);
    expect(e.totalCorrect).toBe(2);
    expect(e.answers[0].overridden).toBe(true);
  });

  it('corregir el último fallo de una ronda anula la ronda nueva', () => {
    const e = new QuizEngine(['a', 'b'], identity);
    e.answer(true);
    e.answer(false); // b: crea la ronda 2 con [b]
    expect(e.round).toBe(2);
    e.overrideLastAsCorrect();
    expect(e.finished).toBe(true);
    expect(e.round).toBe(1);
  });

  it('corregir el último fallo de una ronda con más fallos lo quita de la ronda nueva', () => {
    const e = new QuizEngine(['a', 'b'], identity);
    e.answer(false); // a
    e.answer(false); // b
    e.overrideLastAsCorrect();
    expect(e.round).toBe(2);
    expect(e.queue).toEqual(['a']);
    expect(e.roundSize).toBe(1);
  });

  it('cambiar a fallo un acierto de la ronda lo repite en la siguiente', () => {
    const e = new QuizEngine(['a', 'b', 'c'], identity);
    e.answer(true); // a
    e.flipLast();
    expect(e.answers[0]).toMatchObject({ correct: false, overridden: true });
    e.answer(true); // b
    e.answer(true); // c
    expect(e.round).toBe(2);
    expect(e.queue).toEqual(['a']);
  });

  it('cambiar a fallo el último acierto de una ronda lo añade al final de la siguiente', () => {
    const e = new QuizEngine(['a', 'b'], identity);
    e.answer(false); // a
    e.answer(true); // b: empieza la ronda 2 con [a]
    e.flipLast();
    expect(e.round).toBe(2);
    expect(e.queue).toEqual(['a', 'b']);
    expect(e.roundSize).toBe(2);
    expect(e.totalErrors).toBe(2);
  });

  it('cambiar a fallo el último acierto de todos abre una ronda nueva', () => {
    const e = new QuizEngine(['a'], identity);
    e.answer(true);
    expect(e.finished).toBe(true);
    e.flipLast();
    expect(e.finished).toBe(false);
    expect(e.round).toBe(2);
    expect(e.queue).toEqual(['a']);
  });

  it('cambiar a acierto un fallo ya en la ronda siguiente lo quita de ella', () => {
    const e = new QuizEngine(['a', 'b', 'c'], identity);
    e.answer(false); // a
    e.answer(true); // b
    e.answer(false); // c: ronda 2 con [a, c]
    e.flipLast();
    expect(e.queue).toEqual(['a']);
    expect(e.roundSize).toBe(1);
    expect(e.answers[2]).toMatchObject({ correct: true, overridden: true });
  });

  it('cambiar dos veces la respuesta la deja como estaba', () => {
    const e = new QuizEngine(['a', 'b'], identity);
    e.answer(true); // a
    e.answer(false); // b: ronda 2 con [b]
    e.flipLast();
    expect(e.finished).toBe(true);
    e.flipLast();
    expect(e.answers[1]).toMatchObject({ correct: false, overridden: false });
    expect(e.round).toBe(2);
    expect(e.queue).toEqual(['b']);
  });
});
