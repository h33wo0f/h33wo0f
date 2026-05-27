import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// KST(UTC+9) 기준 YYYY-MM-DD 반환
function toKstDateString(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function daysAgoKey(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return toKstDateString(d);
}

// 오래된 → 최신 순 N일 날짜 배열
function lastNDays(n) {
  const dates = [];
  for (let i = n - 1; i >= 0; i--) dates.push(daysAgoKey(i));
  return dates;
}

// KST 기준 weeksAgo주의 월~일 7일
function weekDates(weeksAgo) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const offsetToMonday = (day + 6) % 7;

  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - offsetToMonday - weeksAgo * 7);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// KST 기준 monthsAgo개월 전 달의 모든 날짜
function monthDates(monthsAgo) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() - monthsAgo;

  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  const dates = [];
  for (let i = 1; i <= lastDay.getUTCDate(); i++) {
    const d = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), i));
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function sumKeys(dates) {
  if (!dates.length) return 0;
  const keys = dates.map(d => `hits:${d}`);
  const values = await redis.mget(...keys);
  return values.reduce((sum, v) => sum + (parseInt(v) || 0), 0);
}

async function getDaily(dates) {
  if (!dates.length) return [];
  const keys = dates.map(d => `hits:${d}`);
  const values = await redis.mget(...keys);
  return dates.map((date, i) => ({
    date,
    count: parseInt(values[i]) || 0,
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const today = daysAgoKey(0);

    // 1) 카운트 +1
    await redis.incr(`hits:${today}`);

    // 2) 통계 + 일별 14일
    const [todayCount, yesterdayCount, thisWeek, lastWeek, thisMonth, lastMonth, daily] = await Promise.all([
      sumKeys([today]),
      sumKeys([daysAgoKey(1)]),
      sumKeys(weekDates(0)),
      sumKeys(weekDates(1)),
      sumKeys(monthDates(0)),
      sumKeys(monthDates(1)),
      getDaily(lastNDays(14)),
    ]);

    res.status(200).json({
      today: todayCount,
      yesterday: yesterdayCount,
      thisWeek,
      lastWeek,
      thisMonth,
      lastMonth,
      daily,
    });
  } catch (e) {
    res.status(500).json({ error: 'tracking failed', detail: String(e) });
  }
}
