export function formatKoreanPhone(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';

  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return digits.slice(0, 2) + '-' + digits.slice(2);
    return digits.slice(0, 2) + '-' + digits.slice(2, digits.length - 4) + '-' + digits.slice(-4);
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits.slice(0, 3) + '-' + digits.slice(3, digits.length - 4) + '-' + digits.slice(-4);
}
