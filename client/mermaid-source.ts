/** Some agents use JavaScript-style quote escapes inside flowchart labels.
 * Mermaid expects entities instead. Only use this variant after parsing fails;
 * leave comments, other diagram languages, and other escapes untouched. */
export function compatibleFlowchartSource(source: string): string {
  const lines = source.split('\n');
  const header = lines.find(line => line.trim() && !line.trimStart().startsWith('%%'));
  if (!header || !/^\s*(?:flowchart|graph)\b/.test(header)) return source;
  return lines.map(line => line.trimStart().startsWith('%%') ? line : line.replace(/"((?:\\.|[^"\\\r\n])*)"/g,
    (_quoted, label: string) => `"${label.replace(/\\./g, escape => escape === '\\"' ? '#quot;' : escape)}"`,
  )).join('\n');
}
