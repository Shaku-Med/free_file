/**
 * Format a number with abbreviations (k, m, b, t)
 * Examples: 1000 -> 1k, 1500000 -> 1.5m, 2000000000 -> 2b
 */
export const formatNumber = (num: number | string | null | undefined): string => {
  if (num === null || num === undefined) return '0';
  
  const number = typeof num === 'string' ? parseFloat(num) : num;
  
  if (isNaN(number)) return '0';
  if (number === 0) return '0';
  
  const absNumber = Math.abs(number);
  const sign = number < 0 ? '-' : '';
  
  if (absNumber >= 1_000_000_000_000) {
    // Trillions
    return `${sign}${(absNumber / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')}t`;
  } else if (absNumber >= 1_000_000_000) {
    // Billions
    return `${sign}${(absNumber / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}b`;
  } else if (absNumber >= 1_000_000) {
    // Millions
    return `${sign}${(absNumber / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  } else if (absNumber >= 1_000) {
    // Thousands
    return `${sign}${(absNumber / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  } else {
    // Less than 1000
    return `${sign}${Math.floor(absNumber)}`;
  }
};
