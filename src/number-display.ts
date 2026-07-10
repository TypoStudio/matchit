const compactUnits = [
  { threshold: 1_000_000, scale: 1_000_000, suffix: 'M' },
  { threshold: 1_000, scale: 1_000, suffix: 'K' },
] as const;

function displayParts(value: number): { text: string; comparable: number } {
  const unit = compactUnits.find(({ threshold }) => value >= threshold);
  if (!unit) return { text: String(value), comparable: value };

  const scaled = value / unit.scale;
  const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  return {
    text: `${text}${unit.suffix}`,
    comparable: Number(text) * unit.scale,
  };
}

/** 화면에 표시되는 정밀도로 숫자를 축약한다. */
export function formatNumberValue(value: number): string {
  return displayParts(value).text;
}

/**
 * 화면에 표시되는 숫자가 뜻하는 값이다.
 * 예: 1,499와 1,501은 모두 1.5K이므로 판정값도 둘 다 1,500이다.
 */
export function numberDisplayValue(value: number): number {
  return displayParts(value).comparable;
}

export function compareNumberDisplayValues(a: number, b: number): number {
  return numberDisplayValue(a) - numberDisplayValue(b);
}

export function sameNumberDisplayValue(a: number, b: number): boolean {
  return numberDisplayValue(a) === numberDisplayValue(b);
}
