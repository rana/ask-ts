/**
 * Markdown formatting utilities
 */

/**
 * Align pipe characters in Markdown tables for readability
 *
 * Transforms:
 *   |Name|Age|City|
 *   |---|---|---|
 *   |Alice|30|NYC|
 *
 * Into:
 *   | Name  | Age | City |
 *   |-------|-----|------|
 *   | Alice | 30  | NYC  |
 */
export function alignTables(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Detect start of a table (line starting with |)
    if (isTableRow(line)) {
      const tableLines: string[] = [];

      // Collect all consecutive table rows
      while (i < lines.length && isTableRow(lines[i]!)) {
        tableLines.push(lines[i]!);
        i++;
      }

      // Align and add the table
      const alignedTable = alignTable(tableLines);
      result.push(...alignedTable);
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Check if a line is a table row
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

/**
 * Check if a line is a separator row (|---|---|)
 */
function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return false;
  }
  // Separator contains only |, -, :, and spaces
  return /^\|[\s|:-]+\|$/.test(trimmed);
}

/**
 * Parse a table row into cells
 */
function parseRow(line: string): string[] {
  // Remove leading/trailing pipes and split
  const trimmed = line.trim();
  const inner = trimmed.slice(1, -1); // Remove first and last |

  // Split by | but handle escaped pipes (\|)
  const cells: string[] = [];
  let current = '';
  let i = 0;

  while (i < inner.length) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      // Escaped pipe - keep it
      current += '\\|';
      i += 2;
    } else if (inner[i] === '|') {
      // Cell boundary
      cells.push(current.trim());
      current = '';
      i++;
    } else {
      current += inner[i];
      i++;
    }
  }
  cells.push(current.trim());

  return cells;
}

/**
 * Parse separator row to extract alignment info
 */
function parseAlignment(line: string): Array<'left' | 'center' | 'right' | 'none'> {
  const cells = parseRow(line);
  return cells.map((cell) => {
    const trimmed = cell.trim();
    const leftColon = trimmed.startsWith(':');
    const rightColon = trimmed.endsWith(':');

    if (leftColon && rightColon) return 'center';
    if (rightColon) return 'right';
    if (leftColon) return 'left';
    return 'none';
  });
}

/**
 * Build a separator row with proper width and alignment
 */
function buildSeparator(
  widths: number[],
  alignments: Array<'left' | 'center' | 'right' | 'none'>,
): string {
  const cells = widths.map((width, i) => {
    const align = alignments[i] || 'none';
    const dashes = '-'.repeat(Math.max(width, 3));

    switch (align) {
      case 'left':
        return `:${dashes.slice(1)}`;
      case 'right':
        return `${dashes.slice(1)}:`;
      case 'center':
        return `:${dashes.slice(2)}:`;
      default:
        return dashes;
    }
  });

  return `| ${cells.join(' | ')} |`;
}

/**
 * Align a complete table
 */
function alignTable(lines: string[]): string[] {
  if (lines.length === 0) return [];

  // Parse all rows
  const rows = lines.map(parseRow);

  // Find separator row (usually row 1)
  let separatorIndex = -1;
  let alignments: Array<'left' | 'center' | 'right' | 'none'> = [];

  for (let i = 0; i < lines.length; i++) {
    if (isSeparatorRow(lines[i]!)) {
      separatorIndex = i;
      alignments = parseAlignment(lines[i]!);
      break;
    }
  }

  // Calculate max width for each column
  const columnCount = Math.max(...rows.map((r) => r.length));
  const widths: number[] = new Array(columnCount).fill(0);

  for (const row of rows) {
    for (let col = 0; col < row.length; col++) {
      // Skip separator row in width calculation
      if (rows.indexOf(row) === separatorIndex) continue;
      widths[col] = Math.max(widths[col] || 0, (row[col] || '').length);
    }
  }

  // Ensure minimum width of 3 for each column
  for (let i = 0; i < widths.length; i++) {
    widths[i] = Math.max(widths[i] || 0, 3);
  }

  // Build aligned rows
  const result: string[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (rowIndex === separatorIndex) {
      // Rebuild separator with alignment
      result.push(buildSeparator(widths, alignments));
    } else {
      // Align content cells
      const row = rows[rowIndex]!;
      const cells = widths.map((width, colIndex) => {
        const content = row[colIndex] || '';
        const align = alignments[colIndex] || 'none';

        switch (align) {
          case 'right':
            return content.padStart(width);
          case 'center': {
            const totalPad = width - content.length;
            const leftPad = Math.floor(totalPad / 2);
            const rightPad = totalPad - leftPad;
            return ' '.repeat(leftPad) + content + ' '.repeat(rightPad);
          }
          default:
            return content.padEnd(width);
        }
      });

      result.push(`| ${cells.join(' | ')} |`);
    }
  }

  return result;
}
