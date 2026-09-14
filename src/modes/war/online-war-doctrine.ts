import { doctrineNumbers, type Doctrine } from "@stigsim/sim-core";

export function sameWarDoctrine(first: Doctrine, second: Doctrine): boolean {
  const a = doctrineNumbers(first);
  const b = doctrineNumbers(second);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
