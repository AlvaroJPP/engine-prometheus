type Rgb = [number, number, number]

// altura -> cor (verde nas baixadas, areia no meio, rocha clara nos picos)
const STOPS: Array<[number, Rgb]> = [
  [-3, [0.30, 0.47, 0.32]],
  [-0.5, [0.42, 0.60, 0.37]],
  [0.6, [0.62, 0.72, 0.42]],
  [1.6, [0.80, 0.78, 0.55]],
  [3.5, [0.88, 0.85, 0.74]],
  [6, [0.95, 0.94, 0.92]],
]

export function colorForHeight(h: number): Rgb {
  const first = STOPS[0]
  const last = STOPS[STOPS.length - 1]
  if (!first || !last) return [1, 1, 1]
  if (h <= first[0]) return first[1]
  if (h >= last[0]) return last[1]
  for (let i = 1; i < STOPS.length; i += 1) {
    const a = STOPS[i - 1]
    const b = STOPS[i]
    if (!a || !b) continue
    if (h <= b[0]) {
      const t = (h - a[0]) / (b[0] - a[0])
      return [
        a[1][0] + (b[1][0] - a[1][0]) * t,
        a[1][1] + (b[1][1] - a[1][1]) * t,
        a[1][2] + (b[1][2] - a[1][2]) * t,
      ]
    }
  }
  return last[1]
}
