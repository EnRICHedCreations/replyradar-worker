import { createHash } from "node:crypto";
import { validateQuery, type SocialPost } from "./domain";
export type SearchInput = { query: string; cursor?: string | null; now?: Date };
export type SearchResult = { posts: SocialPost[]; cursor?: string };
export interface SocialSearchProvider {
  search(input: SearchInput): Promise<SearchResult>;
}
export class ProviderError extends Error {
  constructor(public code: string, public retryable: boolean, public retryAfter = 60) { super(code); }
}
export class MockProvider implements SocialSearchProvider {
  async search({ query, cursor, now = new Date() }: SearchInput) {
    validateQuery(query);
    if (query.includes("[error]")) throw new ProviderError("MOCK_PROVIDER_ERROR", true);
    if (query.includes("[rate-limit]")) throw new ProviderError("MOCK_RATE_LIMIT", true, 120);
    if (query.includes("[empty]")) return { posts: [], cursor: cursor || undefined };
    const bucket = Math.floor(+now / 60000), hash = createHash("sha256").update(query).digest("hex").slice(0, 8);
    const topic = query.match(/"([^"]+)"/)?.[1] || query.split(" ")[0];
    const posts = [0, 1, 2].map((i): SocialPost => ({
      externalId: `mock-${hash}-${bucket - i}`, platform: "x", authorId: `mock-author-${i}`,
      username: ["maya_builds", "samships", "dev_lee"][i], displayName: ["Maya Chen", "Sam Rivera", "Lee Park"][i],
      text: [`Looking for a better way to handle ${topic}. What would you recommend for a small SaaS?`, `Our ${topic} bill just doubled. Anyone found an alternative that actually works?`, `What do you use for ${topic}? Would love to hear from people shipping this week.`][i],
      url: "https://x.com/search?q=" + encodeURIComponent(query), createdAt: new Date((bucket - i) * 60000 - 15000),
      metrics: { likes: [31,8,2][i], replies: [3,12,1][i], reposts: [5,1,0][i], quotes: 0 },
      author: { followers: [4200,730,220][i], verified: false },
    }));
    return { posts, cursor: String(bucket) };
  }
}
export function normalizeX(p: any, users: any[]): SocialPost {
  const a = users.find((a) => a.id === p.author_id) || {};
  return { externalId:p.id, platform:"x", authorId:p.author_id, username:a.username||"unknown", displayName:a.name, text:p.text, url:`https://x.com/i/status/${p.id}`, createdAt:new Date(p.created_at), metrics:{likes:p.public_metrics?.like_count||0,replies:p.public_metrics?.reply_count||0,reposts:p.public_metrics?.retweet_count||0,quotes:p.public_metrics?.quote_count||0}, author:{followers:a.public_metrics?.followers_count||0,verified:a.verified||false} };
}
export class XProvider implements SocialSearchProvider {
  async search({query,cursor}: SearchInput) {
    validateQuery(query); if (!process.env.X_BEARER_TOKEN) throw new ProviderError("X_CREDENTIALS_MISSING",false);
    let token:string|undefined, newest=cursor||undefined; const posts:SocialPost[]=[];
    for(let page=0;page<10;page++){
      const u=new URL("https://api.x.com/2/tweets/search/recent"); u.searchParams.set("query",query); u.searchParams.set("max_results","100"); u.searchParams.set("tweet.fields","created_at,author_id,public_metrics"); u.searchParams.set("expansions","author_id"); u.searchParams.set("user.fields","username,name,public_metrics,verified"); if(cursor)u.searchParams.set("since_id",cursor); if(token)u.searchParams.set("next_token",token);
      const res=await fetch(u,{headers:{Authorization:`Bearer ${process.env.X_BEARER_TOKEN}`},signal:AbortSignal.timeout(20000)});
      if(!res.ok) throw new ProviderError(res.status===429?"X_RATE_LIMIT":res.status===401||res.status===403?"X_AUTH_REJECTED":res.status===400?"X_QUERY_INVALID":"X_UNAVAILABLE",res.status===429||res.status>=500,Math.max(60,Number(res.headers.get("x-rate-limit-reset")||0)-Math.floor(Date.now()/1000)));
      const body=await res.json(); if(body.errors?.length)throw new ProviderError("X_PARTIAL_RESPONSE",true); posts.push(...(body.data||[]).map((p:any)=>normalizeX(p,body.includes?.users||[]))); if(page===0)newest=body.meta?.newest_id||newest; token=body.meta?.next_token; if(!token)return{posts,cursor:newest};
    }
    throw new ProviderError("X_QUERY_TOO_BROAD",false);
  }
}
export function provider(name:string):SocialSearchProvider { if(name==="x")return new XProvider(); if(name==="mock")return new MockProvider(); throw new ProviderError("UNKNOWN_PROVIDER",false); }
