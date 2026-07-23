// swallow er for bevisst ignorerte feil (ikke-kritisk persistens, valgfri
// lasting). I dev logges de så de ikke forsvinner helt stille; i prod er de
// no-op. Bruk i stedet for et bart `.catch(swallow)`.
export function swallow(err: unknown): void {
  if (import.meta.env.DEV) {
    console.warn("[swallow]", err);
  }
}
