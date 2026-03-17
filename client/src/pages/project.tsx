import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowLeft, Download, Search, Target, TrendingUp, FileText, Palette,
  CheckCircle2, Loader2, Globe, AlertTriangle, Star, MapPin, Tag,
  HelpCircle, Link2, Code, Clock, Zap, BarChart3, ChevronDown, ChevronRight,
  Copy, Check, Filter, Sparkles, Shield, Eye, ExternalLink, BookOpen, Users,
  Plus, Trash2, GripVertical, ListChecks, Settings2
} from "lucide-react";


type Project = {
  id: number; businessUrl: string; themeUrl: string | null; businessName: string | null;
  industry: string | null; location: string | null; status: string;
  siteAnalysis: any; competitors: any; keywords: any; themeStructure: any; sopContent: any;
  createdAt: string;
};

const pipelineSteps = [
  { key: "analyzing_site", label: "Analyzing Site", icon: Search, color: "from-[#159394] to-[#13e4e6]" },
  { key: "analyzing_competitors", label: "Competitors", icon: Target, color: "from-[#6600FF] to-[#C41BD1]" },
  { key: "generating_keywords", label: "Keywords", icon: TrendingUp, color: "from-[#159394] to-[#13e4e6]" },
  { key: "analyzing_theme", label: "Theme", icon: Palette, color: "from-[#6600FF] to-[#C41BD1]" },
  { key: "selecting_pages", label: "Select Pages", icon: ListChecks, color: "from-[#159394] to-[#13e4e6]" },
  { key: "generating_sop", label: "SOP", icon: FileText, color: "from-[#159394] to-[#C41BD1]" },
  { key: "complete", label: "Done", icon: CheckCircle2, color: "from-[#10b981] to-[#059669]" },
];

function getProgress(status: string): number {
  const idx = pipelineSteps.findIndex(s => s.key === status);
  if (status === "complete") return 100;
  if (idx === -1) return 0;
  return Math.round(((idx + 0.5) / (pipelineSteps.length - 1)) * 100);
}

// Copy to clipboard helper
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="text-muted-foreground hover:text-primary transition-colors p-1 rounded" onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">{copied ? "Copied" : "Copy"}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Collapsible card
function CollapsibleCard({ title, icon: Icon, defaultOpen = true, count, color, children }: { title: string; icon: any; defaultOpen?: boolean; count?: number; color?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors cursor-pointer">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-lg ${color || "bg-primary/10"} flex items-center justify-center`}>
                <Icon className={`h-3.5 w-3.5 ${color ? "text-white" : "text-primary"}`} />
              </div>
              <span className="text-sm font-semibold">{title}</span>
              {count !== undefined && <Badge variant="secondary" className="text-[10px] px-1.5">{count}</Badge>}
            </div>
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// KPI stat card
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-card-border">
      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center shadow-sm`}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div>
        <p className="text-lg font-bold leading-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// Priority badge
function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  };
  return <Badge variant="outline" className={`text-[10px] font-semibold px-1.5 ${colors[priority] || ""}`}>{priority}</Badge>;
}

function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    transactional: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    informational: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    navigational: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
  };
  return <Badge variant="outline" className={`text-[10px] border-0 ${colors[intent] || ""}`}>{intent}</Badge>;
}

// ========== TABS ==========

function OverviewTab({ project, analysis, comp, kw, onAddServicePage, addedServices }: { project: Project; analysis: any; comp: any; kw: any; onAddServicePage?: (service: string) => void; addedServices?: Set<string> }) {
  if (!analysis) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary mr-2" /><span className="text-sm text-muted-foreground">Analyzing site...</span></div>;
  const canAddServices = project.status === "selecting_pages" && onAddServicePage;
  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Services" value={analysis.services?.length || 0} icon={Zap} color="from-[#159394] to-[#13e4e6]" />
        <StatCard label="Competitors" value={comp?.competitors?.length || 0} icon={Target} color="from-[#6600FF] to-[#C41BD1]" />
        <StatCard label="Keywords" value={kw?.primaryKeywords?.length || 0} icon={TrendingUp} color="from-[#159394] to-[#13e4e6]" />
        <StatCard label="Content Gaps" value={analysis.contentGaps?.length || 0} icon={BookOpen} color="from-[#6600FF] to-[#C41BD1]" />
      </div>

      {/* Business Info */}
      <CollapsibleCard title="Business Profile" icon={Globe} color="bg-gradient-to-br from-[#159394] to-[#13e4e6]">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 text-sm">
            {[
              ["Business", analysis.businessName], ["Industry", analysis.industry],
              ["Location", analysis.location], ["Service Area", analysis.serviceArea],
            ].map(([k, v]) => v && (
              <div key={k} className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs w-20 flex-shrink-0 pt-0.5">{k}</span>
                <span className="font-medium text-xs">{v}</span>
              </div>
            ))}
          </div>
          {analysis.services?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Services ({analysis.services.length})</p>
                {canAddServices && <span className="text-[10px] text-primary font-medium">Click to add as page</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">{analysis.services.map((s: string, i: number) => {
                const isAdded = addedServices?.has(s.toLowerCase());
                return canAddServices ? (
                  <button
                    key={i}
                    onClick={() => !isAdded && onAddServicePage(s)}
                    disabled={isAdded}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                      isAdded
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 cursor-default"
                        : "bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-sm cursor-pointer"
                    }`}
                    data-testid={`button-add-service-${i}`}
                  >
                    {isAdded ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {s}
                  </button>
                ) : (
                  <Badge key={i} variant="secondary" className="text-[11px]">{s}</Badge>
                );
              })}</div>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {/* Current SEO */}
      <CollapsibleCard title="Current SEO Status" icon={BarChart3} color="bg-gradient-to-br from-[#159394] to-[#13e4e6]">
        {analysis.currentMeta && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex items-center justify-between"><p className="text-[10px] font-semibold text-muted-foreground uppercase">Title Tag</p><CopyBtn text={analysis.currentMeta.title || ""} /></div>
                <p className="text-xs font-medium">{analysis.currentMeta.title || <span className="text-destructive">Not set</span>}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex items-center justify-between"><p className="text-[10px] font-semibold text-muted-foreground uppercase">Meta Description</p><CopyBtn text={analysis.currentMeta.description || ""} /></div>
                <p className="text-xs">{analysis.currentMeta.description || <span className="text-destructive">Not set</span>}</p>
              </div>
            </div>
            <div className="flex gap-3 text-xs">
              <div className="flex items-center gap-1.5">{analysis.currentMeta.hasSchema ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}<span>Schema Markup</span></div>
              <div className="flex items-center gap-1.5">{analysis.currentMeta.hasOpenGraph ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}<span>Open Graph</span></div>
            </div>
          </div>
        )}
      </CollapsibleCard>

      {/* Strengths & Weaknesses */}
      <div className="grid gap-4 sm:grid-cols-2">
        <CollapsibleCard title="SEO Strengths" icon={CheckCircle2} count={analysis.strengths?.length} color="bg-gradient-to-br from-[#159394] to-[#13e4e6]">
          <ul className="space-y-1.5">{analysis.strengths?.map((s: string, i: number) => (
            <li key={i} className="flex items-start gap-2 text-xs"><CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 flex-shrink-0" /><span>{s}</span></li>
          ))}</ul>
        </CollapsibleCard>
        <CollapsibleCard title="SEO Weaknesses" icon={AlertTriangle} count={analysis.weaknesses?.length} color="bg-gradient-to-br from-[#C41BD1] to-[#6600FF]">
          <ul className="space-y-1.5">{analysis.weaknesses?.map((w: string, i: number) => (
            <li key={i} className="flex items-start gap-2 text-xs"><AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" /><span>{w}</span></li>
          ))}</ul>
        </CollapsibleCard>
      </div>

      {/* Content Gaps */}
      <CollapsibleCard title="Content Gaps & Opportunities" icon={BookOpen} count={analysis.contentGaps?.length} color="bg-gradient-to-br from-[#6600FF] to-[#C41BD1]">
        <ul className="space-y-1.5">{analysis.contentGaps?.map((g: string, i: number) => (
          <li key={i} className="flex items-start gap-2 text-xs"><Sparkles className="h-3 w-3 text-[#C41BD1] mt-0.5 flex-shrink-0" /><span>{g}</span></li>
        ))}</ul>
      </CollapsibleCard>
    </div>
  );
}

function CompetitorsTab({ data }: { data: any }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  if (!data?.competitors) return <div className="py-12 text-center text-sm text-muted-foreground">Competitor data not yet available.</div>;
  return (
    <div className="space-y-4">
      {/* Industry Insights Summary */}
      {data.industryInsights && (
        <Card className="bg-gradient-to-br from-primary/5 via-transparent to-transparent">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2"><Zap className="h-4 w-4 text-primary" /><span className="text-sm font-bold">Industry Insights</span></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.industryInsights.topRankingFactors?.length > 0 && (
                <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Top Ranking Factors</p>
                  <ul className="space-y-1">{data.industryInsights.topRankingFactors.map((f: string, i: number) => <li key={i} className="text-xs flex items-start gap-1.5"><TrendingUp className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />{f}</li>)}</ul>
                </div>
              )}
              {data.industryInsights.localSEOTactics?.length > 0 && (
                <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Local SEO Tactics</p>
                  <ul className="space-y-1">{data.industryInsights.localSEOTactics.map((t: string, i: number) => <li key={i} className="text-xs flex items-start gap-1.5"><MapPin className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />{t}</li>)}</ul>
                </div>
              )}
            </div>
            {data.industryInsights.contentGapOpportunities?.length > 0 && (
              <div><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Content Gap Opportunities</p>
                <div className="flex flex-wrap gap-1">{data.industryInsights.contentGapOpportunities.map((o: string, i: number) => <Badge key={i} variant="outline" className="text-[10px] border-primary/30 text-primary">{o}</Badge>)}</div>
              </div>
            )}
            {data.competitiveAdvantage && (
              <div className="pt-2 border-t border-border"><p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Competitive Advantage Strategy</p><p className="text-xs leading-relaxed text-muted-foreground">{data.competitiveAdvantage}</p></div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Competitor Cards */}
      <div className="space-y-2">
        {data.competitors.map((c: any, i: number) => {
          const isOpen = expandedIdx === i;
          const rankColors: Record<string, string> = { high: "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400", medium: "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400", low: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400" };
          return (
            <Card key={i} className={`transition-all ${isOpen ? "ring-1 ring-primary/20" : ""}`}>
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/30 transition-colors" onClick={() => setExpandedIdx(isOpen ? null : i)}>
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6600FF]/10 to-[#C41BD1]/10 flex items-center justify-center text-sm font-bold text-[#C41BD1]">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.contentStrategy?.slice(0, 80)}...</p>
                </div>
                <Badge variant="outline" className={`text-[10px] font-semibold ${rankColors[c.estimatedRanking] || ""}`}>{c.estimatedRanking}</Badge>
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
              {isOpen && (
                <CardContent className="pt-0 pb-4 animate-in slide-in-from-top-1 duration-150">
                  <div className="border-t border-border pt-3 space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.contentStrategy}</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div><p className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Strengths</p><ul className="space-y-1">{c.strengths?.map((s: string, j: number) => <li key={j} className="text-xs flex items-start gap-1.5"><Star className="h-3 w-3 text-amber-500 flex-shrink-0 mt-0.5" />{s}</li>)}</ul></div>
                      <div><p className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Key Pages</p><ul className="space-y-1">{c.keyPages?.map((p: string, j: number) => <li key={j} className="text-xs flex items-start gap-1.5"><FileText className="h-3 w-3 text-[#13e4e6] flex-shrink-0 mt-0.5" />{p}</li>)}</ul></div>
                      <div><p className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Keywords</p><div className="flex flex-wrap gap-1">{c.estimatedKeywords?.map((k: string, j: number) => <Badge key={j} variant="secondary" className="text-[10px]">{k}</Badge>)}</div></div>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function KeywordsTab({ data }: { data: any }) {
  const [filter, setFilter] = useState("");
  const [activeTab, setActiveTab] = useState("primary");
  if (!data?.primaryKeywords) return <div className="py-12 text-center text-sm text-muted-foreground">Keywords not yet available.</div>;

  const filterKw = (arr: any[], field: string) => filter ? arr.filter((k: any) => (k[field] || "").toLowerCase().includes(filter.toLowerCase())) : arr;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Primary" value={data.primaryKeywords?.length || 0} icon={Target} color="from-[#159394] to-[#13e4e6]" />
        <StatCard label="Long-Tail" value={data.longTailKeywords?.length || 0} icon={TrendingUp} color="from-[#6600FF] to-[#C41BD1]" />
        <StatCard label="Local" value={data.localKeywords?.length || 0} icon={MapPin} color="from-[#159394] to-[#13e4e6]" />
        <StatCard label="Questions" value={data.questionKeywords?.length || 0} icon={HelpCircle} color="from-[#6600FF] to-[#C41BD1]" />
        <StatCard label="LSI" value={data.semanticKeywords?.length || 0} icon={Link2} color="from-[#159394] to-[#C41BD1]" />
      </div>

      {/* Search filter */}
      <div className="relative">
        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input placeholder="Filter keywords..." className="pl-9 h-9 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="input-keyword-filter" />
      </div>

      {/* Keyword sub-tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="primary" className="text-xs">Primary</TabsTrigger>
          <TabsTrigger value="longtail" className="text-xs">Long-Tail</TabsTrigger>
          <TabsTrigger value="local" className="text-xs">Local</TabsTrigger>
          <TabsTrigger value="questions" className="text-xs">Questions</TabsTrigger>
          <TabsTrigger value="mapping" className="text-xs">Mapping</TabsTrigger>
        </TabsList>
        <TabsContent value="primary" className="space-y-1 mt-3">
          {filterKw(data.primaryKeywords || [], "keyword").map((k: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 p-2.5 rounded-lg hover:bg-muted/50 transition-colors group">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs font-medium">{k.keyword}</span>
                <CopyBtn text={k.keyword} />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <IntentBadge intent={k.searchIntent} />
                <PriorityBadge priority={k.priority} />
                <Badge variant="outline" className="text-[10px]">{k.difficulty}</Badge>
                <span className="text-[10px] text-muted-foreground w-14 text-right">{k.monthlySearchEstimate || "?"}/mo</span>
              </div>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="longtail" className="space-y-1 mt-3">
          {filterKw(data.longTailKeywords || [], "keyword").map((k: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 p-2.5 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 min-w-0"><span className="text-xs">{k.keyword}</span><CopyBtn text={k.keyword} /></div>
              <div className="flex items-center gap-1.5"><IntentBadge intent={k.searchIntent} /><Badge variant="secondary" className="text-[10px]">{k.targetPage}</Badge></div>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="local" className="mt-3">
          <div className="flex flex-wrap gap-1.5">{filterKw(data.localKeywords || [], "keyword").map((k: any, i: number) => (
            <Badge key={i} variant="outline" className="text-xs gap-1 py-1 px-2"><MapPin className="h-3 w-3 text-primary" />{k.keyword}<span className="text-muted-foreground">({k.type})</span></Badge>
          ))}</div>
        </TabsContent>
        <TabsContent value="questions" className="space-y-1.5 mt-3">
          {filterKw(data.questionKeywords || [], "question").map((k: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/30">
              <div className="flex items-center gap-2 min-w-0"><HelpCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" /><span className="text-xs">{k.question}</span><CopyBtn text={k.question} /></div>
              <Badge variant="outline" className="text-[10px] flex-shrink-0">{k.suggestedContentType}</Badge>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="mapping" className="space-y-3 mt-3">
          {data.keywordMapping && Object.entries(data.keywordMapping).map(([page, kws]: [string, any]) => (
            <div key={page} className="p-3 rounded-lg bg-muted/30 space-y-1.5">
              <p className="text-xs font-bold text-primary">{page}</p>
              <div className="flex flex-wrap gap-1">{Array.isArray(kws) && kws.map((k: string, i: number) => <Badge key={i} variant="secondary" className="text-[10px]">{k}</Badge>)}</div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {/* LSI Keywords */}
      {data.semanticKeywords?.length > 0 && (
        <CollapsibleCard title="Semantic / LSI Keywords" icon={Link2} count={data.semanticKeywords.length} defaultOpen={false}>
          <div className="flex flex-wrap gap-1">{data.semanticKeywords.map((k: string, i: number) => <Badge key={i} variant="outline" className="text-[10px]">{k}</Badge>)}</div>
        </CollapsibleCard>
      )}
    </div>
  );
}

// ========== PAGE SELECTION PANEL ==========
type PageSelection = {
  pageName: string;
  purpose: string;
  sections: Array<{ sectionName: string; type: string; description: string; hasImage?: boolean; hasForm?: boolean; hasCTA?: boolean; ctaText?: string; formFields?: string; imageDescription?: string; contentElements?: string[] }>;
  url?: string;
  selected: boolean;
  isCustom?: boolean;
};

function PageSelectionPanel({ project, externalPages, onPagesChange }: { project: Project; externalPages?: PageSelection[]; onPagesChange?: (pages: PageSelection[]) => void }) {
  const theme = project.themeStructure;
  const themePages: any[] = theme?.pages || [];

  // Initialize selection state from theme pages
  const [pages, setPages] = useState<PageSelection[]>(() => {
    const initial = themePages.map((p: any) => ({
      pageName: p.pageName || "Unnamed Page",
      purpose: p.purpose || "",
      sections: (p.sections || []).map((s: any) => ({
        sectionName: s.sectionName || "Section",
        type: s.type || "content",
        description: s.description || "",
        hasImage: s.hasImage,
        hasForm: s.hasForm,
        hasCTA: s.hasCTA,
        ctaText: s.ctaText,
        formFields: s.formFields,
        imageDescription: s.imageDescription,
        contentElements: s.contentElements,
      })),
      url: p.url,
      selected: true,
      isCustom: false,
    }));
    // If no theme pages, add some defaults
    if (initial.length === 0) {
      return [
        { pageName: "Homepage", purpose: "Main landing page", sections: [{ sectionName: "Hero", type: "hero", description: "Main hero banner" }, { sectionName: "Services", type: "features", description: "Services overview" }, { sectionName: "About Preview", type: "content", description: "About teaser" }, { sectionName: "Testimonials", type: "testimonials", description: "Reviews" }, { sectionName: "CTA", type: "cta", description: "Call to action" }], selected: true, isCustom: false },
        { pageName: "About", purpose: "About the business", sections: [{ sectionName: "Story", type: "content", description: "Company story" }, { sectionName: "Team", type: "team", description: "Team members" }], selected: true, isCustom: false },
        { pageName: "Services", purpose: "Detailed services", sections: [{ sectionName: "Overview", type: "content", description: "Intro" }, { sectionName: "Service Cards", type: "features", description: "Individual services" }], selected: true, isCustom: false },
        { pageName: "Contact", purpose: "Contact information", sections: [{ sectionName: "Form", type: "form", description: "Contact form" }, { sectionName: "Map", type: "map", description: "Location" }], selected: true, isCustom: false },
      ];
    }
    return initial;
  });

  const [addingPage, setAddingPage] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [newPagePurpose, setNewPagePurpose] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [addingSection, setAddingSection] = useState<number | null>(null);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionType, setNewSectionType] = useState("content");

  // Sync external pages (e.g. services added from Overview tab) into local state
  const prevExternalCountRef = useRef(0);
  useEffect(() => {
    if (externalPages && externalPages.length > prevExternalCountRef.current) {
      const newPages = externalPages.slice(prevExternalCountRef.current);
      setPages(prev => {
        const existing = prev.map(p => p.pageName.toLowerCase());
        const toAdd = newPages.filter(np => !existing.includes(np.pageName.toLowerCase()));
        if (toAdd.length > 0) return [...prev, ...toAdd];
        return prev;
      });
      prevExternalCountRef.current = externalPages.length;
    }
  }, [externalPages]);

  // Notify parent of current pages for tracking
  const prevPagesRef = useRef(pages);
  useEffect(() => {
    if (onPagesChange && prevPagesRef.current !== pages) {
      prevPagesRef.current = pages;
      onPagesChange(pages);
    }
  }, [pages, onPagesChange]);

  const generateSOP = useMutation({
    mutationFn: async (selectedPages: any[]) => {
      const res = await apiRequest("POST", `/api/projects/${project.id}/generate-sop`, { selectedPages });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });
    },
    onError: (err: Error) => {
      console.error("SOP generation failed:", err);
      window.alert(`SOP generation failed: ${err.message}`);
    },
  });

  const [downloadingAudit, setDownloadingAudit] = useState(false);
  const selectedCount = pages.filter(p => p.selected).length;
  const totalSections = pages.filter(p => p.selected).reduce((s, p) => s + p.sections.length, 0);

  const handleDownloadAudit = async () => {
    setDownloadingAudit(true);
    try {
      const API = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      window.open(`${API}/api/projects/${project.id}/audit-pdf`, "_blank");
    } finally {
      setTimeout(() => setDownloadingAudit(false), 2000);
    }
  };

  const handleTogglePage = (idx: number) => {
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, selected: !p.selected } : p));
  };

  const handleToggleAll = (selectAll: boolean) => {
    setPages(prev => prev.map(p => ({ ...p, selected: selectAll })));
  };

  const handleAddPage = () => {
    if (!newPageName.trim()) return;
    setPages(prev => [...prev, {
      pageName: newPageName.trim(),
      purpose: newPagePurpose.trim() || `Custom ${newPageName.trim()} page`,
      sections: [{ sectionName: "Hero", type: "hero", description: "Main section" }, { sectionName: "Content", type: "content", description: "Page content" }],
      selected: true,
      isCustom: true,
    }]);
    setNewPageName("");
    setNewPagePurpose("");
    setAddingPage(false);
  };

  const handleRemovePage = (idx: number) => {
    setPages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddSection = (pageIdx: number) => {
    if (!newSectionName.trim()) return;
    setPages(prev => prev.map((p, i) => i === pageIdx ? {
      ...p,
      sections: [...p.sections, { sectionName: newSectionName.trim(), type: newSectionType, description: `${newSectionName.trim()} section` }]
    } : p));
    setNewSectionName("");
    setNewSectionType("content");
    setAddingSection(null);
  };

  const handleRemoveSection = (pageIdx: number, secIdx: number) => {
    setPages(prev => prev.map((p, i) => i === pageIdx ? {
      ...p,
      sections: p.sections.filter((_, j) => j !== secIdx)
    } : p));
  };

  const handleGenerate = () => {
    const selected = pages.filter(p => p.selected).map(p => ({
      pageName: p.pageName,
      purpose: p.purpose,
      url: p.url || "",
      sections: p.sections,
    }));
    generateSOP.mutate(selected);
  };

  const sectionTypes = ["hero", "content", "features", "testimonials", "stats", "faq", "form", "cta", "team", "map", "gallery", "blog", "pricing", "process", "banner", "sidebar"];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="bg-gradient-to-r from-[#159394]/10 via-[#159394]/5 to-transparent border-[#159394]/20">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#159394] to-[#13e4e6] flex items-center justify-center shadow-lg shadow-[#159394]/20">
                <ListChecks className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold">Select Pages for SOP</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Review the pages discovered from the theme. Select, add, or remove pages and sections before generating the full SOP content.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <div className="flex items-center gap-4 text-xs">
              <span className="font-semibold">{selectedCount} <span className="text-muted-foreground font-normal">pages selected</span></span>
              <span className="font-semibold">{totalSections} <span className="text-muted-foreground font-normal">total sections</span></span>
            </div>
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="text-xs" onClick={() => handleToggleAll(true)} data-testid="button-select-all">
              <CheckCircle2 className="h-3 w-3 mr-1" />Select All
            </Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => handleToggleAll(false)} data-testid="button-deselect-all">
              Deselect All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audit PDF Download */}
      <Card className="bg-gradient-to-r from-[#ef4444]/5 via-[#f59e0b]/5 to-[#10b981]/5 border-[#159394]/30 overflow-hidden">
        <CardContent className="p-0">
          <div className="h-1 bg-gradient-to-r from-[#ef4444] via-[#f59e0b] to-[#10b981]" />
          <div className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#159394]/20 to-[#13e4e6]/10 flex items-center justify-center border border-[#159394]/30 flex-shrink-0">
              <BarChart3 className="h-6 w-6 text-[#13e4e6]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold flex items-center gap-2">SEO Audit Report
                <Badge variant="outline" className="text-[9px] px-1.5 border-[#13e4e6]/40 text-[#13e4e6]">PDF</Badge>
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Download a detailed audit showing what's working, what needs fixing, keyword opportunities, competitor analysis, and technical SEO checklist with visual score cards.</p>
            </div>
            <Button
              onClick={handleDownloadAudit}
              disabled={downloadingAudit}
              variant="outline"
              className="font-semibold flex-shrink-0 border-[#159394]/40 hover:bg-[#159394]/10 hover:border-[#159394] text-[#13e4e6]"
              data-testid="button-download-audit"
            >
              {downloadingAudit ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating...</>
              ) : (
                <><Download className="h-4 w-4 mr-2" />Download Audit</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Page list */}
      <div className="space-y-2">
        {pages.map((page, idx) => {
          const isExpanded = expandedIdx === idx;
          return (
            <Card key={idx} className={`overflow-hidden transition-all ${page.selected ? "ring-1 ring-primary/20" : "opacity-60"} ${isExpanded ? "ring-2 ring-[#159394]/30" : ""}`}>
              {/* Page header row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <Checkbox
                  checked={page.selected}
                  onCheckedChange={() => handleTogglePage(idx)}
                  data-testid={`checkbox-page-${idx}`}
                  className="flex-shrink-0"
                />
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    page.selected
                      ? "bg-gradient-to-br from-[#159394]/10 to-[#13e4e6]/10 text-[#13e4e6]"
                      : "bg-muted text-muted-foreground"
                  }`}>{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{page.pageName}</p>
                      {page.isCustom && <Badge variant="secondary" className="text-[9px] px-1.5">Custom</Badge>}
                      <Badge variant="outline" className="text-[10px] px-1.5">{page.sections.length} sections</Badge>
                    </div>
                    {page.purpose && <p className="text-[11px] text-muted-foreground truncate">{page.purpose}</p>}
                  </div>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                </div>
                {page.isCustom && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleRemovePage(idx)} data-testid={`button-remove-page-${idx}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Expanded sections */}
              {isExpanded && (
                <CardContent className="pt-0 pb-4 animate-in slide-in-from-top-1 duration-150">
                  <div className="border-t border-border pt-3 space-y-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Sections</p>
                    {page.sections.map((section, secIdx) => (
                      <div key={secIdx} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 group">
                        <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-[9px] font-bold text-primary">{secIdx + 1}</span>
                        </div>
                        <Badge variant="outline" className="text-[9px] flex-shrink-0 font-mono">{section.type}</Badge>
                        <span className="text-xs font-medium flex-1 min-w-0 truncate">{section.sectionName}</span>
                        {section.description && <span className="text-[10px] text-muted-foreground truncate hidden sm:block max-w-[200px]">{section.description}</span>}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {section.hasImage && <Eye className="h-3 w-3 text-muted-foreground" />}
                          {section.hasForm && <Settings2 className="h-3 w-3 text-muted-foreground" />}
                          {section.hasCTA && <Zap className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all" onClick={() => handleRemoveSection(idx, secIdx)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}

                    {/* Add section inline */}
                    {addingSection === idx ? (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-primary/30 bg-primary/5">
                        <Input
                          placeholder="Section name"
                          value={newSectionName}
                          onChange={(e) => setNewSectionName(e.target.value)}
                          className="h-7 text-xs flex-1"
                          autoFocus
                          onKeyDown={(e) => e.key === "Enter" && handleAddSection(idx)}
                        />
                        <select
                          value={newSectionType}
                          onChange={(e) => setNewSectionType(e.target.value)}
                          className="h-7 text-xs rounded-md border border-input bg-background px-2"
                        >
                          {sectionTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Button size="sm" className="h-7 text-xs px-2" onClick={() => handleAddSection(idx)}>
                          <Plus className="h-3 w-3 mr-1" />Add
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setAddingSection(null); setNewSectionName(""); }}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        className="flex items-center gap-2 w-full p-2 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-xs text-muted-foreground hover:text-primary"
                        onClick={() => setAddingSection(idx)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add section
                      </button>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Add custom page */}
      {addingPage ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <p className="text-xs font-semibold">Add Custom Page</p>
            <div className="flex gap-2">
              <Input
                placeholder="Page name (e.g. FAQ, Careers, Blog)"
                value={newPageName}
                onChange={(e) => setNewPageName(e.target.value)}
                className="text-sm"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleAddPage()}
              />
              <Input
                placeholder="Purpose (optional)"
                value={newPagePurpose}
                onChange={(e) => setNewPagePurpose(e.target.value)}
                className="text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleAddPage()}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="text-xs" onClick={handleAddPage} disabled={!newPageName.trim()}>
                <Plus className="h-3 w-3 mr-1" />Add Page
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setAddingPage(false); setNewPageName(""); setNewPagePurpose(""); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <button
          className="flex items-center justify-center gap-2 w-full p-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-sm text-muted-foreground hover:text-primary font-medium"
          onClick={() => setAddingPage(true)}
          data-testid="button-add-page"
        >
          <Plus className="h-4 w-4" /> Add Custom Page
        </button>
      )}

      {/* Stripe Paywall */}
      <Card className="bg-gradient-to-r from-[#6600FF]/10 via-[#C41BD1]/5 to-transparent border-[#6600FF]/20">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6600FF] to-[#C41BD1] flex items-center justify-center shadow-lg shadow-[#6600FF]/20">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold">Unlock Full SEO Blueprint</h3>
              <p className="text-xs text-muted-foreground">One-time payment — no subscription required</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-2xl font-extrabold gradient-text">$37</p>
              <p className="text-[10px] text-muted-foreground">per report</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {["Full PDF SOP", "SEO meta tags", "Schema markup", "Content for every section", "Developer notes", "Implementation timeline"].map((f) => (
              <span key={f} className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-[#13e4e6]" />{f}</span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Generate button */}
      <Card className="bg-gradient-to-r from-[#159394]/10 via-[#159394]/5 to-transparent border-[#159394]/20">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold">Ready to generate?</p>
            <p className="text-xs text-muted-foreground">{selectedCount} pages with {totalSections} sections will be generated with full SEO content, meta tags, schema markup, and developer notes.</p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={selectedCount === 0 || generateSOP.isPending}
            className="shadow-lg shadow-[#159394]/20 font-semibold px-6 flex-shrink-0 bg-[#159394] hover:bg-[#13e4e6] text-white"
            size="lg"
            data-testid="button-generate-sop"
          >
            {generateSOP.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Starting...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />Generate SOP</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeTab({ data }: { data: any }) {
  if (!data?.pages) return <div className="py-12 text-center text-sm text-muted-foreground">No theme URL was provided, or analysis is pending.</div>;
  return (
    <div className="space-y-3">
      {data.pages.map((pg: any, i: number) => (
        <CollapsibleCard key={i} title={pg.pageName} icon={Globe} defaultOpen={i === 0}>
          {pg.url && <p className="text-xs text-muted-foreground mb-2">{pg.url}</p>}
          {pg.purpose && <p className="text-xs mb-2">{pg.purpose}</p>}
          {pg.sections?.length > 0 && (
            <div className="space-y-1.5">{pg.sections.map((s: any, j: number) => (
              <div key={j} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 text-xs">
                <Badge variant="outline" className="text-[10px] flex-shrink-0">{s.type || "content"}</Badge>
                <span className="font-medium">{s.sectionName}</span>
                <span className="text-muted-foreground truncate">— {s.description}</span>
                {s.hasImage && <Eye className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
              </div>
            ))}</div>
          )}
        </CollapsibleCard>
      ))}
      {data.globalElements && (
        <CollapsibleCard title="Global Elements" icon={Code} defaultOpen={false}>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            {Object.entries(data.globalElements).map(([k, v]: [string, any]) => (
              <div key={k}><span className="font-semibold text-primary capitalize">{k}:</span> <span className="text-muted-foreground">{v}</span></div>
            ))}
          </div>
        </CollapsibleCard>
      )}
    </div>
  );
}

function SOPTab({ data, projectId }: { data: any; projectId: number }) {
  const [expandedPage, setExpandedPage] = useState<number | null>(0);
  if (!data) return <div className="py-12 text-center text-sm text-muted-foreground">SOP not yet generated.</div>;

  const handleDownloadPDF = () => {
    const API = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
    window.open(`${API}/api/projects/${projectId}/pdf`, "_blank");
  };

  return (
    <div className="space-y-4">
      {/* Download banner */}
      <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/20">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><FileText className="h-5 w-5 text-primary" /><div><p className="text-sm font-bold">Full SOP Ready</p><p className="text-[11px] text-muted-foreground">{data.pages?.length || 0} pages with complete SEO content</p></div></div>
          <Button onClick={handleDownloadPDF} className="shadow-lg shadow-primary/20 font-semibold" data-testid="button-download-pdf"><Download className="h-4 w-4 mr-1.5" />Download PDF</Button>
        </CardContent>
      </Card>

      {/* Implementation Timeline */}
      {data.summary?.implementationPriority?.length > 0 && (
        <CollapsibleCard title="Implementation Timeline" icon={Clock} color="bg-gradient-to-br from-[#159394] to-[#13e4e6]">
          <div className="space-y-3">{data.summary.implementationPriority.map((phase: any, i: number) => (
            <div key={i} className="relative pl-4 border-l-2 border-primary/30">
              <div className="absolute -left-[5px] top-0.5 w-2 h-2 rounded-full bg-primary" />
              <div className="flex items-center gap-2 mb-1"><p className="text-xs font-bold">{phase.phase}</p><Badge variant="outline" className="text-[10px]">{phase.timeline}</Badge></div>
              <ul className="space-y-0.5">{phase.tasks?.map((t: string, j: number) => <li key={j} className="text-xs text-muted-foreground flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />{t}</li>)}</ul>
            </div>
          ))}</div>
        </CollapsibleCard>
      )}

      {/* Page-by-page SOP */}
      {data.pages?.map((pg: any, i: number) => {
        const isOpen = expandedPage === i;
        return (
          <Card key={i} className={`overflow-hidden transition-all ${isOpen ? "ring-1 ring-primary/20" : ""}`}>
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/30 transition-colors" onClick={() => setExpandedPage(isOpen ? null : i)}>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#159394]/10 to-[#13e4e6]/10 flex items-center justify-center text-sm font-bold text-[#13e4e6]">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{pg.pageName || `Page ${i + 1}`}</p>
                {pg.seo?.titleTag && <p className="text-[11px] text-muted-foreground truncate">{pg.seo.titleTag}</p>}
              </div>
              {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
            {isOpen && (
              <CardContent className="pt-0 pb-4 animate-in slide-in-from-top-1 duration-150 space-y-4">
                <div className="border-t border-border pt-3" />
                {/* SEO Meta */}
                {pg.seo && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["Title Tag", pg.seo.titleTag], ["Meta Description", pg.seo.metaDescription],
                      ["H1", pg.seo.h1], ["OG Title", pg.seo.ogTitle],
                    ].map(([label, val]) => val && (
                      <div key={label} className="p-2.5 rounded-lg bg-muted/40 space-y-0.5">
                        <div className="flex items-center justify-between"><p className="text-[10px] font-bold text-muted-foreground uppercase">{label}</p><CopyBtn text={val} /></div>
                        <p className="text-xs font-medium">{val}</p>
                      </div>
                    ))}
                  </div>
                )}
                {/* Schema */}
                {pg.schema && (
                  <div className="p-2.5 rounded-lg bg-muted/40"><p className="text-[10px] font-bold text-primary uppercase mb-1">Schema: {pg.schema.type}</p>
                    <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap max-h-24 overflow-y-auto">{typeof pg.schema.markup === "string" ? pg.schema.markup.slice(0, 400) : JSON.stringify(pg.schema.markup, null, 2)?.slice(0, 400)}</pre>
                  </div>
                )}
                {/* Sections */}
                {pg.sections?.map((section: any, j: number) => (
                  <div key={j} className="border-l-2 border-primary/20 pl-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold">{section.sectionName}</p>
                      {section.sectionType && <Badge variant="outline" className="text-[9px] px-1.5">{section.sectionType}</Badge>}
                    </div>
                    {section.heading && <div className="flex items-center gap-1.5"><p className="text-xs text-primary font-semibold">H2: {section.heading}</p><CopyBtn text={section.heading} /></div>}
                    {section.subheading && <p className="text-xs text-muted-foreground">H3: {section.subheading}</p>}
                    {section.content && <div className="text-xs text-muted-foreground leading-relaxed bg-muted/30 p-2.5 rounded-lg">{section.content}</div>}
                    {section.bulletPoints?.length > 0 && <ul className="space-y-0.5 pl-1">{section.bulletPoints.map((bp: string, k: number) => <li key={k} className="text-xs text-muted-foreground flex items-start gap-1.5">• {bp}</li>)}</ul>}
                    {/* Card Items (services, features, icon grids) */}
                    {section.cardItems?.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {section.cardItems.map((card: any, k: number) => (
                          <div key={k} className="p-2.5 rounded-lg bg-accent/40 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              {card.icon && <Badge variant="secondary" className="text-[9px]">{card.icon}</Badge>}
                              <p className="text-xs font-semibold">{card.title}</p>
                            </div>
                            <p className="text-[11px] text-muted-foreground">{card.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Testimonials */}
                    {section.testimonials?.length > 0 && (
                      <div className="space-y-2">
                        {section.testimonials.map((t: any, k: number) => (
                          <div key={k} className="p-2.5 rounded-lg bg-accent/30 border border-border/50">
                            <p className="text-xs italic text-muted-foreground">"{t.quote}"</p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <p className="text-[11px] font-semibold">{t.author}</p>
                              {t.role && <p className="text-[10px] text-muted-foreground">{t.role}</p>}
                              {t.rating && <span className="text-[10px] text-amber-500">{"★".repeat(t.rating)}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Stats / Counters */}
                    {section.stats?.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {section.stats.map((s: any, k: number) => (
                          <div key={k} className="p-2 rounded-lg bg-primary/5 text-center min-w-[80px]">
                            <p className="text-sm font-bold text-primary">{s.number}</p>
                            <p className="text-[10px] text-muted-foreground">{s.label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* FAQ Items */}
                    {section.faqItems?.length > 0 && (
                      <div className="space-y-1.5">
                        {section.faqItems.map((faq: any, k: number) => (
                          <div key={k} className="p-2 rounded-lg bg-muted/30">
                            <div className="flex items-start gap-1.5"><HelpCircle className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" /><p className="text-xs font-semibold">{faq.question}</p></div>
                            <p className="text-[11px] text-muted-foreground mt-1 pl-4">{faq.answer}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Form Config */}
                    {section.formConfig && (
                      <div className="p-2.5 rounded-lg bg-accent/30 space-y-1.5">
                        <p className="text-xs font-semibold">{section.formConfig.heading || "Contact Form"}</p>
                        <div className="flex flex-wrap gap-1">{(section.formConfig.fields || []).map((f: string, k: number) => <Badge key={k} variant="secondary" className="text-[10px]">{f}</Badge>)}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-[10px]">{section.formConfig.submitText || "Submit"}</Badge>
                          {section.formConfig.privacyNote && <p className="text-[10px] text-muted-foreground">{section.formConfig.privacyNote}</p>}
                        </div>
                      </div>
                    )}
                    {/* CTA */}
                    {section.cta && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5">
                        <span className="text-primary font-medium text-xs">CTA:</span>
                        <Badge variant="default" className="text-[10px]">{section.cta.text}</Badge>
                        <span className="text-[10px] text-muted-foreground">→ {section.cta.action}</span>
                        {section.cta.subtext && <span className="text-[10px] text-muted-foreground italic">({section.cta.subtext})</span>}
                      </div>
                    )}
                    {/* Images */}
                    {section.images?.map((img: any, k: number) => (
                      <div key={k} className="text-xs p-2 rounded bg-accent/50 space-y-0.5">
                        <div className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-primary" /><p className="font-medium">Image: {img.description}</p></div>
                        <div className="flex items-center gap-1.5"><p className="text-muted-foreground">Alt: "{img.altText}"</p><CopyBtn text={img.altText || ""} /></div>
                        {img.dimensions && <p className="text-[10px] text-muted-foreground">Size: {img.dimensions}</p>}
                      </div>
                    ))}
                  </div>
                ))}
                {/* Internal Links */}
                {pg.internalLinks?.length > 0 && (
                  <div><p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Internal Links</p>
                    <div className="space-y-1">{pg.internalLinks.map((link: any, j: number) => (
                      <div key={j} className="text-xs flex items-center gap-1.5"><Link2 className="h-3 w-3 text-primary" />"{link.anchorText}" → {link.targetPage}</div>
                    ))}</div>
                  </div>
                )}
                {/* Dev Notes */}
                {pg.devNotes?.technicalSEO?.length > 0 && (
                  <div><p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Dev Notes</p>
                    <ul className="space-y-0.5">{pg.devNotes.technicalSEO.map((n: string, j: number) => <li key={j} className="text-xs flex items-start gap-1.5"><Code className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />{n}</li>)}</ul>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ========== MAIN PAGE ==========
export default function ProjectPage() {
  const [, params] = useRoute("/project/:id");
  const [, navigate] = useLocation();
  const projectId = parseInt(params?.id || "0");
  const isActive = (s: string) => !["complete", "error", "pending", "selecting_pages"].includes(s);

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    refetchInterval: (query) => {
      const d = query.state.data as Project | undefined;
      return d && isActive(d.status) ? 2000 : false;
    },
  });

  // State for service-to-page feature
  const [servicePagesToAdd, setServicePagesToAdd] = useState<PageSelection[]>([]);
  const [addedServiceNames, setAddedServiceNames] = useState<Set<string>>(new Set());

  const handleAddServicePage = useCallback((serviceName: string) => {
    const key = serviceName.toLowerCase();
    if (addedServiceNames.has(key)) return;
    const newPage: PageSelection = {
      pageName: serviceName,
      purpose: `Dedicated service page for ${serviceName}`,
      sections: [
        { sectionName: "Hero", type: "hero", description: `${serviceName} hero banner with headline and CTA` },
        { sectionName: "Overview", type: "content", description: `Detailed description of ${serviceName}` },
        { sectionName: "Benefits", type: "features", description: `Key benefits of ${serviceName}` },
        { sectionName: "FAQ", type: "faq", description: `Common questions about ${serviceName}` },
        { sectionName: "CTA", type: "cta", description: "Call to action for consultation or quote" },
      ],
      selected: true,
      isCustom: true,
    };
    setServicePagesToAdd(prev => [...prev, newPage]);
    setAddedServiceNames(prev => new Set(prev).add(key));
  }, [addedServiceNames]);

  const handlePagesChange = useCallback((pages: PageSelection[]) => {
    // Keep addedServiceNames in sync if user removes a service page from PageSelectionPanel
    const currentPageNames = new Set(pages.map(p => p.pageName.toLowerCase()));
    setAddedServiceNames(prev => {
      const updated = new Set<string>();
      prev.forEach(name => { if (currentPageNames.has(name)) updated.add(name); });
      if (updated.size !== prev.size) return updated;
      return prev;
    });
  }, []);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!project) return <div className="min-h-screen flex flex-col items-center justify-center gap-3"><p className="text-muted-foreground">Project not found</p><Button variant="outline" onClick={() => navigate("/")}>Go Back</Button></div>;

  const progress = getProgress(project.status);

  return (
    <div className="min-h-screen" style={{ background: '#050913' }}>
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold truncate" data-testid="text-project-name">{project.businessName || project.businessUrl}</h1>
            <p className="text-[11px] text-muted-foreground truncate">{project.industry || ""} {project.location ? `· ${project.location}` : ""}</p>
          </div>
          {["selecting_pages", "generating_sop", "complete"].includes(project.status) && (
            <Button size="sm" variant="outline" className="font-semibold border-[#159394]/40 text-[#13e4e6] hover:bg-[#159394]/10" data-testid="button-download-audit-header" onClick={() => { const API = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__"; window.open(`${API}/api/projects/${project.id}/audit-pdf`, "_blank"); }}>
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />Audit
            </Button>
          )}
          {project.status === "complete" && (
            <Button size="sm" className="font-semibold shadow-lg shadow-primary/20" data-testid="button-download-pdf-header" onClick={() => { const API = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__"; window.open(`${API}/api/projects/${project.id}/pdf`, "_blank"); }}>
              <Download className="h-3.5 w-3.5 mr-1.5" />PDF
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        {/* Progress bar for in-progress */}
        {isActive(project.status) && (
          <Card className="overflow-hidden">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /><span className="text-sm font-semibold">{pipelineSteps.find(s => s.key === project.status)?.label || "Processing..."}</span></div>
                <span className="text-xs font-bold text-primary">{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
              <div className="flex gap-1">{pipelineSteps.slice(0, -1).map((step, i) => {
                const stepIdx = pipelineSteps.findIndex(s => s.key === project.status);
                const isDone = i < stepIdx; const isCurrent = i === stepIdx;
                return <div key={step.key} className={`flex-1 h-1 rounded-full transition-all ${isDone ? "bg-primary" : isCurrent ? "bg-primary/50 animate-pulse" : "bg-muted"}`} />;
              })}</div>
              <p className="text-[11px] text-muted-foreground">AI is researching competitors, discovering keywords, and writing optimized content. This takes 2-5 minutes.</p>
            </CardContent>
          </Card>
        )}

        {project.status === "error" && (
          <Card className="border-destructive/50"><CardContent className="p-4 flex items-center gap-3"><AlertTriangle className="h-5 w-5 text-destructive" /><div><p className="text-sm font-semibold">Analysis Error</p><p className="text-xs text-muted-foreground">Something went wrong. Please try again.</p></div><Button variant="outline" size="sm" className="ml-auto" onClick={() => navigate("/")}>Start Over</Button></CardContent></Card>
        )}

        {/* Page Selection Step */}
        {project.status === "selecting_pages" && (
          <PageSelectionPanel project={project} externalPages={servicePagesToAdd} onPagesChange={handlePagesChange} />
        )}

        {/* Main tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-5 h-10">
            <TabsTrigger value="overview" className="text-xs gap-1.5 font-semibold" data-testid="tab-overview"><Search className="h-3.5 w-3.5" /><span className="hidden sm:inline">Overview</span></TabsTrigger>
            <TabsTrigger value="competitors" className="text-xs gap-1.5 font-semibold" data-testid="tab-competitors"><Users className="h-3.5 w-3.5" /><span className="hidden sm:inline">Competitors</span></TabsTrigger>
            <TabsTrigger value="keywords" className="text-xs gap-1.5 font-semibold" data-testid="tab-keywords"><TrendingUp className="h-3.5 w-3.5" /><span className="hidden sm:inline">Keywords</span></TabsTrigger>
            <TabsTrigger value="theme" className="text-xs gap-1.5 font-semibold" data-testid="tab-theme"><Palette className="h-3.5 w-3.5" /><span className="hidden sm:inline">Theme</span></TabsTrigger>
            <TabsTrigger value="sop" className="text-xs gap-1.5 font-semibold" data-testid="tab-sop"><FileText className="h-3.5 w-3.5" /><span className="hidden sm:inline">SOP</span></TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0"><OverviewTab project={project} analysis={project.siteAnalysis} comp={project.competitors} kw={project.keywords} onAddServicePage={handleAddServicePage} addedServices={addedServiceNames} /></TabsContent>
          <TabsContent value="competitors" className="mt-0"><CompetitorsTab data={project.competitors} /></TabsContent>
          <TabsContent value="keywords" className="mt-0"><KeywordsTab data={project.keywords} /></TabsContent>
          <TabsContent value="theme" className="mt-0"><ThemeTab data={project.themeStructure} /></TabsContent>
          <TabsContent value="sop" className="mt-0"><SOPTab data={project.sopContent} projectId={project.id} /></TabsContent>
        </Tabs>
      </main>
      <footer className="border-t border-[#2A2E36] mt-8 py-4"><div className="max-w-5xl mx-auto px-4 flex items-center justify-center"><p className="text-[11px] text-[#74727B]">RANKITECT by SCALZ.AI</p></div></footer>
    </div>
  );
}
