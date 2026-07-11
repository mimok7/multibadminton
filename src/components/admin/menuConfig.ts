export type MenuItem = { label: string; href: string; icon?: string };
export type MenuSection = { title: string; items: MenuItem[]; color: string };

export const SECTIONS: MenuSection[] = [
  {
    title: '🏸 경기 관리',
    items: [
      { label: '경기 일정', href: '/match-schedule', icon: '📅' },
      { label: '오늘 게임', href: '/players', icon: '⚡' },
      { label: '예정 게임', href: '/players-scheduled', icon: '⏳' },
      { label: '게임 결과', href: '/match-results', icon: '🏆' },
    ],
    color: 'blue',
  },
  {
    title: '🏆 대회 관리',
    items: [
      { label: '팀 관리', href: '/team-management', icon: '🤝' },
      { label: '대회 경기', href: '/manager/tournament-matches', icon: '🎪' },
      { label: '페어 대회', href: '/manager/pair-tournament-settings', icon: '👥' },
      { label: '대진표', href: '/manager/tournament-bracket', icon: '📊' },
    ],
    color: 'purple',
  },
  {
    title: '🛠️ 관리 도구',
    items: [
      { label: '회원 운영', href: '/members', icon: '👥' },
      { label: '코인 관리', href: '/manager/coins', icon: '🪙' },
      { label: '상품 관리', href: '/manager/products', icon: '🎁' },
    ],
    color: 'green',
  },
  {
    title: '🏢 클럽 운영',
    items: [
      { label: '정기모임', href: '/recurring-matches', icon: '🔄' },
      { label: '공지사항', href: '/manager/notifications', icon: '📢' },
      { label: '코트 관리', href: '/manager/courts', icon: '🏟️' },
    ],
    color: 'orange',
  },
];
