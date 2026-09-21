export interface Article {
  schemaVersion: 'sxj.seo90.article.v1';
  contentId: string; seriesId: string; dayNumber: number; storeId: string;
  title: string; slug: string; summary: string; directAnswer: string;
  sections: {heading: string; body: string}[];
  faq: {question: string; answer: string}[];
  clusterId: string; serviceId: string; serviceAssertions: string[];
  plannedPublishAt: string; canonicalPath: string; author: string;
  sourceRefs: {type: string; ref: string}[]; assetRefs: string[];
  ctaId: string; state: 'draft'|'preview'|'approved'|'publish_ready'|'published'|'withdrawn';
  video?: {sha256: string; fullDecode: string; visual: string; semantic: string; audio: string; owner: string};
}
export interface Asset {
  assetId: string; contentId: string; path: string; sha256: string;
  width: number; height: number; mime: 'image/png'; provider: string;
  alt: string; caption: string; review: string;
}
export interface Registry {
  storeId: string; brand: string; baseUrl: string; profileApproved: boolean;
  cta: {id: string; path: string; label: string};
  services: Record<string, {confirmed: boolean; path: string; assertions: string[]}>;
  clusters: Record<string, {label: string; path: string}>;
}
export interface Approval {
  contentId: string; channel: 'website'; decision: 'approved';
  articleSha256: string; registrySha256: string; assetSha256s: string[]; assetManifestSha256: string;
  approvedBy: string; approvedAt: string;
}
export interface Release {
  contentId: string; canonicalPath: string; articleSha256: string;
  registrySha256: string; datePublished: string; dateModified: string;
  state: 'published'|'withdrawn';
}
export interface Bundle {
  articles: Article[]; assets: Asset[]; approvals: Approval[];
  registry: Registry; releases: Release[];
}
