'use client';

import { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type InstallWindow = Window & {
  deferredPrompt?: BeforeInstallPromptEvent;
};

const INSTALL_DISMISSED_KEY = 'badminton-install-prompt-dismissed';
const INSTALL_COMPLETED_KEY = 'badminton-pwa-installed';

function isAppInstalled() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.localStorage.getItem(INSTALL_COMPLETED_KEY) === 'true'
  );
}

export default function AppInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    setInstalled(isAppInstalled());
    setDismissed(window.localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true');

    // 이미 전역 window 객체에 캡처된 prompt가 있다면 바로 가져옴
    const installWindow = window as InstallWindow;
    if (installWindow.deferredPrompt) {
      setDeferredPrompt(installWindow.deferredPrompt);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      installWindow.deferredPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      setInstalled(true);
      window.localStorage.setItem(INSTALL_COMPLETED_KEY, 'true');
      setDeferredPrompt(null);
      installWindow.deferredPrompt = undefined;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      // 자동 설치를 지원하지 않거나 누락된 경우 안내 팝업을 표시
      setShowInstructions(true);
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setInstalled(true);
        window.localStorage.setItem(INSTALL_COMPLETED_KEY, 'true');
      }
      setDeferredPrompt(null);
      (window as InstallWindow).deferredPrompt = undefined;
    } catch (err) {
      console.error('PWA 설치 도중 오류:', err);
      setShowInstructions(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
  };

  const shouldShow = !installed && !dismissed;

  if (!shouldShow) {
    return (
      <>
        {showInstructions && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">수동 앱 설치 안내</h3>
                <button
                  type="button"
                  onClick={() => setShowInstructions(false)}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="size-5" />
                </button>
              </div>
              
              <div className="space-y-4 text-sm text-gray-600">
                <div className="rounded-lg bg-blue-50 p-3 text-blue-900 font-medium">
                  이 브라우저에서는 자동 설치를 지원하지 않습니다. 아래 방법을 통해 홈 화면에 추가해 주세요!
                </div>
                
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span>
                    <p>
                      <strong>iOS Safari:</strong> 하단 툴바의 <strong>공유 버튼(위로 화살표 <span className="inline-block border rounded px-1 text-xs">⎋</span>)</strong>을 클릭합니다.
                    </p>
                  </div>
                  
                  <div className="flex items-start gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span>
                    <p>
                      <strong>컴퓨터 Chrome / Edge:</strong> 주소창 오른쪽의 <strong>앱 설치</strong> 아이콘 또는 우측 상단 <strong>메뉴(더보기)</strong>를 클릭합니다.
                    </p>
                  </div>
                  
                  <div className="flex items-start gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">3</span>
                    <p>
                      메뉴에서 <strong>“앱 설치”</strong> 또는 모바일의 <strong>“홈 화면에 추가”</strong>를 선택하여 완료합니다.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="mt-6">
                <Button
                  type="button"
                  onClick={() => setShowInstructions(false)}
                  className="w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
                >
                  확인했습니다
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-50 p-4 sm:p-6">
        <div className="mx-auto max-w-xl rounded-2xl border border-blue-200 bg-white/95 p-4 shadow-xl backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Smartphone className="size-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">앱 설치를 권장합니다</p>
                  <p className="mt-1 text-sm text-gray-600">
                    홈 화면에 추가하면 더 빠르게 접속할 수 있고, 앱처럼 바로 열 수 있습니다.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDismiss}
                  className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  aria-label="앱 설치 안내 닫기"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  onClick={handleInstall}
                  className={cn('w-full sm:w-auto bg-blue-600 text-white hover:bg-blue-700')}
                >
                  <Download className="size-4" />
                  앱 설치
                </Button>
                <p className="text-xs text-gray-500">
                  컴퓨터에서는 Chrome 또는 Edge 주소창의 앱 설치 아이콘이나 브라우저 메뉴를 사용해 주세요.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showInstructions && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">수동 앱 설치 안내</h3>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="size-5" />
              </button>
            </div>
            
            <div className="space-y-4 text-sm text-gray-600">
              <div className="rounded-lg bg-blue-50 p-3 text-blue-900 font-medium">
                이 브라우저에서는 자동 설치를 지원하지 않습니다. 아래 방법을 통해 홈 화면에 추가해 주세요!
              </div>
              
                <div className="space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span>
                  <p>
                    <strong>iOS Safari:</strong> 하단 툴바의 <strong>공유 버튼(위로 화살표 <span className="inline-block border rounded px-1 text-xs">⎋</span>)</strong>을 클릭합니다.
                  </p>
                </div>
                
                <div className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span>
                  <p>
                      <strong>컴퓨터 Chrome / Edge:</strong> 주소창 오른쪽의 <strong>앱 설치</strong> 아이콘 또는 우측 상단 <strong>메뉴(더보기)</strong>를 클릭합니다.
                  </p>
                </div>
                
                <div className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">3</span>
                  <p>
                    메뉴에서 <strong>“앱 설치”</strong> 또는 모바일의 <strong>“홈 화면에 추가”</strong>를 선택하여 완료합니다.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="mt-6">
              <Button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
              >
                확인했습니다
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
