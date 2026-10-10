import { describe, expect, it } from "vitest";
import {
  InvalidPositionError,
  comparePositions,
  initialPositions,
  positionBetween,
} from "./position.js";

describe("positionBetween", () => {
  it("genera la primera clave cuando no hay vecinos", () => {
    expect(positionBetween(null, null)).toBe("a0");
  });

  it("inserta al final y al inicio", () => {
    expect(positionBetween("a0", null) > "a0").toBe(true);
    expect(positionBetween(null, "a0") < "a0").toBe(true);
  });

  it("inserta en medio de dos claves", () => {
    const mid = positionBetween("a0", "a1");
    expect(mid > "a0" && mid < "a1").toBe(true);
  });

  it("sigue funcionando tras 500 inserciones seguidas en el mismo hueco", () => {
    // Con promedio de floats esto falla alrededor de la inserción ~50.
    const left = "a0";
    let right = "a1";
    for (let i = 0; i < 500; i++) {
      const mid = positionBetween(left, right);
      expect(mid > left && mid < right).toBe(true);
      right = mid;
    }
  });

  it("lanza InvalidPositionError si los vecinos están desordenados o iguales", () => {
    expect(() => positionBetween("a1", "a0")).toThrow(InvalidPositionError);
    expect(() => positionBetween("a1", "a1")).toThrow(InvalidPositionError);
  });
});

describe("initialPositions", () => {
  it("coincide con las columnas por defecto de create_board", () => {
    expect(initialPositions(3)).toEqual(["a0", "a1", "a2"]);
  });
});

describe("comparePositions", () => {
  it("ordena como COLLATE C (mayúsculas antes que minúsculas)", () => {
    expect(["a1", "a0V", "a0", "a2"].sort(comparePositions)).toEqual([
      "a0",
      "a0V",
      "a1",
      "a2",
    ]);
    expect(comparePositions("B", "a")).toBe(-1);
  });
});
