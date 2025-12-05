export interface Region {
  type: 'code-fence' | 'expanded-dir' | 'expanded-url' | 'expanded-file';
  start: number;
  end: number;
}

export function findExcludedRegions(lines: string[]): Region[] {
  const regions: Region[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Code fence (track fence length for proper matching)
    const fenceMatch = line.match(/^(`{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      const start = i;
      i++;
      // Find closing fence (must be exact same length or more, nothing else on line)
      while (i < lines.length) {
        const closingMatch = lines[i]!.match(/^(`{3,})\s*$/);
        if (closingMatch && closingMatch[1]!.length >= fence.length) {
          break;
        }
        i++;
      }
      regions.push({ type: 'code-fence', start, end: i });
      i++;
      continue;
    }

    // Expanded directory block
    if (line.match(/^<!-- dir: .+ -->$/)) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i]!.match(/^<!-- \/dir -->$/)) {
        i++;
      }
      regions.push({ type: 'expanded-dir', start, end: i });
      i++;
      continue;
    }

    // Expanded URL block
    if (line.match(/^<!-- url: .+ -->$/)) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i]!.match(/^<!-- \/url -->$/)) {
        i++;
      }
      regions.push({ type: 'expanded-url', start, end: i });
      i++;
      continue;
    }

    // Expanded file block
    if (line.match(/^<!-- file: .+ -->$/)) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i]!.match(/^<!-- \/file -->$/)) {
        i++;
      }
      regions.push({ type: 'expanded-file', start, end: i });
      i++;
      continue;
    }

    i++;
  }

  return regions;
}

export function isInExcludedRegion(lineIndex: number, regions: Region[]): boolean {
  return regions.some((r) => lineIndex >= r.start && lineIndex <= r.end);
}

export function findRegionAt(lineIndex: number, regions: Region[]): Region | undefined {
  return regions.find((r) => lineIndex >= r.start && lineIndex <= r.end);
}
