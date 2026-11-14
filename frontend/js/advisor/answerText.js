/** Parses the model's plain-text answer into blocks: { type: 'p', text } or { type: 'ul', items }. No HTML is ever produced. */
export function parseAnswer(text) {
  const blocks = [];
  let list = null;
  const strip = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`#]/g, '');
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) { list = { type: 'ul', items: [] }; blocks.push(list); }
      list.items.push(strip(bullet[1]));
    } else {
      list = null;
      if (line) blocks.push({ type: 'p', text: strip(line) });
    }
  }
  return blocks;
}
