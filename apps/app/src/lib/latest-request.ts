export interface LatestRequestGate {
  begin(): number;
  isCurrent(request: number): boolean;
}

/** Prevent an older asynchronous read from replacing state produced by a newer request. */
export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;
  return {
    begin(): number {
      generation += 1;
      return generation;
    },
    isCurrent(request: number): boolean {
      return request === generation;
    },
  };
}
