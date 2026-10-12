let counter = 0

export function newId(prefix = 'obj'): string {
  counter += 1
  return `${prefix}_${counter}`
}

/** Garante que novos ids não colidam com ids carregados de um arquivo. */
export function reserveId(id: string): void {
  const m = /_(\d+)$/.exec(id)
  const n = m ? Number(m[1] ?? 0) : 0
  counter = Math.max(counter, n)
}

export function resetIds(): void {
  counter = 0
}

export function uuid(): string {
  return crypto.randomUUID()
}

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 2147483646)
}
