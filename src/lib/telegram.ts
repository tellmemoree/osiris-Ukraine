const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export function telegramConfigured(): boolean {
  return !!(BOT_TOKEN && CHAT_ID);
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: text.slice(0, 4096),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.warn('[OSIRIS] Telegram send failed:', res.status, err.slice(0, 200));
    }
    return res.ok;
  } catch (e) {
    console.warn('[OSIRIS] Telegram send error:', e instanceof Error ? e.message : e);
    return false;
  }
}
