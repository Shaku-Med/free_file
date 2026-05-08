const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const WORD_TO_DIGIT: Record<string, number> = {};
ONES.forEach((w, i) => { if (w) WORD_TO_DIGIT[w] = i; });
TENS.forEach((w, i) => { if (w) WORD_TO_DIGIT[w] = i * 10; });
WORD_TO_DIGIT['hundred'] = 100;
WORD_TO_DIGIT['thousand'] = 1000;
WORD_TO_DIGIT['zero'] = 0;

function numberToWords(n: number): string[] {
  if (n < 0 || n > 9999 || !Number.isInteger(n)) return [];
  if (n === 0) return ['zero'];
  const results: string[] = [];

  if (n >= 100) {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    const hWord = ONES[h] + ' hundred' + (rem > 0 ? ' ' + numberToWordsSimple(rem) : '');
    results.push(hWord.trim());
  }

  if (n < 100) {
    results.push(numberToWordsSimple(n));
  }

  // "sixty seven" style (digit-by-digit) for 2-digit numbers
  if (n >= 10 && n <= 99) {
    const d1 = Math.floor(n / 10);
    const d2 = n % 10;
    const digitByDigit = ONES[d1] + ' ' + ONES[d2];
    if (!results.includes(digitByDigit)) results.push(digitByDigit);
  }

  return results.filter(Boolean);
}

function numberToWordsSimple(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o > 0 ? ' ' + ONES[o] : '');
}

function wordsToNumber(words: string): number | null {
  const tokens = words.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // Direct digit words: "six seven" → 67
  const allSingleDigits = tokens.every(t => {
    const v = WORD_TO_DIGIT[t];
    return v !== undefined && v >= 0 && v <= 9;
  });
  if (allSingleDigits && tokens.length >= 2) {
    const concatenated = tokens.map(t => WORD_TO_DIGIT[t]).join('');
    const num = parseInt(concatenated, 10);
    if (Number.isFinite(num)) return num;
  }

  let total = 0;
  let current = 0;
  let hasMatch = false;

  for (const token of tokens) {
    const val = WORD_TO_DIGIT[token];
    if (val === undefined) return null;
    hasMatch = true;

    if (val === 1000) {
      current = (current || 1) * 1000;
      total += current;
      current = 0;
    } else if (val === 100) {
      current = (current || 1) * 100;
    } else {
      current += val;
    }
  }
  total += current;
  return hasMatch ? total : null;
}

/**
 * Expand a search query into alternative forms.
 * "67" → ["67", "sixty seven", "six seven", "sixty-seven"]
 * "six seven" → ["six seven", "67"]
 * "spiderman" → ["spiderman", "spider man"]
 * Returns the original query + expanded variants.
 */
export function expandSearchQuery(query: string): string[] {
  const q = query.trim();
  if (!q) return [];

  const variants = new Set<string>();
  variants.add(q);
  variants.add(q.toLowerCase());

  const tokens = q.split(/\s+/);

  // Expand each numeric token to word forms
  for (const token of tokens) {
    const num = parseInt(token, 10);
    if (Number.isFinite(num) && num >= 0 && num <= 9999 && String(num) === token) {
      const wordForms = numberToWords(num);
      for (const wf of wordForms) {
        const expanded = q.replace(token, wf);
        variants.add(expanded.toLowerCase());
        variants.add(wf);
      }
      // Hyphenated form: "sixty-seven"
      for (const wf of wordForms) {
        if (wf.includes(' ')) {
          variants.add(wf.replace(/ /g, '-'));
        }
      }
    }
  }

  // Try converting word sequences to numbers
  const asNum = wordsToNumber(q);
  if (asNum !== null) {
    variants.add(String(asNum));
  }

  // Try sub-sequences of 2+ consecutive word tokens
  if (tokens.length >= 2) {
    for (let i = 0; i < tokens.length - 1; i++) {
      for (let len = 2; len <= Math.min(4, tokens.length - i); len++) {
        const sub = tokens.slice(i, i + len).join(' ');
        const subNum = wordsToNumber(sub);
        if (subNum !== null) {
          const before = tokens.slice(0, i).join(' ');
          const after = tokens.slice(i + len).join(' ');
          const replaced = [before, String(subNum), after].filter(Boolean).join(' ');
          variants.add(replaced.toLowerCase());
        }
      }
    }
  }

  // Split compound words: "spiderman" → "spider man"
  if (tokens.length === 1 && q.length > 5 && !/\d/.test(q)) {
    // CamelCase split
    const camelSplit = q.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    if (camelSplit !== q.toLowerCase()) variants.add(camelSplit);
    // Merge split words: "spider man" → "spiderman"
  }

  // Merge spaced words: "spider man" → "spiderman"
  if (tokens.length === 2 && tokens.every(t => /^[a-zA-Z]+$/.test(t))) {
    variants.add(tokens.join('').toLowerCase());
  }

  return [...variants].filter(Boolean);
}
