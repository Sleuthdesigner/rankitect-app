import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Loader2, ArrowRight, ArrowLeft, Download, CheckCircle2,
  AlertTriangle, XCircle, Zap, Shield, TrendingUp, User, Mail,
  Sparkles, ChevronRight, Eye,
} from "lucide-react";

type AuditResult = {
  businessName?: string;
  industry?: string;
  overallScore: number;
  strengths?: string[];
  weaknesses?: string[];
  quickWins?: string[];
  summary?: string;
};

function RankitectLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tealGrad2" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#13e4e6" />
          <stop offset="1" stopColor="#159394" />
        </linearGradient>
        <linearGradient id="pupilGrad2" x1="16" y1="16" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C41BD1" />
          <stop offset="1" stopColor="#6600FF" />
        </linearGradient>
      </defs>
      <ellipse cx="20" cy="20" rx="18" ry="12" stroke="url(#tealGrad2)" strokeWidth="2.5" fill="none" />
      <circle cx="20" cy="20" r="7" fill="url(#tealGrad2)" opacity="0.2" />
      <circle cx="20" cy="20" r="5" fill="url(#pupilGrad2)" />
      <circle cx="22" cy="18" r="1.5" fill="white" opacity="0.8" />
    </svg>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 75 ? "Good" : score >= 50 ? "Needs Work" : "Critical";
  const Icon = score >= 75 ? CheckCircle2 : score >= 50 ? AlertTriangle : XCircle;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-32 h-32 flex items-center justify-center">
        <svg className="absolute inset-0" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r="56" fill="none" stroke="#2A2E36" strokeWidth="8" />
          <circle cx="64" cy="64" r="56" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${(score / 100) * 352} 352`} strokeLinecap="round"
            transform="rotate(-90 64 64)" className="transition-all duration-1000" />
        </svg>
        <span className="text-4xl font-extrabold" style={{ color }}>{score}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4" style={{ color }} />
        <span className="text-sm font-semibold" style={{ color }}>{label}</span>
      </div>
    </div>
  );
}

export default function FreeAuditPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<"form" | "analyzing" | "results">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");
  const [audit, setAudit] = useState<AuditResult | null>(null);

  const runAudit = useMutation({
    mutationFn: async (data: { name: string; email: string; url: string }) => {
      const res = await apiRequest("POST", "/api/free-audit", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      setAudit(data.audit);
      setStep("results");
    },
    onError: (err: any) => {
      toast({ title: "Analysis Failed", description: err.message || "Please try again.", variant: "destructive" });
      setStep("form");
    },
  });

  const downloadPdf = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/free-audit/pdf", { audit, name, url });
      return res.blob();
    },
    onSuccess: (blob: Blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Free-SEO-Audit-${(audit?.businessName || "Report").replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    onError: () => {
      toast({ title: "Download Failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !url.trim()) {
      toast({ title: "All fields required", description: "Enter your name, email, and website URL.", variant: "destructive" });
      return;
    }
    setStep("analyzing");
    runAudit.mutate({ name: name.trim(), email: email.trim(), url: url.trim() });
  };

  return (
    <div className="min-h-screen" style={{ background: "#050913" }}>
      {/* Header */}
      <div className="relative overflow-hidden border-b border-[#2A2E36]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#159394]/10 via-transparent to-[#6600FF]/5" />
        <div className="relative max-w-3xl mx-auto px-4 pt-8 pb-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/")}>
              <RankitectLogo />
              <div>
                <h1 className="text-xl font-extrabold tracking-tight text-[#FDFDFD]">RANKITECT</h1>
                <p className="text-xs text-[#74727B] font-medium">by SCALZ.AI</p>
              </div>
            </div>
            <Button variant="ghost" className="text-[#74727B] hover:text-[#FDFDFD] text-xs gap-1" onClick={() => navigate("/")}>
              <ArrowLeft className="h-3 w-3" /> Back
            </Button>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Badge className="bg-[#159394]/20 text-[#13e4e6] border-[#159394]/30 text-[10px] font-semibold uppercase">Free</Badge>
            <Badge className="bg-[#6600FF]/20 text-[#C41BD1] border-[#6600FF]/30 text-[10px] font-semibold uppercase">Instant</Badge>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight max-w-lg gradient-text">
            Free Website SEO Audit
          </h2>
          <p className="text-sm text-[#74727B] mt-2 max-w-xl leading-relaxed">
            Get an instant AI-powered SEO health check. Enter your website and we'll analyze strengths, weaknesses, and quick wins — delivered as a professional PDF report.
          </p>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* STEP 1: Form */}
        {step === "form" && (
          <div className="card-glass overflow-hidden">
            <div className="bg-gradient-to-r from-[#159394]/10 to-transparent px-5 py-3 border-b border-[#2A2E36]">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-[#13e4e6]" />
                <span className="text-sm font-semibold text-[#FDFDFD]">Start Your Free Audit</span>
              </div>
            </div>
            <div className="p-5">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-name" className="text-sm font-medium text-[#FDFDFD]">Your Name <span className="text-red-500">*</span></Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#74727B]" />
                      <Input id="audit-name" data-testid="input-audit-name" placeholder="John Smith" className="pl-10 bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-email" className="text-sm font-medium text-[#FDFDFD]">Email Address <span className="text-red-500">*</span></Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#74727B]" />
                      <Input id="audit-email" data-testid="input-audit-email" type="email" placeholder="john@company.com" className="pl-10 bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="audit-url" className="text-sm font-medium text-[#FDFDFD]">Website URL <span className="text-red-500">*</span></Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#74727B]" />
                    <Input id="audit-url" data-testid="input-audit-url" type="url" placeholder="https://your-website.com" className="pl-10 bg-[#0D1117] border-[#2A2E36] text-white placeholder:text-[#74727B]" value={url} onChange={(e) => setUrl(e.target.value)} required />
                  </div>
                </div>
                <Button type="submit" data-testid="button-run-audit" size="lg" className="w-full font-semibold bg-[#159394] hover:bg-[#13e4e6] text-white glow-teal transition-all">
                  <Eye className="h-4 w-4 mr-2" />Run Free SEO Audit<ArrowRight className="h-4 w-4 ml-2" />
                </Button>
                <p className="text-[10px] text-[#74727B] text-center">No credit card required. Results delivered instantly.</p>
              </form>
            </div>
          </div>
        )}

        {/* STEP 2: Analyzing */}
        {step === "analyzing" && (
          <div className="card-glass p-8 flex flex-col items-center gap-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#159394]/20 to-[#6600FF]/10 flex items-center justify-center">
                <Loader2 className="h-10 w-10 text-[#13e4e6] animate-spin" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#159394] flex items-center justify-center">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-[#FDFDFD]">Analyzing {url}...</h3>
              <p className="text-sm text-[#74727B]">Our AI is crawling your site, checking meta tags, content structure, and SEO signals.</p>
            </div>
            <div className="w-full max-w-xs space-y-2">
              {["Fetching page content", "Analyzing SEO signals", "Generating recommendations"].map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-[#74727B]">
                  <div className="w-4 h-4 rounded-full border border-[#2A2E36] flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-[#13e4e6] animate-pulse" />
                  </div>
                  {s}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 3: Results */}
        {step === "results" && audit && (
          <div className="space-y-5">
            {/* Score Card */}
            <div className="card-glass p-6">
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <ScoreGauge score={audit.overallScore} />
                <div className="flex-1 text-center sm:text-left">
                  <h3 className="text-xl font-extrabold text-[#FDFDFD]">{audit.businessName || "Your Website"}</h3>
                  {audit.industry && <p className="text-sm text-[#74727B] mt-0.5">{audit.industry}</p>}
                  {audit.summary && <p className="text-sm text-[#74727B] mt-2 leading-relaxed">{audit.summary}</p>}
                </div>
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Strengths", val: audit.strengths?.length || 0, color: "#22c55e", icon: CheckCircle2 },
                { label: "Issues", val: audit.weaknesses?.length || 0, color: "#ef4444", icon: XCircle },
                { label: "Quick Wins", val: audit.quickWins?.length || 0, color: "#13e4e6", icon: Zap },
              ].map((s, i) => (
                <div key={i} className="card-glass p-3 text-center">
                  <s.icon className="h-5 w-5 mx-auto mb-1" style={{ color: s.color }} />
                  <p className="text-2xl font-extrabold" style={{ color: s.color }}>{s.val}</p>
                  <p className="text-[10px] text-[#74727B] uppercase font-semibold">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Strengths */}
            {audit.strengths && audit.strengths.length > 0 && (
              <div className="card-glass overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#2A2E36] flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-[#FDFDFD]">What's Working</span>
                </div>
                <div className="p-4 space-y-2">
                  {audit.strengths.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-emerald-400 mt-0.5 flex-shrink-0">&#10003;</span>
                      <span className="text-[#FDFDFD]/80">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weaknesses */}
            {audit.weaknesses && audit.weaknesses.length > 0 && (
              <div className="card-glass overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#2A2E36] flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-semibold text-[#FDFDFD]">Needs Improvement</span>
                </div>
                <div className="p-4 space-y-2">
                  {audit.weaknesses.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-red-400 mt-0.5 flex-shrink-0">&#10007;</span>
                      <span className="text-[#FDFDFD]/80">{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Wins */}
            {audit.quickWins && audit.quickWins.length > 0 && (
              <div className="card-glass overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#2A2E36] flex items-center gap-2">
                  <Zap className="h-4 w-4 text-[#13e4e6]" />
                  <span className="text-sm font-semibold text-[#FDFDFD]">Quick Wins — Do These Today</span>
                </div>
                <div className="p-4 space-y-2">
                  {audit.quickWins.map((q, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-[#13e4e6] font-bold mt-0.5 flex-shrink-0">{i + 1}.</span>
                      <span className="text-[#FDFDFD]/80">{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3">
              <Button
                data-testid="button-download-audit-pdf"
                onClick={() => downloadPdf.mutate()}
                disabled={downloadPdf.isPending}
                size="lg"
                className="w-full font-semibold bg-[#0D1117] border border-[#2A2E36] hover:border-[#159394] text-[#FDFDFD] transition-all"
              >
                {downloadPdf.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating PDF...</> : <><Download className="h-4 w-4 mr-2" />Download Full Audit PDF</>}
              </Button>

              {/* Upsell CTA */}
              <div className="card-glass overflow-hidden border-[#159394]/30">
                <div className="bg-gradient-to-r from-[#159394]/15 to-[#6600FF]/10 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#159394] to-[#6600FF] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <TrendingUp className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-[#FDFDFD]">Want the Full SEO Blueprint?</h4>
                      <p className="text-xs text-[#74727B] mt-1 leading-relaxed">
                        Go beyond the audit. Get a complete SEO Standard Operating Procedure with deep competitor analysis, keyword research, page-by-page content blueprints, and a prioritized action plan.
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {["Competitor Intel", "Keyword Research", "Content Plans", "Technical SEO", "Action Plan"].map((f, i) => (
                          <Badge key={i} className="bg-[#159394]/10 text-[#13e4e6] border-[#159394]/20 text-[9px]">{f}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <Button
                    data-testid="button-get-full-sop"
                    onClick={() => navigate("/")}
                    size="lg"
                    className="w-full mt-4 font-semibold bg-[#159394] hover:bg-[#13e4e6] text-white glow-teal transition-all"
                  >
                    Get Full SOP — Starting at $37 <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[#2A2E36] mt-12 py-4">
        <div className="max-w-3xl mx-auto px-4 flex items-center justify-center">
          <p className="text-[11px] text-[#74727B]">RANKITECT by SCALZ.AI</p>
        </div>
      </footer>
    </div>
  );
}
