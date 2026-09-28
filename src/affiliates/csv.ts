type ExportField = { id: string; label: string; type: string };
export function exportColumns(networks: { id: string; fields: ExportField[] }[]) {
  const columns: { key: string; label: string }[] = [];
  const indexes = new Map<string, number>();
  const mappings = new Map<string, Map<number, string>>();
  const normalize = (s: string) =>
    s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  for (const network of networks) {
    const mapping = new Map<number, string>();
    for (const field of network.fields) {
      const sameName =
        network.fields.filter(
          (f) => normalize(f.label) === normalize(field.label) && f.type === field.type,
        ).length > 1;
      const key = JSON.stringify([normalize(field.label), field.type, sameName ? field.id : '']);
      if (!indexes.has(key)) {
        indexes.set(key, columns.length);
        columns.push({
          key,
          label: `Campo: ${field.label} [${field.type}]${sameName ? ' (' + field.id + ')' : ''}`,
        });
      }
      mapping.set(indexes.get(key)!, field.id);
    }
    mappings.set(network.id, mapping);
  }
  return { columns, mappings };
}
export function csvLine(values: unknown[]) {
  return (
    values
      .map((v) => {
        const text =
          v === null || v === undefined
            ? ''
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v);
        return '"' + text.replace(/^[=+@\-\t\r\n]/, "'$&").replace(/"/g, '""') + '"';
      })
      .join(';') + '\r\n'
  );
}
