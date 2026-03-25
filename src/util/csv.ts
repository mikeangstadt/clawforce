import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

export interface Target {
  address: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export function parseTargetsFromCsv(filePath: string): Target[] {
  const content = readFileSync(filePath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records.map((row) => {
    const target: Target = {
      address: row.address || row.Address || row.ADDRESS || '',
      name: row.name || row.Name || row.NAME || undefined,
      phone: row.phone || row.Phone || row.PHONE || undefined,
    };

    // Everything else goes into metadata
    const knownKeys = new Set(['address', 'name', 'phone']);
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!knownKeys.has(key.toLowerCase()) && value) {
        metadata[key] = value;
      }
    }
    if (Object.keys(metadata).length > 0) {
      target.metadata = metadata;
    }

    return target;
  });
}

export function parseTargetsFromJson(filePath: string): Target[] {
  const content = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  const records = Array.isArray(data) ? data : data.targets || data.addresses || [];
  return records as Target[];
}

export function parseTargets(filePath: string): Target[] {
  if (filePath.endsWith('.csv')) {
    return parseTargetsFromCsv(filePath);
  }
  return parseTargetsFromJson(filePath);
}
