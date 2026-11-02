import type { DevroostConfig } from "@devroost/config";

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );

  for (let index = 0; index <= a.length; index += 1) {
    matrix[index][0] = index;
  }

  for (let index = 0; index <= b.length; index += 1) {
    matrix[0][index] = index;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
    }
  }

  return matrix[a.length][b.length];
}

export function closestServiceName(target: string, candidates: string[]): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: levenshteinDistance(target.toLowerCase(), candidate.toLowerCase())
    }))
    .sort((left, right) => left.score - right.score);

  const best = scored[0];
  const threshold = Math.max(2, Math.ceil(target.length * 0.4));
  return best.score <= threshold ? best.candidate : undefined;
}

export function dependencyOrder(config: DevroostConfig): string[] {
  const visited = new Set<string>();
  const temp = new Set<string>();
  const ordered: string[] = [];

  const visit = (serviceName: string) => {
    if (visited.has(serviceName)) {
      return;
    }

    if (temp.has(serviceName)) {
      throw new Error(`Circular dependency detected at service '${serviceName}'.`);
    }

    const service = config.services[serviceName];
    if (!service) {
      throw new Error(`Unknown service '${serviceName}' in dependency graph.`);
    }

    temp.add(serviceName);
    for (const dependency of service.dependsOn ?? []) {
      visit(dependency);
    }
    temp.delete(serviceName);

    visited.add(serviceName);
    ordered.push(serviceName);
  };

  for (const serviceName of Object.keys(config.services)) {
    visit(serviceName);
  }

  return ordered;
}