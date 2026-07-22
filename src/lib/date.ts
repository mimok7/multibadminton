export function getDateInTimeZone(
  timeZone: string,
  date: Date = new Date()
): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

export function getKoreaDate(date: Date = new Date()): string {
  return getDateInTimeZone('Asia/Seoul', date);
}

const KOREA_TIME_ZONE = 'Asia/Seoul';

function asDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00+09:00`);
  }
  return new Date(value);
}

export function formatKST(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (value === null || value === undefined || value === '') return '';
  return new Intl.DateTimeFormat('ko-KR', {
    ...options,
    timeZone: KOREA_TIME_ZONE,
  }).format(asDate(value));
}

export function formatKSTDate(value: Date | string | number | null | undefined): string {
  return formatKST(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatKSTDateKorean(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';

  const parts = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: KOREA_TIME_ZONE,
  }).formatToParts(asDate(value));
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${dateParts.year}년 ${dateParts.month}월 ${dateParts.day}일`;
}

export function formatKSTDateKoreanWithWeekday(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';

  const weekday = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'short',
    timeZone: KOREA_TIME_ZONE,
  })
    .formatToParts(asDate(value))
    .find((part) => part.type === 'weekday')?.value;

  return `${formatKSTDateKorean(value)}${weekday ? ` (${weekday})` : ''}`;
}

export function formatTimeHHmm(value: string | null | undefined): string {
  if (!value) return '';

  const timePart = value.includes('T') ? value.split('T')[1] : value;
  const match = timePart.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : value;
}

export function formatKSTDateTime(value: Date | string | number | null | undefined): string {
  return formatKST(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getKSTDateTimeLocalValue(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KOREA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}
