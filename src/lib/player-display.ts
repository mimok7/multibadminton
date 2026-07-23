function hideLevelSuffix(name: string) {
  return String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export function formatNameWithCoins(name: string, coinBalance?: number | null) {
  const displayName = hideLevelSuffix(name);
  if (typeof coinBalance !== 'number') {
    return displayName;
  }

  return `${displayName} (${coinBalance})`;
}

export function formatCurrentUserNameWithCoins(name: string, coinBalance?: number | null) {
  const displayName = hideLevelSuffix(name);
  if (typeof coinBalance !== 'number') {
    return displayName;
  }

  return `${displayName} (${coinBalance}코인)`;
}
