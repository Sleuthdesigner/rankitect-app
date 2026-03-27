import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Globe, FileText, Target, TrendingUp, ArrowRight, Loader2,
  Clock, CheckCircle2, AlertCircle, Palette, Sparkles, Zap, ChevronRight,
  Eye, Scan, BookOpen, Shield,
} from "lucide-react";


type Project = {
  id: number; businessUrl: string; themeUrl: string | null; businessName: string | null;
  industry: string | null; location: string | null; status: string; createdAt: string;
};

const statusConfig: Record<string, { label: string; variant: string; icon: any; animate?: boolean }> = {
  pending: { label: "Pending", variant: "secondary", icon: Clock },
  analyzing: { label: "Starting...", variant: "default", icon: Loader2, animate: true },
  analyzing_site: { label: "Analyzing Site", variant: "default", icon: Search, animate: true },
  analyzing_competitors: { label: "Researching Competitors", variant: "default", icon: Target, animate: true },
  generating_keywords: { label: "Generating Keywords", variant: "default", icon: TrendingUp, animate: true },
  analyzing_theme: { label: "Analyzing Theme", variant: "default", icon: Palette, animate: true },
  selecting_pages: { label: "Select Pages", variant: "default", icon: FileText },
  generating_sop: { label: "Writing SOP Content", variant: "default", icon: FileText, animate: true },
  complete: { label: "Complete", variant: "outline", icon: CheckCircle2 },
  error: { label: "Error", variant: "destructive", icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const c = statusConfig[status] || statusConfig.pending;
  const Icon = c.icon;
  return (
    <Badge variant={c.variant as any} className={`gap-1.5 text-[11px] ${status === "complete" ? "border-emerald-500 text-emerald-400" : ""}`}>
      <Icon className={`h-3 w-3 ${c.animate ? "animate-spin" : ""}`} />
      {c.label}
    </Badge>
  );
}

function RankitectLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tealGrad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#13e4e6" />
          <stop offset="1" stopColor="#159394" />
        </linearGradient>
        <linearGradient id="pupilGrad" x1="16" y1="16" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C41BD1" />
          <stop offset="1" stopColor="#6600FF" />
        </linearGradient>
      </defs>
      <ellipse cx="20" cy="20" rx="18" ry="12" stroke="url(#tealGrad)" strokeWidth="2.5" fill="none" />
      <circle cx="20" cy="20" r="7" fill="url(#tealGrad)" opacity="0.2" />
      <circle cx="20" cy="20" r="5" fill="url(#pupilGrad)" />
      <circle cx="22" cy="18" r="1.5" fill="white" opacity="0.8" />
    </svg>
  );
}

const steps = [
  { icon: Scan, label: "Scan", desc: "Crawl & audit site", color: "from-[#159394] to-[#13e4e6]" },
  { icon: Search, label: "Analyze", desc: "Deep SEO analysis", color: "from-[#159394] to-[#13e4e6]" },
  { icon: Target, label: "Research", desc: "Competitor intel", color: "from-[#6600FF] to-[#C41BD1]" },
  { icon: BookOpen, label: "Blueprint", desc: "Strategy plan", color: "from-[#6600FF] to-[#C41BD1]" },
  { icon: FileText, label: "Generate", desc: "Full PDF SOP", color: "from-[#159394] to-[#C41BD1]" },
];

export default function HomePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [businessUrl, setBusinessUrl] = useState("");
  const [themeUrl, setThemeUrl] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"], refetchInterval: 5000 });

  const createProject = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", "/api/projects", data); return res.json(); },
    onSuccess: (project: Project) => { queryClient.invalidateQueries({ queryKey: ["/api/projects"] }); navigate(`/project/${project.id}`); },
    onError: (err: any) => { toast({ title: "Error", description: err.message || "Failed to start", variant: "destructive" }); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessUrl.trim()) { toast({ title: "URL required", description: "Enter the business website URL.", variant: "destructive" }); return; }
    createProject.mutate({ businessUrl: businessUrl.trim(), themeUrl: themeUrl.trim() || "", businessName: businessName.trim() || undefined, industry: industry.trim() || undefined, location: location.trim() || undefined });
  };

  return (
    <div className="min-h-screen" style={{ background: '#050913' }}>
      {/* Header */}
      <div className="relative overflow-hidden border-b border-[#2A2E36]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#159394]/10 via-transparent to-[#6600FF]/5" />
        <div className="relative max-w-4xl mx-auto px-4 pt-10 pb-8">
          <div className="flex items-center gap-3 mb-6">
            <RankitectLogo />
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#FDFDFD]" data-testid="text-app-title">RANKITECT</h1>
              <p className="text-xs text-[#74727B] font-medium">by SCALZ.AI</p>
            </div>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight max-w-lg gradient-text" data-testid="text-hero-heading">
            X-Ray Vision for Your SEO
          </h2>
          <p className="text-sm text-[#74727B] mt-3 max-w-xl leading-relaxed">
            AI-powered competitive analysis, keyword research, and production-ready content plans. Generate a complete SEO blueprint in minutes.
          </p>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Pipeline visualization */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center flex-shrink-0">
              <div className="group relative flex items-center gap-2 px-3 py-2 rounded-lg card-glass hover:border-[#159394]/40 transition-all cursor-default">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${step.color} flex items-center justify-center shadow-sm`}>
                  <step.icon className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight text-[#FDFDFD]">{step.label}</p>
                  <p className="text-[10px] text-[#74727B] leading-tight">{step.desc}</p>
                </div>
              </div>
              {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-[#74727B]/40 mx-0.5 flex-shrink-0" />}
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="card-glass overflow-hidden">
          <div className="bg-gradient-to-r from-[#159394]/10 to-transparent px-5 py-3 border-b border-[#2A2E36]">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#13e4e6]" />
              <span className="text-sm font-semibold text-[#FDFDFD]">New Analysis</span>
            </div>
          </div>
          <div className="p-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="businessUrl" className="text-sm font-medium text-[#FDFDFD]">Business Website URL <span className="text-red-500">*</span></Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#74727B]" />
                  <Input id="businessUrl" data-testid="input-business-url" type="url" placeholder="https://example-business.com" className="pl-10 bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={businessUrl} onChange={(e) => setBusinessUrl(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="themeUrl" className="text-sm font-medium text-[#FDFDFD]">Theme / Reference URL</Label>
                <div className="relative">
                  <Palette className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#74727B]" />
                  <Input id="themeUrl" data-testid="input-theme-url" type="url" placeholder="https://theme-example.com" className="pl-10 bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={themeUrl} onChange={(e) => setThemeUrl(e.target.value)} />
                </div>
                <p className="text-[11px] text-[#74727B]">Provide a theme or competitor site to model the new structure after</p>
              </div>
              <button type="button" className="text-xs text-[#13e4e6] font-medium hover:underline" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? "Hide" : "Show"} optional details
              </button>
              {showAdvanced && (
                <div className="grid gap-3 sm:grid-cols-3 animate-in slide-in-from-top-2 duration-200">
                  <div className="space-y-1"><Label className="text-xs text-[#FDFDFD]">Business Name</Label><Input data-testid="input-business-name" placeholder="Acme Plumbing Co." className="bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={businessName} onChange={(e) => setBusinessName(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs text-[#FDFDFD]">Industry</Label><Input data-testid="input-industry" placeholder="Plumbing contractor" className="bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={industry} onChange={(e) => setIndustry(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs text-[#FDFDFD]">Location</Label><Input data-testid="input-location" placeholder="Austin, TX" className="bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
                </div>
              )}
              <Button type="submit" data-testid="button-start-analysis" disabled={createProject.isPending} size="lg" className="w-full font-semibold bg-[#159394] hover:bg-[#13e4e6] text-white glow-teal transition-all">
                {createProject.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Starting...</> : <><Eye className="h-4 w-4 mr-2" />Start SEO Analysis<ArrowRight className="h-4 w-4 ml-2" /></>}
              </Button>
            </form>
          </div>
        </div>

        {/* Free Audit CTA */}
        <div className="card-glass overflow-hidden border-[#159394]/20 hover:border-[#159394]/40 transition-all cursor-pointer" onClick={() => navigate("/free-audit")}>
          <div className="flex items-center gap-4 p-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#159394]/20 to-[#6600FF]/10 flex items-center justify-center flex-shrink-0">
              <Shield className="h-6 w-6 text-[#13e4e6]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#FDFDFD]">Free SEO Audit</h3>
                <Badge className="bg-[#159394]/20 text-[#13e4e6] border-[#159394]/30 text-[9px] font-semibold uppercase">Free</Badge>
              </div>
              <p className="text-[11px] text-[#74727B] mt-0.5">Get an instant website health check with strengths, weaknesses, and quick wins. No credit card needed.</p>
            </div>
            <ArrowRight className="h-5 w-5 text-[#74727B] group-hover:text-[#13e4e6] flex-shrink-0" />
          </div>
        </div>

        {/* Previous Projects */}
        {projects.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-[#74727B] uppercase tracking-wider">Recent Projects</h3>
            <div className="space-y-2">
              {projects.map((project) => (
                <div key={project.id} data-testid={`card-project-${project.id}`}
                  className="group flex items-center gap-4 p-3 rounded-xl card-glass hover:border-[#159394]/40 transition-all cursor-pointer"
                  onClick={() => navigate(`/project/${project.id}`)}>
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#159394]/20 to-[#159394]/5 flex items-center justify-center flex-shrink-0">
                    <Globe className="h-4 w-4 text-[#13e4e6]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate text-[#FDFDFD]">{project.businessName || project.businessUrl}</p>
                      <StatusBadge status={project.status} />
                    </div>
                    <p className="text-[11px] text-[#74727B] truncate">{project.businessUrl}{project.industry && ` · ${project.industry}`}{project.location && ` · ${project.location}`}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[#74727B] group-hover:text-[#13e4e6] transition-colors flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      <footer className="border-t border-[#2A2E36] mt-12 py-4"><div className="max-w-4xl mx-auto px-4 flex items-center justify-center"><p className="text-[11px] text-[#74727B]">RANKITECT by SCALZ.AI</p></div></footer>
    </div>
  );
}
