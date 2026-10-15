type Rgb = [number, number, number]

// Paleta natural: solo verde escuro nas áreas baixas, verde-musgo nas encostas,
// terra exposta nas elevações e pedra apenas nos pontos mais altos.
const STOPS: Array<[number, Rgb]> = [
  [-3, [0.105, 0.205, 0.075]],
  [-1.5, [0.145, 0.265, 0.085]],
  [-0.3, [0.19, 0.315, 0.105]],
  [0.8, [0.245, 0.345, 0.135]],
  [1.8, [0.34, 0.32, 0.17]],
  [3.2, [0.39, 0.355, 0.255]],
  [4.8, [0.43, 0.415, 0.34]],
  [6, [0.49, 0.475, 0.405]],
]

/** Cor base por altitude, com variação espacial suave para quebrar o aspecto uniforme. */
export function colorForHeight(h: number, x = 0, z = 0): Rgb {
  const first = STOPS[0]
  const last = STOPS[STOPS.length - 1]
  if (!first || !last) return [1, 1, 1]

  let base: Rgb
  if (h <= first[0]) base = first[1]
  else if (h >= last[0]) base = last[1]
  else {
    let result = last[1]
    for (let i = 1; i < STOPS.length; i += 1) {
      const a = STOPS[i - 1]
      const b = STOPS[i]
      if (!a || !b || h > b[0]) continue
      const t = (h - a[0]) / (b[0] - a[0])
      result = [
        a[1][0] + (b[1][0] - a[1][0]) * t,
        a[1][1] + (b[1][1] - a[1][1]) * t,
        a[1][2] + (b[1][2] - a[1][2]) * t,
      ]
      break
    }
    base = result
  }

  // Ruído determinístico em várias escalas: cria manchas orgânicas sem textura externa.
  const broad = Math.sin(x * 0.19 + Math.sin(z * 0.11) * 1.7) * Math.cos(z * 0.16 - x * 0.07)
  const fine = Math.sin(x * 0.73 + z * 0.51) * Math.sin(z * 0.61 - x * 0.37)
  const variation = broad * 0.035 + fine * 0.012
  const altitudeShade = h > 1.5 ? Math.min(0.035, (h - 1.5) * 0.008) : 0

  return [
    Math.max(0, Math.min(1, base[0] + variation + altitudeShade)),
    Math.max(0, Math.min(1, base[1] + variation * 0.9 + altitudeShade)),
    Math.max(0, Math.min(1, base[2] + variation * 0.45 + altitudeShade * 0.8)),
  ]
}
