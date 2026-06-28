'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { hasFullAccess } from './allowed-users';

/**
 * 現在のログインユーザーが「全機能フルアクセス対象（運営／家族）」かを返すフック。
 *
 * - マウント後に Supabase からユーザーを取得し、メールで判定する（SSR/初期は false）。
 * - 判定は allowed-users の hasFullAccess に集約（メール正規化込み）。
 * - 表示の出し分け用。サーバ側の権限/RLS を置き換えるものではない。
 */
export function useFullAccess(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const sb = getSupabaseBrowserClient();
    void sb?.auth.getUser().then(({ data }) => setFull(hasFullAccess(data.user?.email)));
  }, []);
  return full;
}
