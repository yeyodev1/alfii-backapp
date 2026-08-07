/**
 * La edad se DERIVA de la fecha de nacimiento. Nunca se pide como dato
 * separado: pedir ambas es una pregunta de friccion extra que no aporta
 * ninguna informacion nueva.
 */
export function deriveAge(birthDate?: Date | null): number | null {
  if (!birthDate) return null;

  const now = new Date();
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;

  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();

  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }

  if (age < 0 || age > 120) return null;
  return age;
}

export function isPlausibleBirthDate(value: unknown): boolean {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return false;
  const age = deriveAge(date);
  return age !== null && age >= 16 && age <= 110;
}
