export const PLANS = {
  free: { price: 0, radars: 1, interval: 600, scans: 100 },
  starter: { price: 19, radars: 5, interval: 120, scans: 10000 },
  pro: { price: 49, radars: 20, interval: 60, scans: 50000 },
  growth: { price: 99, radars: 50, interval: 30, scans: 200000 },
} as const;

export type Plan = keyof typeof PLANS;

export function entitlement(s?: {
  plan: string;
  status: string;
  current_period_end?: string | Date | null;
}) {
  return s && ["active", "trialing"].includes(s.status) &&
    (!s.current_period_end || +new Date(s.current_period_end) > Date.now()) &&
    s.plan in PLANS ? (s.plan as Plan) : "free";
}

export type Schedule = { days: number[]; start: string; end: string } | null;

export function inSchedule(date: Date, timezone: string, schedule: Schedule) {
  if (!schedule) return true;
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (t: string) => p.find((v) => v.type === t)!.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  const time = value("hour") + ":" + value("minute");
  if (schedule.start === schedule.end) return schedule.days.includes(day);
  if (schedule.start < schedule.end) return schedule.days.includes(day) && time >= schedule.start && time < schedule.end;
  return (schedule.days.includes(day) && time >= schedule.start) ||
    (schedule.days.includes((day + 6) % 7) && time < schedule.end);
}

export function validateQuery(query: string) {
  if (query.trim().length < 2 || query.length > 512) throw new Error("Use a query between 2 and 512 characters.");
  const quotes = query.split('"').length - 1;
  if (quotes % 2) throw new Error("Close the quotation marks in your query.");
  let depth = 0;
  for (const c of query) {
    if (c === "(") depth++;
    if (c === ")" && --depth < 0) throw new Error("Check the parentheses in your query.");
  }
  if (depth) throw new Error("Check the parentheses in your query.");
  return query.trim();
}

export type SocialPost = {
  externalId: string; platform: "x"; authorId: string; username: string; displayName?: string;
  text: string; url: string; createdAt: Date;
  metrics: { likes: number; replies: number; reposts: number; quotes: number };
  author: { followers: number; verified: boolean };
};

export function scorePost(p: SocialPost, now = new Date()) {
  const age = Math.max(1, (+now - +p.createdAt) / 60000);
  const engagement = p.metrics.likes + p.metrics.reposts * 2 + p.metrics.quotes * 2 + p.metrics.replies;
  const t = p.text.toLowerCase();
  const intent = /looking for|need a|budget|buy|pay for/.test(t) ? "BUYING_INTENT"
    : /recommend|alternative|what do you use/.test(t) ? "RECOMMENDATION_REQUEST"
    : /expensive|frustrat|broken|hate|bill/.test(t) ? "COMPLAINT"
    : t.includes("?") ? "QUESTION" : /versus|competitor/.test(t) ? "COMPETITOR_MENTION"
    : t.includes("@") ? "BRAND_MENTION" : "GENERAL_DISCUSSION";
  const components = {
    freshness: Math.round(30 * Math.exp(-age / 90)),
    velocity: Math.round(Math.min(25, Math.log1p(engagement / age) * 7)),
    intent: ["BUYING_INTENT", "RECOMMENDATION_REQUEST"].includes(intent) ? 25 : intent === "GENERAL_DISCUSSION" ? 5 : 17,
    saturation: Math.round(10 / (1 + p.metrics.replies / 12)),
    reach: Math.round(Math.min(10, Math.log10(1 + p.author.followers) * 2)),
  };
  return { score: Object.values(components).reduce((a, b) => a + b, 0), intent, components };
}
