import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { startAnalysisSchema } from "@shared/schema";
import OpenAI from "openai";
import * as cheerio from "cheerio";

const openai = new OpenAI(); // Uses OPENAI_API_KEY env var

// Helper: call OpenAI Responses API (Chat Completions not supported by proxy)
async function aiComplete(model: "gpt5_mini" | "gpt_5_1", prompt: string): Promise<string> {
  const response = await openai.responses.create({
    model,
    input: prompt,
  });
  return (response as any).output_text || "";
}

// Robust JSON parser that handles markdown code blocks, triple backticks, etc.
function parseAIJSON(text: string): any {
  // Strip markdown code fences
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  cleaned = cleaned.trim();
  // Try direct parse first
  try { return JSON.parse(cleaned); } catch { }
  // Handle truncated JSON — walk to find last complete structure
  // For objects: find the outermost matching braces
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace >= 0) {
    let depth = 0;
    let lastComplete = -1;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) lastComplete = i; }
    }
    if (lastComplete > 0) {
      try { return JSON.parse(cleaned.slice(firstBrace, lastComplete + 1)); } catch { }
    }
    // Still truncated — try to close open structures
    const lastBrace = cleaned.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      let attempt = cleaned.slice(firstBrace, lastBrace + 1);
      for (let extra = 0; extra < 10; extra++) {
        try { return JSON.parse(attempt); } catch { }
        const openBraces = (attempt.match(/\{/g) || []).length;
        const closeBraces = (attempt.match(/\}/g) || []).length;
        const openBrackets = (attempt.match(/\[/g) || []).length;
        const closeBrackets = (attempt.match(/\]/g) || []).length;
        if (openBrackets > closeBrackets) attempt += "]";
        else if (openBraces > closeBraces) attempt += "}";
        else break;
      }
      try { return JSON.parse(attempt); } catch { }
    }
  }
  throw new Error("Failed to parse AI JSON response");
}

// Helper: fetch a URL and extract text content
async function fetchPageContent(url: string): Promise<{ title: string; text: string; html: string; meta: Record<string, string> }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOAnalyzer/1.0)" },
    });
    clearTimeout(timeout);
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, iframe").remove();
    const meta: Record<string, string> = {};
    $("meta").each((_, el) => {
      const name = $(el).attr("name") || $(el).attr("property") || "";
      const content = $(el).attr("content") || "";
      if (name && content) meta[name] = content;
    });
    return {
      title: $("title").text().trim() || "",
      text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000),
      html: html.slice(0, 15000),
      meta,
    };
  } catch (e: any) {
    return { title: "", text: `Error fetching: ${e.message}`, html: "", meta: {} };
  }
}

// Helper: extract site structure from HTML
async function extractSiteStructure(url: string): Promise<any> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOAnalyzer/1.0)" },
    });
    clearTimeout(timeout);
    const html = await res.text();
    const $ = cheerio.load(html);
    const navLinks: string[] = [];
    $("nav a, header a, .nav a, .menu a, .navbar a, [role='navigation'] a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (text && href && !href.startsWith("#") && !href.startsWith("javascript")) {
        navLinks.push(`${text} -> ${href}`);
      }
    });
    const sections: string[] = [];
    $("section, [class*='section'], [class*='hero'], [class*='about'], [class*='service'], [class*='contact'], [class*='footer']").each((_, el) => {
      const classes = $(el).attr("class") || "";
      const id = $(el).attr("id") || "";
      const heading = $(el).find("h1, h2, h3").first().text().trim();
      sections.push(`${el.tagName}${id ? `#${id}` : ""}${classes ? `.${classes.split(" ")[0]}` : ""}: ${heading || "(no heading)"}`);
    });
    const allLinks: string[] = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href && !href.startsWith("#") && !href.startsWith("javascript") && !href.startsWith("mailto") && !href.startsWith("tel")) {
        try {
          const resolved = new URL(href, url).href;
          const base = new URL(url);
          if (resolved.includes(base.hostname) && !allLinks.includes(resolved)) {
            allLinks.push(resolved);
          }
        } catch { }
      }
    });
    const uniqueNav = navLinks.filter((v, i, a) => a.indexOf(v) === i);
    const uniqueSections = sections.filter((v, i, a) => a.indexOf(v) === i);
    return {
      navLinks: uniqueNav.slice(0, 30),
      sections: uniqueSections.slice(0, 30),
      internalLinks: allLinks.slice(0, 50),
      fullHtml: html.slice(0, 20000),
    };
  } catch (e: any) {
    return { navLinks: [], sections: [], internalLinks: [], fullHtml: "", error: e.message };
  }
}

// Step 1: Analyze the existing business website
async function analyzeSite(url: string): Promise<any> {
  const page = await fetchPageContent(url);
  const text = await aiComplete("gpt5_mini", `Analyze this local business website for SEO. Extract all useful information.

URL: ${url}
Title: ${page.title}
Meta tags: ${JSON.stringify(page.meta)}
Page content (excerpt): ${page.text.slice(0, 5000)}

Return valid JSON:
{
  "businessName": "extracted business name",
  "industry": "specific industry/niche",
  "location": "city, state if found",
  "serviceArea": "geographic service area if mentioned",
  "services": ["list of services offered"],
  "currentKeywords": ["keywords currently used on the site"],
  "currentMeta": {
    "title": "current title tag",
    "description": "current meta description",
    "hasSchema": true,
    "hasOpenGraph": true
  },
  "strengths": ["what the site does well for SEO"],
  "weaknesses": ["SEO issues and missed opportunities"],
  "contentGaps": ["topics/pages that are missing"],
  "estimatedCompetitorSearchTerms": ["5-10 search terms a customer would use to find this type of business in this area"]
}`);
  try {
    return parseAIJSON(text);
  } catch {
    return { error: "Failed to parse analysis", raw: text };
  }
}

// Step 2: Discover competitors and analyze them
async function discoverCompetitors(analysis: any): Promise<any> {
  const searchTerms = analysis.estimatedCompetitorSearchTerms || [];
  const location = analysis.location || analysis.serviceArea || "";
  const industry = analysis.industry || "";
  const text = await aiComplete("gpt5_mini", `You are an SEO competitor research specialist for local businesses.

Business type: ${industry}
Location: ${location}
Search terms customers would use: ${JSON.stringify(searchTerms)}

Based on your knowledge of local SEO and this industry, generate a realistic competitor analysis.

Return valid JSON:
{
  "competitors": [
    {
      "name": "Competitor business name",
      "estimatedRanking": "high/medium/low",
      "strengths": ["what they likely do well for SEO"],
      "contentStrategy": "description of their content approach",
      "keyPages": ["list of pages they'd have"],
      "estimatedKeywords": ["keywords they'd target"]
    }
  ],
  "industryInsights": {
    "topRankingFactors": ["what matters most for ranking in this industry locally"],
    "commonContentTypes": ["blog posts", "service pages", "FAQ"],
    "localSEOTactics": ["GMB optimization", "local citations"],
    "contentGapOpportunities": ["topics competitors miss that you can cover"]
  },
  "competitiveAdvantage": "how to differentiate and outrank competitors"
}

Generate 4-6 realistic competitors.`);
  try {
    return parseAIJSON(text);
  } catch {
    return { error: "Failed to parse competitors", raw: text };
  }
}

// Step 3: Generate comprehensive keyword strategy
async function generateKeywords(analysis: any, competitors: any): Promise<any> {
  const text = await aiComplete("gpt5_mini", `You are an expert local SEO keyword strategist.

Business: ${analysis.businessName || "Local business"}
Industry: ${analysis.industry}
Location: ${analysis.location || analysis.serviceArea || "Not specified"}
Services: ${JSON.stringify(analysis.services || [])}
Current keywords: ${JSON.stringify(analysis.currentKeywords || [])}
Competitor keywords: ${JSON.stringify((competitors.competitors || []).flatMap((c: any) => c.estimatedKeywords || []))}
Industry insights: ${JSON.stringify(competitors.industryInsights || {})}

Generate a comprehensive keyword strategy. Return valid JSON:
{
  "primaryKeywords": [
    {"keyword": "exact keyword", "searchIntent": "informational/transactional/navigational", "difficulty": "low/medium/high", "priority": "high/medium/low", "monthlySearchEstimate": "range"}
  ],
  "longTailKeywords": [
    {"keyword": "long tail phrase", "searchIntent": "type", "targetPage": "suggested page to target this keyword"}
  ],
  "localKeywords": [
    {"keyword": "keyword with location", "type": "city/neighborhood/service-area"}
  ],
  "questionKeywords": [
    {"question": "question people ask", "suggestedContentType": "FAQ/blog/service page"}
  ],
  "semanticKeywords": ["related LSI keywords to naturally include in content"],
  "keywordMapping": {
    "Homepage": ["primary keywords for homepage"],
    "Service Page 1": ["keywords for this service"]
  },
  "contentCalendarKeywords": [
    {"topic": "blog topic", "targetKeywords": ["keywords"], "contentType": "blog/guide/case study"}
  ]
}

Generate at least 20 primary keywords, 15 long-tail keywords, 10 local keywords, and 10 question keywords.`);
  try {
    return parseAIJSON(text);
  } catch {
    return { error: "Failed to parse keywords", raw: text };
  }
}

// Step 4: Analyze theme structure — crawls sub-pages from navigation
async function analyzeTheme(themeUrl: string): Promise<any> {
  // 1. Crawl the homepage to discover navigation links
  const homeStructure = await extractSiteStructure(themeUrl);
  const homePage = await fetchPageContent(themeUrl);

  // 2. Crawl each internal sub-page from the navigation
  const subPageData: Array<{ url: string; linkText: string; content: string; sections: string[]; html: string }> = [];
  const visited = new Set<string>([themeUrl.replace(/\/$/, "")]);
  const navUrls: Array<{ text: string; url: string }> = [];

  for (const navItem of homeStructure.navLinks || []) {
    const match = navItem.match(/^(.+?)\s*->\s*(.+)$/);
    if (match) {
      const text = match[1].trim();
      let href = match[2].trim();
      try {
        href = new URL(href, themeUrl).href;
      } catch { continue; }
      const normalized = href.replace(/\/$/, "");
      if (!visited.has(normalized) && !href.includes("#") && !href.startsWith("mailto") && !href.startsWith("tel")) {
        visited.add(normalized);
        navUrls.push({ text, url: href });
      }
    }
  }

  // Crawl up to 10 sub-pages in parallel
  const crawlPromises = navUrls.slice(0, 10).map(async ({ text, url }) => {
    try {
      const [pageContent, pageStructure] = await Promise.all([
        fetchPageContent(url),
        extractSiteStructure(url),
      ]);
      return {
        url,
        linkText: text,
        content: pageContent.text.slice(0, 4000),
        sections: (pageStructure.sections || []).slice(0, 20),
        html: (pageStructure.fullHtml || "").slice(0, 8000),
      };
    } catch {
      return { url, linkText: text, content: "", sections: [], html: "" };
    }
  });
  const crawledPages = await Promise.all(crawlPromises);
  subPageData.push(...crawledPages);

  // 3. Send ALL page data to AI for comprehensive theme analysis
  const subPagesContext = subPageData.map((sp, i) =>
    `--- SUB-PAGE ${i + 1}: "${sp.linkText}" (${sp.url}) ---\nSections found: ${JSON.stringify(sp.sections)}\nContent excerpt: ${sp.content.slice(0, 2000)}\nHTML excerpt: ${sp.html.slice(0, 3000)}`
  ).join("\n\n");

  const text = await aiComplete("gpt5_mini", `Analyze this theme website's COMPLETE structure across ALL pages. I've crawled the homepage and every sub-page from the navigation. Extract the exact layout, sections, and content areas for each page so we can recreate this structure with new SEO content.

=== HOMEPAGE ===
URL: ${themeUrl}
Title: ${homePage.title}
Navigation links: ${JSON.stringify(homeStructure.navLinks)}
Sections found: ${JSON.stringify(homeStructure.sections)}
Content excerpt: ${homePage.text.slice(0, 3000)}
HTML excerpt: ${homeStructure.fullHtml?.slice(0, 6000)}

=== SUB-PAGES ===
${subPagesContext}

For EVERY page (homepage + each sub-page), extract the EXACT section layout. Return valid JSON:
{
  "siteName": "name of the theme site",
  "pages": [
    {
      "pageName": "Page name (e.g. Homepage, About, Services, Contact)",
      "url": "URL path",
      "purpose": "what this page accomplishes",
      "sections": [
        {
          "sectionName": "descriptive name for this section",
          "type": "hero/content/cta/testimonials/gallery/form/stats/faq/team/pricing/features/process/map/sidebar/banner",
          "description": "detailed description of what content fills this area",
          "hasImage": true,
          "imageDescription": "if hasImage, describe what kind of image is used",
          "hasForm": false,
          "formFields": "",
          "hasCTA": true,
          "ctaText": "if hasCTA, what the button says",
          "contentElements": ["heading", "paragraph", "bullet-list", "icon-grid", "card-grid", "stat-counter", "accordion", "image-gallery", "video", "map", "social-links"]
        }
      ]
    }
  ],
  "globalElements": {
    "header": "exact header layout description",
    "footer": "exact footer layout",
    "navigation": "nav pattern",
    "cta": "common CTA patterns used across the site",
    "sidebar": "if any pages have sidebars, describe the layout"
  },
  "designPatterns": {
    "layout": "overall layout approach",
    "colorScheme": "primary, secondary, accent colors observed",
    "typography": "heading and body font styles",
    "spacing": "section padding/margin patterns",
    "cardStyle": "if cards are used, describe their style"
  }
}

INCLUDE EVERY PAGE YOU CAN IDENTIFY. Be very detailed about each section's content areas.`);
  try {
    return parseAIJSON(text);
  } catch {
    return { error: "Failed to parse theme", raw: text };
  }
}

// Step 5: Generate the full SOP with SEO content — deeply theme-aware
async function generateSOP(analysis: any, competitors: any, keywords: any, themeStructure: any): Promise<any> {
  const pages = themeStructure?.pages || [
    { pageName: "Homepage", purpose: "Main landing page", sections: [{ sectionName: "Hero", type: "hero", description: "Main hero banner with headline and CTA", contentElements: ["heading", "paragraph", "cta-button", "image"] }, { sectionName: "Services Overview", type: "features", description: "Grid of services offered", contentElements: ["heading", "card-grid", "icon-grid"] }, { sectionName: "About Preview", type: "content", description: "Brief about section", contentElements: ["heading", "paragraph", "image"] }, { sectionName: "Testimonials", type: "testimonials", description: "Customer reviews", contentElements: ["heading", "card-grid"] }, { sectionName: "Call to Action", type: "cta", description: "Bottom CTA banner", contentElements: ["heading", "paragraph", "cta-button"] }] },
    { pageName: "About", purpose: "Company information", sections: [{ sectionName: "Story", type: "content" }, { sectionName: "Team", type: "team" }, { sectionName: "Values", type: "content" }] },
    { pageName: "Services", purpose: "Detailed services listing", sections: [{ sectionName: "Overview", type: "content" }, { sectionName: "Individual Services", type: "features" }] },
    { pageName: "Contact", purpose: "Contact information and form", sections: [{ sectionName: "Contact Form", type: "form" }, { sectionName: "Map", type: "map" }, { sectionName: "Contact Info", type: "content" }] },
  ];

  const topPrimaryKW = (keywords?.primaryKeywords || []).slice(0, 20);
  const localKW = (keywords?.localKeywords || []).slice(0, 15);
  const questionKW = (keywords?.questionKeywords || []).slice(0, 10);
  const longTailKW = (keywords?.longTailKeywords || []).slice(0, 15);
  const allPageNames = pages.map((p: any) => p.pageName);
  const competitorNames = (competitors?.competitors || []).map((c: any) => c.name).join(", ");
  const competitorKeywords = (competitors?.competitors || []).flatMap((c: any) => c.estimatedKeywords || []).slice(0, 30);

  const researchContext = `
=== BUSINESS RESEARCH ===
Business: ${analysis.businessName || "Local Business"}
Industry: ${analysis.industry}
Location: ${analysis.location || ""}
Service Area: ${analysis.serviceArea || analysis.location || ""}
Services: ${JSON.stringify(analysis.services || [])}
Strengths: ${JSON.stringify(analysis.strengths || [])}
Weaknesses to address: ${JSON.stringify(analysis.weaknesses || [])}
Content gaps to fill: ${JSON.stringify(analysis.contentGaps || [])}

=== COMPETITOR INTELLIGENCE ===
Top competitors: ${competitorNames}
Competitor keywords: ${JSON.stringify(competitorKeywords)}
Competitive advantage: ${competitors?.competitiveAdvantage || ""}

=== KEYWORD STRATEGY ===
Primary: ${JSON.stringify(topPrimaryKW.map((k: any) => k.keyword))}
Long-tail: ${JSON.stringify(longTailKW.map((k: any) => k.keyword))}
Local: ${JSON.stringify(localKW.map((k: any) => k.keyword))}
Questions: ${JSON.stringify(questionKW.map((k: any) => k.question))}
Semantic/LSI: ${JSON.stringify((keywords?.semanticKeywords || []).slice(0, 20))}
Keyword mapping: ${JSON.stringify(keywords?.keywordMapping || {})}

=== SITE MAP ===
Pages: ${JSON.stringify(allPageNames)}
`;

  // Robust JSON extraction — handles code fences, truncated arrays, objects
  function extractJSON(text: string, expectArray: boolean = false): any {
    let cleaned = text.trim();
    // Strip markdown fences
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    // First try direct parse
    try { return JSON.parse(cleaned); } catch { }
    // Try stripping trailing garbage
    if (expectArray) {
      const firstBracket = cleaned.indexOf("[");
      if (firstBracket >= 0) {
        cleaned = cleaned.slice(firstBracket);
      }
      let depth = 0;
      let lastCompleteObj = -1;
      let inString = false;
      let escape = false;
      for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) lastCompleteObj = i; }
      }
      if (lastCompleteObj > 0) {
        const trimmed = cleaned.slice(0, lastCompleteObj + 1) + "]";
        try { return JSON.parse(trimmed); } catch { }
      }
    } else {
      const lastBrace = cleaned.lastIndexOf("}");
      if (lastBrace > 0) {
        try { return JSON.parse(cleaned.slice(0, lastBrace + 1)); } catch { }
      }
    }
    return null;
  }

  // Generate content for a SINGLE section — most reliable approach
  async function generateSingleSection(pageName: string, purpose: string, pageKeywords: any[], section: any, retryCount: number = 0): Promise<any> {
    const sType = section.type || "content";
    const sName = section.sectionName || "Section";
    const sDesc = section.description || "Content section";
    const elements = JSON.stringify(section.contentElements || ["heading", "paragraph"]);
    const hasImg = section.hasImage ? `\nImage needed: ${section.imageDescription || "yes"}` : "";
    const hasForm = section.hasForm ? `\nForm fields: ${section.formFields || "contact form"}` : "";
    const hasCTA = section.hasCTA ? `\nCTA: ${section.ctaText || "Call to action"}` : "";

    // Build type-specific instructions to keep it focused
    let typeInstructions = "";
    switch (sType) {
      case "hero":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"hero","heading":"compelling H1 with primary keyword","subheading":"supporting tagline","content":"1-2 persuasive paragraphs","cta":{"text":"button text","action":"target page/action"},"images":[{"description":"hero image description","altText":"keyword-rich alt text"}]}`;
        break;
      case "testimonials":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"testimonials","heading":"H2 heading","testimonials":[{"quote":"full testimonial text","author":"Name","role":"Title/Company","rating":5}]} — include 3-4 realistic testimonials`;
        break;
      case "stats":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"stats","heading":"H2 heading","stats":[{"number":"100+","label":"description"}]} — include 3-5 compelling statistics`;
        break;
      case "faq":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"faq","heading":"H2 heading","faqItems":[{"question":"SEO question","answer":"detailed answer 2-3 sentences"}]} — include 5-8 Q&A pairs using question keywords`;
        break;
      case "form":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"form","heading":"H2 heading","content":"intro paragraph","formConfig":{"heading":"form title","fields":["Name","Email","Phone","Message"],"submitText":"button text","privacyNote":"privacy text"}}`;
        break;
      case "features": case "card-grid":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"features","heading":"H2 heading","content":"intro paragraph","cardItems":[{"title":"item title","description":"2-3 sentence description","icon":"icon name"}]} — include 4-8 items`;
        break;
      case "team":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"team","heading":"H2 heading","content":"intro paragraph","cardItems":[{"title":"Name","description":"role and bio"}]} — include 3-6 team members`;
        break;
      case "cta":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"cta","heading":"compelling heading","content":"persuasive paragraph","cta":{"text":"button text","action":"action description","subtext":"supporting text below button"}}`;
        break;
      case "map":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"map","heading":"H2 heading","content":"address, business hours, and directions paragraph","bulletPoints":["Mon-Fri: 9am-5pm","Sat: 10am-2pm"]}`;
        break;
      case "gallery": case "blog":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"${sType}","heading":"H2 heading","content":"intro paragraph","cardItems":[{"title":"entry title","description":"2-3 sentence description"}]} — include 4-6 items`;
        break;
      case "pricing":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"pricing","heading":"H2 heading","content":"intro paragraph","cardItems":[{"title":"plan name","description":"what's included"}]} — include 2-4 pricing tiers`;
        break;
      case "process":
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"process","heading":"H2 heading","content":"intro paragraph","cardItems":[{"title":"Step 1: Title","description":"step description"}]} — include 3-6 steps`;
        break;
      default:
        typeInstructions = `Return: {"sectionName":"${sName}","sectionType":"${sType}","heading":"H2 heading with keyword","content":"2-3 SEO-optimized paragraphs","bulletPoints":["key points if relevant"],"images":[{"description":"image description","altText":"keyword alt text"}]}`;
        break;
    }

    try {
      const text = await aiComplete("gpt_5_1", `Generate SEO content for the "${sName}" section (type: ${sType}) on the "${pageName}" page.

Business: ${analysis.businessName || "Local Business"} | Industry: ${analysis.industry} | Location: ${analysis.location || ""}
Keywords for this page: ${JSON.stringify(pageKeywords)}
Primary keywords: ${JSON.stringify(topPrimaryKW.slice(0, 8).map((k: any) => k.keyword))}
Local keywords: ${JSON.stringify(localKW.slice(0, 6).map((k: any) => k.keyword))}

Section purpose: ${sDesc}
Content elements expected: ${elements}${hasImg}${hasForm}${hasCTA}

${typeInstructions}

Naturally weave in keywords. Write for local customers in ${analysis.location || "the area"}. Make content compelling and specific to ${analysis.businessName || "this business"}.
Return valid JSON.`);

      const parsed = extractJSON(text, false);
      if (parsed && parsed.sectionName) {
        console.log(`  [SOP] ✓ ${pageName} > ${sName} — generated OK`);
        return parsed;
      }
      // Try wrapping in case it returned an array
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`  [SOP] ✓ ${pageName} > ${sName} — extracted from array`);
        return parsed[0];
      }
      throw new Error("Parsed but no sectionName field");
    } catch (err: any) {
      console.error(`  [SOP] ✗ ${pageName} > ${sName} — attempt ${retryCount + 1} failed: ${err.message}`);
      if (retryCount < 2) {
        console.log(`  [SOP] ↻ Retrying ${pageName} > ${sName}...`);
        // Small delay before retry
        await new Promise(r => setTimeout(r, 1000 + retryCount * 2000));
        return generateSingleSection(pageName, purpose, pageKeywords, section, retryCount + 1);
      }
      // Final fallback: return a placeholder with actual useful content
      console.error(`  [SOP] ✗✗ ${pageName} > ${sName} — all retries failed, using fallback`);
      return {
        sectionName: sName,
        sectionType: sType,
        heading: sName,
        content: `[Content generation failed after 3 attempts. Manual content needed for the ${sName} section of the ${pageName} page. This section should be a ${sType} section covering: ${sDesc}]`,
      };
    }
  }

  console.log(`\n[SOP] Starting generation for ${pages.length} pages...`);
  const sopPages: any[] = [];

  for (const pg of pages.slice(0, 15)) {
    const pageSections = pg.sections || [];
    const pageKeywords = keywords?.keywordMapping?.[pg.pageName] ||
      topPrimaryKW.slice(0, 5).map((k: any) => k.keyword);

    console.log(`\n[SOP] === ${pg.pageName} (${pageSections.length} sections) ===`);

    // Step A: Generate SEO meta, schema, internalLinks, devNotes
    console.log(`  [SOP] Generating meta for ${pg.pageName}...`);
    let pageMeta: any = {};
    try {
      const metaText = await aiComplete("gpt_5_1", `Generate SEO metadata for the "${pg.pageName}" page of a local business website.

Business: ${analysis.businessName || "Local Business"}
Industry: ${analysis.industry}
Location: ${analysis.location || ""}
Target keywords: ${JSON.stringify(pageKeywords)}
All site pages: ${JSON.stringify(allPageNames)}

Return valid JSON:
{
  "seo": {
    "titleTag": "60 chars max, primary keyword + location + brand",
    "metaDescription": "155 chars max, compelling with keyword",
    "h1": "main heading with primary keyword",
    "canonicalUrl": "/url-slug",
    "ogTitle": "Open Graph title",
    "ogDescription": "Open Graph description",
    "ogImage": "description of ideal OG image"
  },
  "schema": {
    "type": "LocalBusiness/Service/FAQPage/etc",
    "markup": "JSON-LD schema as string"
  },
  "internalLinks": [
    {"anchorText": "keyword link text", "targetPage": "page name", "context": "where to place"}
  ],
  "devNotes": {
    "structuredData": "implementation notes",
    "technicalSEO": ["technical requirements"],
    "performanceNotes": "optimization",
    "accessibilityNotes": "a11y requirements"
  }
}`);
      pageMeta = extractJSON(metaText) || {};
      console.log(`  [SOP] ✓ Meta generated for ${pg.pageName}`);
    } catch (err: any) {
      console.error(`  [SOP] ✗ Meta failed for ${pg.pageName}: ${err.message}`);
    }

    // Step B: Generate each section individually (most reliable) with concurrency
    // Process 2 sections in parallel to speed things up while staying under rate limits
    const allSections: any[] = new Array(pageSections.length);
    const CONCURRENCY = 2;
    for (let i = 0; i < pageSections.length; i += CONCURRENCY) {
      const batch = pageSections.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((section: any, batchIdx: number) =>
          generateSingleSection(pg.pageName, pg.purpose || "", pageKeywords, section)
            .then(result => ({ index: i + batchIdx, result }))
        )
      );
      for (const { index, result } of results) {
        allSections[index] = result;
      }
    }

    // Filter out any null/undefined entries
    const validSections = allSections.filter(Boolean);
    console.log(`  [SOP] ${pg.pageName}: ${validSections.length}/${pageSections.length} sections generated`);

    sopPages.push({
      pageName: pg.pageName,
      slug: pageMeta.seo?.canonicalUrl?.replace(/^\//, "") || pg.pageName.toLowerCase().replace(/\s+/g, "-"),
      seo: pageMeta.seo || {},
      schema: pageMeta.schema || {},
      sections: validSections,
      internalLinks: pageMeta.internalLinks || [],
      devNotes: pageMeta.devNotes || {},
    });
  }

  // Generate overall SOP summary
  console.log(`\n[SOP] Generating overall SOP summary...`);
  let summary: any = {};
  try {
    const summaryText = await aiComplete("gpt_5_1", `Generate a comprehensive technical SEO checklist and site-wide SOP for a dev team building a local business website.

${researchContext}

Number of pages: ${sopPages.length}
Pages: ${sopPages.map((p: any) => p.pageName).join(", ")}
Theme design patterns: ${JSON.stringify(themeStructure?.designPatterns || {})}
Global elements: ${JSON.stringify(themeStructure?.globalElements || {})}

Return valid JSON:
{
  "projectOverview": {
    "businessName": "name",
    "industry": "industry",
    "location": "location",
    "targetAudience": "description of target audience",
    "primaryGoal": "main conversion goal",
    "competitivePosition": "how to position vs competitors"
  },
  "technicalSEOChecklist": [
    {"task": "task description", "priority": "high/medium/low", "category": "on-page/technical/local/content"}
  ],
  "siteWideRequirements": {
    "xmlSitemap": "requirements",
    "robotsTxt": "what to include",
    "sslCertificate": "HTTPS requirements",
    "mobileResponsive": "mobile-first requirements",
    "pageSpeed": "performance targets and techniques",
    "coreWebVitals": "LCP, FID, CLS targets",
    "analytics": "GA4, Search Console setup",
    "localSEO": {
      "googleBusinessProfile": "optimization steps",
      "localCitations": "NAP consistency requirements",
      "localSchema": "LocalBusiness schema requirements",
      "reviewStrategy": "how to get and display reviews"
    }
  },
  "contentStrategy": {
    "blogCalendar": [{"month": "Month 1", "topics": ["topic 1", "topic 2"], "targetKeywords": ["keywords"]}],
    "linkBuildingStrategy": "approach for local link building",
    "socialMediaIntegration": "how to tie social to SEO"
  },
  "implementationPriority": [
    {"phase": "Phase 1 - Foundation", "tasks": ["task 1", "task 2"], "timeline": "Week 1-2"}
  ]
}`);
    summary = extractJSON(summaryText) || { error: "Failed to parse summary" };
    console.log(`[SOP] ✓ Summary generated`);
  } catch (err: any) {
    console.error(`[SOP] ✗ Summary failed: ${err.message}`);
    summary = { error: "Failed to generate summary" };
  }

  const totalSections = sopPages.reduce((sum: number, p: any) => sum + (p.sections?.length || 0), 0);
  const totalExpected = pages.slice(0, 15).reduce((sum: number, p: any) => sum + (p.sections?.length || 0), 0);
  console.log(`\n[SOP] === COMPLETE: ${sopPages.length} pages, ${totalSections}/${totalExpected} sections generated ===\n`);

  return {
    summary,
    pages: sopPages,
    generatedAt: new Date().toISOString(),
  };
}

// Helper: try to recover data that was stored under error/raw format
function recoverData(data: any): any {
  if (!data) return null;
  if (data.error && data.raw) {
    try {
      return parseAIJSON(data.raw);
    } catch {
      return data;
    }
  }
  return data;
}

// Lite analysis for embed widget
async function runLiteAnalysis(url: string): Promise<any> {
  // PHASE 1: Deep technical crawl
  const page = await fetchPageContent(url);
  const html = page.html;
  const $ = cheerio.load(html);

  // --- Meta & Head Checks ---
  const title = page.title;
  const titleLen = title.length;
  const metaDesc = page.meta["description"] || page.meta["og:description"] || "";
  const metaDescLen = metaDesc.length;
  const canonical = $("link[rel='canonical']").attr("href") || "";
  const viewport = $("meta[name='viewport']").attr("content") || "";
  const charset = $("meta[charset]").attr("charset") || $("meta[http-equiv='Content-Type']").attr("content") || "";
  const robots = page.meta["robots"] || "";
  const ogTitle = page.meta["og:title"] || "";
  const ogDesc = page.meta["og:description"] || "";
  const ogImage = page.meta["og:image"] || "";
  const ogType = page.meta["og:type"] || "";
  const twitterCard = page.meta["twitter:card"] || "";
  const twitterTitle = page.meta["twitter:title"] || "";
  const favicon = $("link[rel='icon'], link[rel='shortcut icon']").attr("href") || "";
  const lang = $("html").attr("lang") || "";

  // --- Schema / Structured Data ---
  const schemaScripts: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).html() || "";
    if (txt.length > 5) schemaScripts.push(txt.slice(0, 500));
  });
  const hasSchema = schemaScripts.length > 0;

  // --- Heading Structure ---
  const h1s: string[] = [];
  $("h1").each((_, el) => h1s.push($(el).text().trim().slice(0, 100)));
  const h2s: string[] = [];
  $("h2").each((_, el) => h2s.push($(el).text().trim().slice(0, 80)));
  const h3s: string[] = [];
  $("h3").each((_, el) => h3s.push($(el).text().trim().slice(0, 60)));

  // --- Image Analysis ---
  const images: { src: string; alt: string; hasAlt: boolean }[] = [];
  $("img").each((_, el) => {
    const alt = $(el).attr("alt") || "";
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    images.push({ src: src.slice(0, 120), alt: alt.slice(0, 80), hasAlt: alt.trim().length > 0 });
  });
  const totalImages = images.length;
  const imagesWithAlt = images.filter(i => i.hasAlt).length;
  const imagesMissingAlt = totalImages - imagesWithAlt;

  // --- Link Analysis ---
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
  const brokenLinkCandidates: string[] = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript") || href.startsWith("mailto") || href.startsWith("tel")) return;
    try {
      const resolved = new URL(href, url).href;
      const base = new URL(url);
      if (resolved.includes(base.hostname)) internalLinks.push(resolved);
      else externalLinks.push(resolved);
    } catch { brokenLinkCandidates.push(href); }
  });
  const uniqueInternal = [...new Set(internalLinks)];
  const uniqueExternal = [...new Set(externalLinks)];

  // --- Performance Signals ---
  const hasLazyLoad = html.includes('loading="lazy"') || html.includes("lazyload");
  const hasMinifiedCSS = $("link[rel='stylesheet']").length > 0;
  const inlineStyleCount = $("[style]").length;
  const scriptCount = $("script").length;
  const cssLinkCount = $("link[rel='stylesheet']").length;

  // --- Content Analysis ---
  const bodyText = page.text;
  const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
  const paragraphs = $("p").length;
  const lists = $("ul, ol").length;
  const hasContactInfo = /(?:phone|tel|email|contact|address)/i.test(bodyText);
  const hasCTA = /(?:get started|sign up|contact us|free|buy now|learn more|schedule|book|request|download)/i.test(bodyText);
  const hasSSL = url.startsWith("https");

  // --- Accessibility Quick Checks ---
  const formsWithoutLabels = $("input:not([type='hidden']):not([aria-label]):not([id])").length;
  const buttonsWithoutText = $("button:empty, button:not(:has(*))").filter((_, el) => !$(el).text().trim() && !$(el).attr("aria-label")).length;

  // Build crawl report
  const crawlReport = {
    url,
    meta: {
      title: { value: title, length: titleLen, status: titleLen >= 30 && titleLen <= 60 ? "PASS" : titleLen > 0 ? "WARN" : "FAIL", note: titleLen === 0 ? "No title tag found" : titleLen < 30 ? `Too short (${titleLen} chars, aim for 30-60)` : titleLen > 60 ? `Too long (${titleLen} chars, aim for 30-60)` : `Good length (${titleLen} chars)` },
      description: { value: metaDesc.slice(0, 160), length: metaDescLen, status: metaDescLen >= 120 && metaDescLen <= 160 ? "PASS" : metaDescLen > 0 ? "WARN" : "FAIL", note: metaDescLen === 0 ? "No meta description found" : metaDescLen < 120 ? `Too short (${metaDescLen} chars, aim for 120-160)` : metaDescLen > 160 ? `Too long (${metaDescLen} chars, aim for 120-160)` : `Good length (${metaDescLen} chars)` },
      canonical: { value: canonical, status: canonical ? "PASS" : "WARN", note: canonical ? "Canonical tag present" : "No canonical tag — risk of duplicate content" },
      viewport: { status: viewport ? "PASS" : "FAIL", note: viewport ? "Viewport meta set" : "Missing viewport meta — not mobile-friendly" },
      lang: { value: lang, status: lang ? "PASS" : "WARN", note: lang ? `Language declared: ${lang}` : "No lang attribute on <html>" },
      ssl: { status: hasSSL ? "PASS" : "FAIL", note: hasSSL ? "HTTPS enabled" : "Not using HTTPS — security and ranking risk" },
      favicon: { status: favicon ? "PASS" : "WARN", note: favicon ? "Favicon found" : "No favicon detected" },
      charset: { status: charset ? "PASS" : "WARN", note: charset ? "Character encoding declared" : "No charset declaration" },
      robots: { value: robots, status: robots.includes("noindex") ? "WARN" : "PASS", note: robots.includes("noindex") ? "Page set to noindex — won't appear in search" : robots ? `Robots: ${robots}` : "No robots meta (defaults to index,follow)" },
    },
    socialMedia: {
      openGraph: { title: ogTitle, description: ogDesc, image: ogImage, type: ogType, status: ogTitle && ogImage ? "PASS" : ogTitle || ogImage ? "WARN" : "FAIL", note: !ogTitle && !ogImage ? "No Open Graph tags — social shares will look generic" : !ogImage ? "Missing og:image — social shares won't have a preview image" : !ogTitle ? "Missing og:title" : "Open Graph tags configured" },
      twitter: { card: twitterCard, title: twitterTitle, status: twitterCard ? "PASS" : "WARN", note: twitterCard ? `Twitter card: ${twitterCard}` : "No Twitter Card tags" },
    },
    structuredData: {
      hasSchema,
      schemaCount: schemaScripts.length,
      schemas: schemaScripts.map(s => { try { const p = JSON.parse(s); return p["@type"] || "unknown"; } catch { return "invalid"; } }),
      status: hasSchema ? "PASS" : "FAIL",
      note: hasSchema ? `${schemaScripts.length} schema(s) found: ${schemaScripts.map(s => { try { return JSON.parse(s)["@type"]; } catch { return "?"; } }).join(", ")}` : "No structured data (JSON-LD) — missing rich snippet opportunities",
    },
    headings: {
      h1Count: h1s.length,
      h1s: h1s.slice(0, 5),
      h2Count: h2s.length,
      h2s: h2s.slice(0, 10),
      h3Count: h3s.length,
      status: h1s.length === 1 ? "PASS" : h1s.length === 0 ? "FAIL" : "WARN",
      note: h1s.length === 0 ? "No H1 tag — critical for SEO" : h1s.length > 1 ? `${h1s.length} H1 tags found (should be exactly 1)` : "Single H1 tag — correct",
    },
    images: {
      total: totalImages,
      withAlt: imagesWithAlt,
      missingAlt: imagesMissingAlt,
      hasLazyLoad,
      status: imagesMissingAlt === 0 && totalImages > 0 ? "PASS" : imagesMissingAlt > 0 ? "WARN" : totalImages === 0 ? "WARN" : "FAIL",
      note: totalImages === 0 ? "No images found" : imagesMissingAlt === 0 ? `All ${totalImages} images have alt text` : `${imagesMissingAlt} of ${totalImages} images missing alt text`,
      missingAltExamples: images.filter(i => !i.hasAlt).slice(0, 5).map(i => i.src),
    },
    links: {
      internal: uniqueInternal.length,
      external: uniqueExternal.length,
      brokenCandidates: brokenLinkCandidates.length,
      status: uniqueInternal.length >= 3 ? "PASS" : "WARN",
      note: `${uniqueInternal.length} internal, ${uniqueExternal.length} external links`,
    },
    content: {
      wordCount,
      paragraphs,
      lists,
      hasCTA,
      hasContactInfo,
      status: wordCount >= 300 ? "PASS" : wordCount >= 100 ? "WARN" : "FAIL",
      note: wordCount < 100 ? `Very thin content (${wordCount} words) — needs substantial copy` : wordCount < 300 ? `Light content (${wordCount} words) — aim for 500+` : `${wordCount} words — decent content volume`,
    },
    performance: {
      scriptCount,
      cssLinkCount,
      inlineStyles: inlineStyleCount,
      hasLazyLoad,
      status: scriptCount <= 10 ? "PASS" : "WARN",
      note: `${scriptCount} scripts, ${cssLinkCount} CSS files${inlineStyleCount > 20 ? `, ${inlineStyleCount} inline styles (consider external CSS)` : ""}`,
    },
    accessibility: {
      formsWithoutLabels,
      buttonsWithoutText,
      status: formsWithoutLabels === 0 && buttonsWithoutText === 0 ? "PASS" : "WARN",
      note: formsWithoutLabels > 0 || buttonsWithoutText > 0 ? `${formsWithoutLabels} inputs without labels, ${buttonsWithoutText} buttons without text` : "Basic accessibility checks pass",
    },
  };

  // PHASE 2: AI analysis using the crawl data
  const aiPrompt = `You are an expert SEO auditor. I've crawled a website and collected detailed technical data. Analyze everything and provide a thorough, specific audit.

CRAWL DATA:
${JSON.stringify(crawlReport, null, 2)}

PAGE CONTENT (excerpt):
${page.text.slice(0, 4000)}

Provide an extremely detailed audit. Be SPECIFIC — reference exact issues found in the crawl data (e.g. "Your title tag is ${titleLen} characters" not "Your title could be better"). Every item should cite what you found.

Return valid JSON:
{
  "businessName": "extracted business name",
  "industry": "industry/niche",
  "overallScore": <0-100 based on the technical findings>,
  "summary": "3-4 sentence executive summary referencing specific findings",
  "technicalSEO": [
    { "check": "Title Tag", "status": "PASS|WARN|FAIL", "finding": "specific finding with data", "recommendation": "specific fix if needed" },
    { "check": "Meta Description", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Canonical Tag", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "HTTPS/SSL", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Mobile Viewport", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Language Declaration", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Structured Data", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Robots Directives", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Favicon", "status": "...", "finding": "...", "recommendation": "..." }
  ],
  "onPageSEO": [
    { "check": "H1 Tag", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Heading Hierarchy", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Image Alt Text", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Internal Linking", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Content Length", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Call to Action", "status": "...", "finding": "...", "recommendation": "..." }
  ],
  "socialMedia": [
    { "check": "Open Graph Tags", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Twitter Cards", "status": "...", "finding": "...", "recommendation": "..." }
  ],
  "performance": [
    { "check": "Script Count", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Image Optimization", "status": "...", "finding": "...", "recommendation": "..." },
    { "check": "Accessibility", "status": "...", "finding": "...", "recommendation": "..." }
  ],
  "strengths": ["5-8 specific things the site does well, citing exact data"],
  "weaknesses": ["5-8 specific issues found, citing exact data"],
  "quickWins": ["5 easy improvements ranked by impact, each with a specific action step"],
  "categoryScores": {
    "technicalSEO": <0-100>,
    "onPageSEO": <0-100>,
    "content": <0-100>,
    "socialPresence": <0-100>,
    "performance": <0-100>
  }
}`;

  const text = await aiComplete("gpt5_mini", aiPrompt);
  try {
    const result = parseAIJSON(text);
    // Attach raw crawl data so the PDF can use it
    result._crawlData = crawlReport;
    return result;
  } catch {
    return { error: "Failed to run lite analysis" };
  }
}

export function registerRoutes(server: Server, app: Express) {
  // Create a new project and start analysis
  app.post("/api/projects", async (req: Request, res: Response) => {
    const parsed = startAnalysisSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.format() });
    }
    const project = await storage.createProject({
      businessUrl: parsed.data.businessUrl,
      themeUrl: parsed.data.themeUrl || null,
      businessName: parsed.data.businessName || null,
      industry: parsed.data.industry || null,
      location: parsed.data.location || null,
      status: "analyzing",
    });
    res.status(201).json(project);
    runPipeline(project.id, parsed.data).catch(console.error);
  });

  // Get project status and results — always attempt to recover data
  app.get("/api/projects/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const project = await storage.getProject(id);
    if (!project) return res.status(404).json({ error: "Not found" });
    // Recover any data that was stored in error/raw format
    const recovered = {
      ...project,
      siteAnalysis: recoverData(project.siteAnalysis),
      competitors: recoverData(project.competitors),
      keywords: recoverData(project.keywords),
      themeStructure: recoverData(project.themeStructure),
    };
    // Also recover SOP pages
    if (recovered.sopContent && (recovered.sopContent as any).pages) {
      (recovered.sopContent as any).pages = (recovered.sopContent as any).pages.map((p: any) => recoverData(p));
      if ((recovered.sopContent as any).summary) {
        (recovered.sopContent as any).summary = recoverData((recovered.sopContent as any).summary);
      }
    }
    res.json(recovered);
  });

  // List all projects
  app.get("/api/projects", async (_req: Request, res: Response) => {
    const projects = await storage.listProjects();
    res.json(projects);
  });

  // Generate SOP with selected pages
  app.post("/api/projects/:id/generate-sop", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const project = await storage.getProject(id);
    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.status !== "selecting_pages") {
      return res.status(400).json({ error: "Project is not in page selection state" });
    }
    const { selectedPages } = req.body;
    if (!selectedPages || !Array.isArray(selectedPages) || selectedPages.length === 0) {
      return res.status(400).json({ error: "No pages selected" });
    }
    res.json({ status: "generating" });
    // Run SOP generation in background with selected pages
    runSOPGeneration(id, selectedPages).catch(console.error);
  });

  // Stripe checkout — create a checkout session
  app.post("/api/checkout", async (req: Request, res: Response) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      // No Stripe key — skip payment, return success
      return res.json({ url: null, skipped: true });
    }
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey);
      const { projectId } = req.body;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: "RANKITECT Full SEO Blueprint",
              description: "Complete SEO SOP with content plan, meta tags, schema markup, and implementation timeline",
            },
            unit_amount: 3700, // $37.00
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${req.headers.origin || req.protocol + "://" + req.get("host")}/#/project/${projectId}?paid=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || req.protocol + "://" + req.get("host")}/#/project/${projectId}?paid=false`,
        metadata: { projectId: String(projectId) },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("Stripe checkout error:", err);
      res.status(500).json({ error: "Failed to create checkout session: " + err.message });
    }
  });

  // Verify Stripe payment
  app.get("/api/verify-payment/:sessionId", async (req: Request, res: Response) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.json({ paid: true, skipped: true });
    }
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
      const paid = session.payment_status === "paid";
      if (paid && session.metadata?.projectId) {
        await storage.updateProject(parseInt(session.metadata.projectId), { paid: true } as any);
      }
      res.json({ paid, status: session.payment_status });
    } catch (err: any) {
      console.error("Stripe verify error:", err);
      res.status(500).json({ error: "Failed to verify payment: " + err.message });
    }
  });

  // Embed widget script
  app.get("/embed.js", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(`(function(){
  var host = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src).origin : '';
  var key = document.currentScript ? document.currentScript.getAttribute('data-key') || '' : '';

  function createWidget() {
    var style = document.createElement('style');
    style.textContent = \`
      .rankitect-widget { position: fixed; bottom: 20px; right: 20px; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .rankitect-trigger { background: linear-gradient(135deg, #159394, #13e4e6); color: #fff; border: none; padding: 12px 20px; border-radius: 50px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 20px rgba(21,147,148,0.4); display: flex; align-items: center; gap: 8px; transition: transform 0.2s; }
      .rankitect-trigger:hover { transform: scale(1.05); }
      .rankitect-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100000; align-items: center; justify-content: center; }
      .rankitect-modal.open { display: flex; }
      .rankitect-panel { background: #0D1117; border: 1px solid #2A2E36; border-radius: 16px; width: 90%; max-width: 440px; padding: 28px; color: #FDFDFD; }
      .rankitect-panel h3 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
      .rankitect-panel p { margin: 0 0 16px; font-size: 13px; color: #74727B; }
      .rankitect-panel input { width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1px solid #2A2E36; border-radius: 8px; background: #050913; color: #FDFDFD; font-size: 14px; margin-bottom: 10px; outline: none; }
      .rankitect-panel input:focus { border-color: #159394; }
      .rankitect-panel button.primary { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #159394; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
      .rankitect-panel button.primary:hover { background: #13e4e6; }
      .rankitect-panel button.primary:disabled { opacity: 0.6; cursor: not-allowed; }
      .rankitect-panel .close { position: absolute; top: 12px; right: 16px; background: none; border: none; color: #74727B; font-size: 20px; cursor: pointer; }
      .rankitect-results { margin-top: 16px; }
      .rankitect-score { font-size: 42px; font-weight: 800; background: linear-gradient(135deg, #13e4e6, #C41BD1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-align: center; }
      .rankitect-list { list-style: none; padding: 0; margin: 8px 0; }
      .rankitect-list li { font-size: 12px; padding: 4px 0; display: flex; align-items: flex-start; gap: 6px; }
      .rankitect-list li::before { flex-shrink: 0; margin-top: 2px; }
      .rankitect-list.good li::before { content: "\\2713"; color: #10b981; }
      .rankitect-list.bad li::before { content: "\\2717"; color: #ef4444; }
      .rankitect-cta-link { display: block; text-align: center; margin-top: 14px; padding: 10px; border-radius: 8px; background: linear-gradient(135deg, #6600FF, #C41BD1); color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; }
      .rankitect-powered { text-align: center; margin-top: 10px; font-size: 10px; color: #74727B; }
    \`;
    document.head.appendChild(style);

    var widget = document.createElement('div');
    widget.className = 'rankitect-widget';
    widget.innerHTML = '<button class="rankitect-trigger">\\u{1F50D} Free SEO Audit</button>';

    var modal = document.createElement('div');
    modal.className = 'rankitect-modal';
    modal.innerHTML = '<div class="rankitect-panel" style="position:relative;">' +
      '<button class="close" onclick="this.closest(\\'.rankitect-modal\\').classList.remove(\\'open\\')">&times;</button>' +
      '<h3>Free SEO Audit</h3>' +
      '<p>Enter your website URL to get an instant SEO health check.</p>' +
      '<div id="rankitect-form">' +
        '<input id="rankitect-url" type="url" placeholder="https://your-website.com" />' +
        '<input id="rankitect-email" type="email" placeholder="Your email (to receive results)" />' +
        '<button class="primary" id="rankitect-run">Analyze My Site</button>' +
      '</div>' +
      '<div id="rankitect-result" style="display:none;"></div>' +
      '<div class="rankitect-powered">Powered by RANKITECT</div>' +
    '</div>';

    document.body.appendChild(widget);
    document.body.appendChild(modal);

    widget.querySelector('.rankitect-trigger').addEventListener('click', function() {
      modal.classList.add('open');
    });
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.classList.remove('open');
    });

    document.getElementById('rankitect-run').addEventListener('click', function() {
      var url = document.getElementById('rankitect-url').value.trim();
      var email = document.getElementById('rankitect-email').value.trim();
      if (!url) return alert('Please enter a website URL');
      if (!email) return alert('Please enter your email');
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Analyzing...';
      fetch(host + '/api/audit/lite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, email: email, key: key })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        document.getElementById('rankitect-form').style.display = 'none';
        var el = document.getElementById('rankitect-result');
        el.style.display = 'block';
        el.innerHTML = '<div class="rankitect-results">' +
          '<div class="rankitect-score">' + (data.overallScore || '—') + '/100</div>' +
          '<p style="text-align:center;font-size:13px;color:#74727B;">' + (data.businessName || 'Your Site') + ' — ' + (data.summary || '') + '</p>' +
          '<h4 style="font-size:13px;margin:12px 0 4px;color:#10b981;">Strengths</h4>' +
          '<ul class="rankitect-list good">' + (data.strengths || []).map(function(s) { return '<li>' + s + '</li>'; }).join('') + '</ul>' +
          '<h4 style="font-size:13px;margin:12px 0 4px;color:#ef4444;">Issues Found</h4>' +
          '<ul class="rankitect-list bad">' + (data.weaknesses || []).map(function(s) { return '<li>' + s + '</li>'; }).join('') + '</ul>' +
          '<a class="rankitect-cta-link" href="' + host + '/#/?url=' + encodeURIComponent(url) + '" target="_blank">Get Your Full SEO Blueprint — $37</a>' +
        '</div>';
      })
      .catch(function() {
        btn.disabled = false;
        btn.textContent = 'Analyze My Site';
        alert('Analysis failed. Please try again.');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();`);
  });

  // Lite audit for embed widget
  app.post("/api/audit/lite", async (req: Request, res: Response) => {
    const { url, email } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });
    try {
      console.log(`[Lite Audit] Running for ${url} (email: ${email || "not provided"})`);
      const result = await runLiteAnalysis(url);
      // In production you'd store the email + result for lead gen
      console.log(`[Lite Audit] Complete for ${url}, score: ${result.overallScore}`);
      res.json(result);
    } catch (err: any) {
      console.error("Lite audit error:", err);
      res.status(500).json({ error: "Analysis failed: " + err.message });
    }
  });

  // Generate Audit PDF — available at selecting_pages or later
  app.get("/api/projects/:id/audit-pdf", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const project = await storage.getProject(id);
    if (!project) return res.status(404).json({ error: "Not found" });
    const validStatuses = ["selecting_pages", "generating_sop", "complete"];
    if (!validStatuses.includes(project.status)) {
      return res.status(400).json({ error: "Audit data not ready yet" });
    }

    try {
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 45, right: 45 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      const pdfPromise = new Promise<Buffer>((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
      });

      const analysis = recoverData(project.siteAnalysis) || {};
      const comp = recoverData(project.competitors) || {};
      const kw = recoverData(project.keywords) || {};
      const theme = recoverData(project.themeStructure) || {};

      // Brand colors (light BG approach — same as working SOP PDF)
      const TEAL = "#159394";
      const TEAL_LIGHT = "#0fb5b6";
      const PURPLE = "#6600FF";
      const DARK = "#1a1a1a";
      const MUTED = "#6b7280";
      const TABLE_HEADER = "#1B1B1B";
      const WHITE = "#ffffff";
      const GREEN = "#10b981";
      const RED = "#ef4444";
      const YELLOW = "#f59e0b";
      const LIGHT_GREEN_BG = "#ecfdf5";
      const LIGHT_RED_BG = "#fef2f2";
      const LIGHT_YELLOW_BG = "#fffbeb";
      const LIGHT_TEAL_BG = "#f0fdfa";
      const LIGHT_GRAY = "#f3f4f6";
      const pageW = doc.page.width;
      const contentW = pageW - 90;

      // Synthetic SEO score
      const calcScore = (): number => {
        let score = 50;
        score += (analysis.strengths?.length || 0) * 5;
        score -= (analysis.weaknesses?.length || 0) * 4;
        score -= (analysis.contentGaps?.length || 0) * 2;
        if (analysis.currentMeta?.title) score += 5;
        if (analysis.currentMeta?.description) score += 5;
        if (analysis.currentMeta?.hasSchema) score += 8;
        if (analysis.currentMeta?.hasOpenGraph) score += 5;
        return Math.max(10, Math.min(100, score));
      };
      const overallScore = calcScore();
      const scoreColor = overallScore >= 75 ? GREEN : overallScore >= 50 ? YELLOW : RED;
      const scoreLabel = overallScore >= 75 ? "Good" : overallScore >= 50 ? "Needs Work" : "Critical";

      let currentPage = 0;

      // Footer helper — uses absolute positioning, no doc.y side effects
      const addFooter = (pageNum: number) => {
        const footerY = doc.page.height - 35;
        doc.save();
        doc.moveTo(45, footerY).lineTo(45 + contentW, footerY).strokeColor(TEAL).lineWidth(0.5).stroke();
        doc.fontSize(7).fillColor(MUTED);
        doc.text(`RANKITECT by SCALZ.AI  \u2022  SEO Audit Report  \u2022  ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 45, footerY + 6, { width: contentW / 2, align: "left", lineBreak: false });
        doc.text(`Page ${pageNum}`, 45, footerY + 6, { width: contentW, align: "right", lineBreak: false });
        doc.restore();
      };

      // Header bar on every content page
      const addHeader = () => {
        currentPage++;
        doc.rect(0, 0, pageW, 32).fill(TEAL);
        doc.fontSize(8).fillColor(WHITE)
          .text(`SEO AUDIT  \u2014  ${analysis?.businessName || "Report"}`, 45, 10, { align: "center", width: contentW });
        doc.fillColor(DARK);
        doc.y = 46;
        addFooter(currentPage);
      };

      const checkPage = (n: number = 80) => {
        if (doc.y > doc.page.height - 60 - n) { doc.addPage(); addHeader(); }
      };

      // Layout helpers (matching the working SOP PDF approach)
      const h1 = (t: string) => {
        checkPage(60);
        doc.moveDown(0.3);
        doc.rect(45, doc.y, contentW, 28).fill(TEAL);
        doc.fontSize(13).fillColor(WHITE).text(t.toUpperCase(), 55, doc.y + 7, { width: contentW - 20 });
        doc.fillColor(DARK).moveDown(1.2);
      };

      const h2 = (t: string) => {
        checkPage(40);
        doc.moveDown(0.2);
        doc.fontSize(11).fillColor(TEAL).text(t, { underline: false });
        doc.moveTo(45, doc.y).lineTo(45 + contentW, doc.y).strokeColor(TEAL).lineWidth(0.5).stroke();
        doc.fillColor(DARK).moveDown(0.4);
      };

      const p = (t: string) => { checkPage(25); doc.fontSize(9).fillColor(DARK).text(t, { lineGap: 2.5 }); doc.moveDown(0.2); };
      const pMuted = (t: string) => { checkPage(25); doc.fontSize(8.5).fillColor(MUTED).text(t, { lineGap: 2 }); doc.moveDown(0.15); };
      const bullet = (t: string) => { checkPage(20); doc.fontSize(9).fillColor(DARK).text(`  \u2022  ${t}`, { indent: 8, lineGap: 1.5 }); };
      const kvLine = (k: string, v: string) => { checkPage(20); doc.fontSize(9).fillColor(TEAL).text(k + ": ", { continued: true }).fillColor(DARK).text(v || "N/A"); };

      // Table helper
      const drawTable = (headers: string[], rows: string[][], colWidths: number[]) => {
        const rowH = 18;
        const startX = 45;
        checkPage(rowH * (rows.length + 2));
        let x = startX;
        doc.rect(startX, doc.y, contentW, rowH).fill(TABLE_HEADER);
        headers.forEach((h, i) => {
          doc.fontSize(8).fillColor(WHITE).text(h, x + 4, doc.y + 4, { width: colWidths[i] - 8, align: "left" });
          x += colWidths[i];
        });
        doc.y += rowH;
        rows.forEach((row, rowIdx) => {
          if (doc.y > doc.page.height - 80) { doc.addPage(); addHeader(); }
          const bgColor = rowIdx % 2 === 0 ? "#f9fafb" : WHITE;
          doc.rect(startX, doc.y, contentW, rowH).fill(bgColor);
          x = startX;
          row.forEach((cell, i) => {
            doc.fontSize(8).fillColor(DARK).text(cell || "", x + 4, doc.y + 4, { width: colWidths[i] - 8, align: "left" });
            x += colWidths[i];
          });
          doc.y += rowH;
        });
        doc.fillColor(DARK).moveDown(0.4);
      };

      // Horizontal bar chart
      const drawBarChart = (items: { label: string; value: number; color?: string }[], maxVal: number, chartWidth: number = contentW) => {
        const barH = 16;
        const labelW = 120;
        items.forEach((item) => {
          checkPage(barH + 4);
          const barW = Math.max(2, ((item.value / maxVal) * (chartWidth - labelW - 40)));
          doc.fontSize(8).fillColor(DARK).text(item.label, 55, doc.y + 2, { width: labelW });
          doc.rect(55 + labelW, doc.y, barW, barH - 4).fill(item.color || TEAL);
          doc.fontSize(7).fillColor(MUTED).text(String(item.value), 55 + labelW + barW + 4, doc.y + 2);
          doc.y += barH;
        });
        doc.moveDown(0.4);
      };

      // Status badge inline
      const statusBadge = (status: "pass" | "warn" | "fail"): string => {
        return status === "pass" ? "\u2705 PASS" : status === "warn" ? "\u26A0 WARN" : "\u274C FAIL";
      };

      // ============================================================
      // COVER PAGE
      // ============================================================
      currentPage++;
      doc.rect(0, 0, pageW, doc.page.height).fill(WHITE);
      // Top teal accent bar
      doc.rect(0, 0, pageW, 8).fill(TEAL);
      // Left accent
      doc.rect(45, 100, 4, 50).fill(TEAL);
      doc.rect(52, 110, 2, 25).fill(PURPLE);

      doc.fontSize(10).fillColor(TEAL).text("SEO AUDIT REPORT", 60, 105);
      doc.fontSize(36).fillColor(DARK).text("Website", 60, 120);
      doc.fontSize(36).fillColor(TEAL).text("Health Check", 60, 155);

      doc.moveDown(2);
      // Business info box
      const ciY = 220;
      doc.rect(45, ciY, contentW, 70).fill(LIGHT_TEAL_BG);
      doc.rect(45, ciY, contentW, 3).fill(TEAL);
      doc.fontSize(8).fillColor(MUTED).text("PREPARED FOR", 60, ciY + 12);
      doc.fontSize(18).fillColor(DARK).text(analysis.businessName || project.businessName || "Business", 60, ciY + 25);
      doc.fontSize(9).fillColor(MUTED).text(project.businessUrl, 60, ciY + 48);
      doc.fontSize(9).fillColor(MUTED).text(`${analysis.industry || ""} ${analysis.location ? "\u2022 " + analysis.location : ""}`, 60, ciY + 60);

      // Overall score section
      const scoreBoxY = 310;
      doc.rect(45, scoreBoxY, contentW, 100).fill(LIGHT_GRAY);
      doc.rect(45, scoreBoxY, contentW, 3).fill(scoreColor);
      doc.fontSize(9).fillColor(MUTED).text("OVERALL SEO HEALTH SCORE", 45, scoreBoxY + 12, { width: contentW, align: "center" });
      doc.fontSize(48).fillColor(scoreColor).text(String(overallScore), 45, scoreBoxY + 28, { width: contentW, align: "center" });
      doc.fontSize(12).fillColor(scoreColor).text(scoreLabel.toUpperCase(), 45, scoreBoxY + 78, { width: contentW, align: "center" });

      // Mini stats
      const msY = 430;
      const msW = contentW / 4;
      const miniStats = [
        { label: "Strengths", val: String(analysis.strengths?.length || 0), clr: GREEN, bg: LIGHT_GREEN_BG },
        { label: "Weaknesses", val: String(analysis.weaknesses?.length || 0), clr: RED, bg: LIGHT_RED_BG },
        { label: "Keywords", val: String((kw.primaryKeywords?.length || 0) + (kw.longTailKeywords?.length || 0)), clr: TEAL, bg: LIGHT_TEAL_BG },
        { label: "Competitors", val: String(comp.competitors?.length || 0), clr: PURPLE, bg: "#f5f3ff" },
      ];
      miniStats.forEach((s, i) => {
        const sx = 45 + i * msW;
        doc.rect(sx + 2, msY, msW - 4, 50).fill(s.bg);
        doc.rect(sx + 2, msY, msW - 4, 2).fill(s.clr);
        doc.fontSize(22).fillColor(s.clr).text(s.val, sx + 2, msY + 10, { width: msW - 4, align: "center" });
        doc.fontSize(7).fillColor(MUTED).text(s.label.toUpperCase(), sx + 2, msY + 36, { width: msW - 4, align: "center" });
      });

      doc.fontSize(8).fillColor(MUTED).text(
        `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}  \u2022  Powered by RANKITECT by SCALZ.AI`,
        45, doc.page.height - 60, { width: contentW, align: "center" }
      );
      doc.rect(0, doc.page.height - 8, pageW, 8).fill(TEAL);
      addFooter(currentPage);

      // ============================================================
      // PAGE 2: EXECUTIVE SUMMARY
      // ============================================================
      doc.addPage(); addHeader();
      h1("Executive Summary");

      // Category scores as a table
      const catScores = [
        { label: "On-Page SEO", score: analysis.currentMeta?.title ? 70 : 30, desc: analysis.currentMeta?.title ? "Title tags present" : "Missing title optimization" },
        { label: "Technical SEO", score: analysis.currentMeta?.hasSchema ? 75 : 25, desc: analysis.currentMeta?.hasSchema ? "Schema markup found" : "No schema markup" },
        { label: "Content Quality", score: Math.min(90, 40 + (analysis.strengths?.length || 0) * 10), desc: `${analysis.strengths?.length || 0} strengths identified` },
        { label: "Competitiveness", score: Math.min(85, 30 + (comp.competitors?.length || 0) * 10), desc: `${comp.competitors?.length || 0} competitors analyzed` },
      ];
      const catHeaders = ["Category", "Score", "Status", "Notes"];
      const catColW = [contentW * 0.25, contentW * 0.15, contentW * 0.2, contentW * 0.4];
      const catRows = catScores.map(c => [
        c.label,
        String(c.score) + "/100",
        c.score >= 70 ? "Good" : c.score >= 45 ? "Needs Work" : "Critical",
        c.desc,
      ]);
      drawTable(catHeaders, catRows, catColW);

      // Score bar chart
      h2("Score Breakdown");
      drawBarChart(catScores.map(c => ({
        label: c.label,
        value: c.score,
        color: c.score >= 70 ? GREEN : c.score >= 45 ? YELLOW : RED,
      })), 100);

      // Key findings
      h2("Key Findings");
      const findings: string[] = [];
      if (!analysis.currentMeta?.title) findings.push("Missing or unoptimized title tags \u2014 critical for search rankings.");
      if (!analysis.currentMeta?.description) findings.push("No meta description found \u2014 reduces click-through rates from search results.");
      if (!analysis.currentMeta?.hasSchema) findings.push("No structured data (Schema.org) \u2014 missing rich snippet opportunities.");
      if (!analysis.currentMeta?.hasOpenGraph) findings.push("No Open Graph tags \u2014 social media shares will appear generic.");
      if (analysis.weaknesses?.length) findings.push(...analysis.weaknesses.slice(0, 3));
      if (analysis.contentGaps?.length) findings.push(`${analysis.contentGaps.length} content gaps identified that competitors are filling.`);
      if (findings.length === 0) findings.push("Site has a solid foundation. Focus on content depth and keyword targeting.");
      findings.slice(0, 8).forEach(f => bullet(f));

      // ============================================================
      // PAGE 3: STRENGTHS & WEAKNESSES
      // ============================================================
      doc.addPage(); addHeader();
      h1("What's Working");
      if (analysis.strengths?.length) {
        analysis.strengths.forEach((s: string) => {
          checkPage(22);
          doc.rect(45, doc.y, contentW, 18).fill(LIGHT_GREEN_BG);
          doc.fontSize(9).fillColor(GREEN).text("  \u2713  ", 50, doc.y + 4, { continued: true }).fillColor(DARK).text(s);
          doc.moveDown(0.2);
        });
      } else {
        p("No specific strengths identified. A full SOP will provide detailed recommendations.");
      }

      doc.moveDown(0.5);
      h1("What Needs Improvement");
      if (analysis.weaknesses?.length) {
        analysis.weaknesses.forEach((w: string) => {
          checkPage(22);
          doc.rect(45, doc.y, contentW, 18).fill(LIGHT_RED_BG);
          doc.fontSize(9).fillColor(RED).text("  \u2717  ", 50, doc.y + 4, { continued: true }).fillColor(DARK).text(w);
          doc.moveDown(0.2);
        });
      } else {
        p("No specific weaknesses identified.");
      }

      if (analysis.contentGaps?.length) {
        doc.moveDown(0.5);
        h1("Content Gaps");
        analysis.contentGaps.forEach((g: string) => {
          checkPage(22);
          doc.rect(45, doc.y, contentW, 18).fill(LIGHT_YELLOW_BG);
          doc.fontSize(9).fillColor(YELLOW).text("  \u26A0  ", 50, doc.y + 4, { continued: true }).fillColor(DARK).text(g);
          doc.moveDown(0.2);
        });
      }

      // ============================================================
      // PAGE 4: TECHNICAL SEO AUDIT
      // ============================================================
      doc.addPage(); addHeader();
      h1("Technical SEO Audit");

      const techItems = [
        { label: "Title Tag", status: analysis.currentMeta?.title ? "pass" as const : "fail" as const, detail: analysis.currentMeta?.title || "Not found" },
        { label: "Meta Description", status: analysis.currentMeta?.description ? "pass" as const : "fail" as const, detail: analysis.currentMeta?.description || "Not found" },
        { label: "Schema Markup", status: analysis.currentMeta?.hasSchema ? "pass" as const : "fail" as const, detail: analysis.currentMeta?.hasSchema ? "Structured data detected" : "No structured data found" },
        { label: "Open Graph Tags", status: analysis.currentMeta?.hasOpenGraph ? "pass" as const : "warn" as const, detail: analysis.currentMeta?.hasOpenGraph ? "OG tags present" : "Missing OG tags" },
        { label: "SSL Certificate", status: project.businessUrl.startsWith("https") ? "pass" as const : "fail" as const, detail: project.businessUrl.startsWith("https") ? "HTTPS enabled" : "Site not using HTTPS" },
        { label: "Mobile Responsive", status: "warn" as const, detail: "Manual verification recommended" },
        { label: "Page Speed", status: "warn" as const, detail: "Run Google PageSpeed Insights for detailed metrics" },
        { label: "XML Sitemap", status: "warn" as const, detail: "Check /sitemap.xml for presence" },
        { label: "Robots.txt", status: "warn" as const, detail: "Check /robots.txt for correct directives" },
      ];

      const techHeaders = ["Check", "Status", "Details"];
      const techColW = [contentW * 0.22, contentW * 0.15, contentW * 0.63];
      const techRows = techItems.map(item => [
        item.label,
        statusBadge(item.status),
        item.detail.slice(0, 80),
      ]);
      drawTable(techHeaders, techRows, techColW);

      // Summary bar chart
      const passes = techItems.filter(t => t.status === "pass").length;
      const warns = techItems.filter(t => t.status === "warn").length;
      const fails = techItems.filter(t => t.status === "fail").length;
      h2("Audit Summary");
      drawBarChart([
        { label: "Passing", value: passes, color: GREEN },
        { label: "Warnings", value: warns, color: YELLOW },
        { label: "Failing", value: fails, color: RED },
      ], Math.max(passes, warns, fails, 1));

      // ============================================================
      // PAGE 5: COMPETITOR ANALYSIS
      // ============================================================
      if (comp.competitors?.length) {
        doc.addPage(); addHeader();
        h1("Competitor Analysis");

        const compHeaders = ["Rank", "Competitor", "Strength", "Key Advantages"];
        const compColW = [contentW * 0.08, contentW * 0.22, contentW * 0.15, contentW * 0.55];
        const compRows = comp.competitors.slice(0, 6).map((c: any, i: number) => [
          `#${i + 1}`,
          c.name || "N/A",
          (c.estimatedRanking || "N/A").toUpperCase(),
          (c.strengths || []).slice(0, 2).join("; ") || "N/A",
        ]);
        drawTable(compHeaders, compRows, compColW);

        // Detailed competitor info
        comp.competitors.slice(0, 4).forEach((c: any, i: number) => {
          checkPage(60);
          h2(`${i + 1}. ${c.name || "Competitor"} (${(c.estimatedRanking || "N/A").toUpperCase()})`);
          if (c.contentStrategy) kvLine("Content Strategy", c.contentStrategy.slice(0, 200));
          if (c.keyPages?.length) kvLine("Key Pages", c.keyPages.slice(0, 5).join(", "));
          if (c.estimatedKeywords?.length) kvLine("Target Keywords", c.estimatedKeywords.slice(0, 6).join(", "));
          doc.moveDown(0.3);
        });

        if (comp.industryInsights) {
          h2("Industry Insights");
          if (comp.industryInsights.topRankingFactors?.length) {
            kvLine("Top Ranking Factors", "");
            comp.industryInsights.topRankingFactors.slice(0, 4).forEach((f: string) => bullet(f));
          }
          if (comp.industryInsights.contentGapOpportunities?.length) {
            doc.moveDown(0.2);
            kvLine("Gap Opportunities", "");
            comp.industryInsights.contentGapOpportunities.slice(0, 3).forEach((g: string) => bullet(g));
          }
        }
        if (comp.competitiveAdvantage) {
          doc.moveDown(0.3);
          h2("Your Competitive Advantage");
          p(comp.competitiveAdvantage);
        }
      }

      // ============================================================
      // PAGE 6: KEYWORD OPPORTUNITIES
      // ============================================================
      if (kw.primaryKeywords?.length) {
        doc.addPage(); addHeader();
        h1("Keyword Opportunities");

        // Difficulty distribution
        const diffCounts = { low: 0, medium: 0, high: 0 };
        kw.primaryKeywords.forEach((k: any) => {
          const d = (k.difficulty || "medium").toLowerCase();
          if (d in diffCounts) diffCounts[d as keyof typeof diffCounts]++;
        });

        h2("Keyword Difficulty Distribution");
        drawBarChart([
          { label: "Easy Wins (Low)", value: diffCounts.low, color: GREEN },
          { label: "Moderate (Medium)", value: diffCounts.medium, color: YELLOW },
          { label: "Competitive (High)", value: diffCounts.high, color: RED },
        ], Math.max(diffCounts.low, diffCounts.medium, diffCounts.high, 1));

        // Keywords table
        h2("Top Target Keywords");
        const kwHeaders = ["Keyword", "Intent", "Difficulty", "Priority"];
        const kwColW = [contentW * 0.4, contentW * 0.2, contentW * 0.2, contentW * 0.2];
        const kwRows = kw.primaryKeywords.slice(0, 15).map((k: any) => [
          k.keyword || "",
          k.searchIntent || "",
          k.difficulty || "",
          k.priority || "",
        ]);
        drawTable(kwHeaders, kwRows, kwColW);

        if (kw.longTailKeywords?.length) {
          h2("Long-Tail Opportunities");
          kw.longTailKeywords.slice(0, 8).forEach((k: any) => {
            bullet(`${k.keyword} \u2192 ${k.targetPage || "unassigned"} (${k.searchIntent || "N/A"})`);
          });
        }

        if (kw.localKeywords?.length) {
          doc.moveDown(0.3);
          h2("Local Keywords");
          kw.localKeywords.slice(0, 8).forEach((k: any) => { bullet(`${k.keyword} (${k.type || "local"})`); });
        }

        if (kw.questionKeywords?.length) {
          doc.moveDown(0.3);
          h2("Question Keywords");
          kw.questionKeywords.slice(0, 8).forEach((k: any) => { bullet(`${k.question} \u2192 ${k.suggestedContentType || "FAQ"}`); });
        }
      }

      // ============================================================
      // PAGE 7: SITE STRUCTURE
      // ============================================================
      if (theme?.pages?.length) {
        doc.addPage(); addHeader();
        h1("Site Structure Overview");
        const structHeaders = ["#", "Page", "Purpose", "Sections"];
        const structColW = [contentW * 0.08, contentW * 0.22, contentW * 0.45, contentW * 0.25];
        const structRows = theme.pages.map((pg: any, i: number) => [
          String(i + 1),
          pg.pageName || "Page",
          (pg.purpose || "").slice(0, 60),
          `${pg.sections?.length || 0} sections`,
        ]);
        drawTable(structHeaders, structRows, structColW);
      }

      // ============================================================
      // PAGE 8: RECOMMENDATIONS
      // ============================================================
      doc.addPage(); addHeader();
      h1("Recommendations");

      const recommendations = [
        { priority: "HIGH", text: "Optimize title tags and meta descriptions for every page" },
        { priority: "HIGH", text: "Implement Schema.org structured data for rich snippets" },
        { priority: "HIGH", text: "Create content targeting identified keyword gaps" },
      ];
      // Inject dynamic weaknesses
      if (analysis.weaknesses?.length) {
        analysis.weaknesses.slice(0, 3).forEach((w: string) => {
          recommendations.push({ priority: "HIGH", text: w });
        });
      }
      recommendations.push(
        { priority: "MED", text: "Build internal linking structure between key pages" },
        { priority: "MED", text: "Optimize images with descriptive alt text and compression" },
        { priority: "MED", text: "Submit XML sitemap and verify Google Search Console" },
        { priority: "LOW", text: "Set up review acquisition strategy for local SEO" },
        { priority: "LOW", text: "Implement social media Open Graph tags on all pages" },
      );

      const recHeaders = ["Priority", "Recommendation"];
      const recColW = [contentW * 0.15, contentW * 0.85];
      const recRows = recommendations.slice(0, 12).map(r => [r.priority, r.text]);
      drawTable(recHeaders, recRows, recColW);

      // CTA Section
      doc.moveDown(1);
      checkPage(80);
      doc.rect(45, doc.y, contentW, 70).fill(LIGHT_TEAL_BG);
      doc.rect(45, doc.y, contentW, 3).fill(TEAL);
      const ctaTop = doc.y;
      doc.fontSize(14).fillColor(DARK).text("Ready for the Full SEO Blueprint?", 60, ctaTop + 14, { width: contentW - 30 });
      doc.fontSize(9).fillColor(MUTED).text(
        "Get a complete page-by-page SOP with optimized content, meta tags, schema markup, developer notes, and a content calendar \u2014 everything your team needs to build an SEO-optimized website.",
        60, ctaTop + 34, { width: contentW - 30, lineGap: 2 }
      );

      doc.end();
      const pdfBuffer = await pdfPromise;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="SEO-Audit-${(analysis?.businessName || "Report").replace(/[^a-zA-Z0-9]/g, "-")}.pdf"`);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error("Audit PDF generation error:", e);
      res.status(422).json({ error: "Failed to generate audit PDF: " + e.message });
    }
  });

  // Generate PDF
  app.get("/api/projects/:id/pdf", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const project = await storage.getProject(id);
    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.status !== "complete") {
      return res.status(400).json({ error: "Analysis not complete" });
    }

    try {
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 45, right: 45 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      const pdfPromise = new Promise<Buffer>((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
      });

      // Recover all data
      const analysis = recoverData(project.siteAnalysis) || {};
      const comp = recoverData(project.competitors) || {};
      const kw = recoverData(project.keywords) || {};
      const theme = recoverData(project.themeStructure) || {};
      const sopRaw = project.sopContent as any;
      const sop = sopRaw ? {
        summary: recoverData(sopRaw.summary) || {},
        pages: (sopRaw.pages || []).map((p: any) => recoverData(p)),
      } : { summary: {}, pages: [] };

      // SCALZ.AI PDF Color Palette
      const TEAL = "#159394";
      const DARK = "#1a1a1a";
      const MUTED = "#6b7280";
      const TABLE_HEADER = "#1B1B1B";
      const WHITE = "#ffffff";
      const pageW = doc.page.width;
      const contentW = pageW - 90;

      // Footer on every page
      const addFooter = (pageNum: number) => {
        const y = doc.page.height - 35;
        doc.save();
        doc.moveTo(45, y).lineTo(45 + contentW, y).strokeColor(TEAL).lineWidth(0.5).stroke();
        doc.fontSize(7).fillColor(MUTED)
          .text(`Generated by RANKITECT  •  ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 45, y + 6, { width: contentW / 2, align: "left" })
          .text(`Page ${pageNum}`, 45, y + 6, { width: contentW, align: "right" });
        doc.restore();
      };

      let currentPage = 0;
      const addHeader = () => {
        currentPage++;
        doc.rect(0, 0, pageW, 32).fill(TEAL);
        doc.fontSize(8).fillColor(WHITE)
          .text(`SEO BLUEPRINT  —  ${analysis?.businessName || "Report"}`, 45, 10, { align: "center", width: contentW });
        doc.fillColor(DARK);
        doc.y = 46;
        addFooter(currentPage);
      };

      const checkPage = (n: number = 80) => {
        if (doc.y > doc.page.height - 60 - n) { doc.addPage(); addHeader(); }
      };

      const h1 = (t: string) => {
        checkPage(60);
        doc.moveDown(0.3);
        doc.rect(45, doc.y, contentW, 28).fill(TEAL);
        doc.fontSize(13).fillColor(WHITE).text(t.toUpperCase(), 55, doc.y + 7, { width: contentW - 20 });
        doc.fillColor(DARK).moveDown(1.2);
      };

      const h2 = (t: string) => {
        checkPage(40);
        doc.moveDown(0.2);
        doc.fontSize(11).fillColor(TEAL).text(t, { underline: false });
        doc.moveTo(45, doc.y).lineTo(45 + contentW, doc.y).strokeColor(TEAL).lineWidth(0.5).stroke();
        doc.fillColor(DARK).moveDown(0.4);
      };

      const p = (t: string) => { checkPage(25); doc.fontSize(9).fillColor(DARK).text(t, { lineGap: 2.5 }); doc.moveDown(0.2); };
      const pMuted = (t: string) => { checkPage(25); doc.fontSize(8.5).fillColor(MUTED).text(t, { lineGap: 2 }); doc.moveDown(0.15); };
      const bullet = (t: string) => { checkPage(20); doc.fontSize(9).fillColor(DARK).text(`  \u2022  ${t}`, { indent: 8, lineGap: 1.5 }); };
      const kvLine = (k: string, v: string) => { checkPage(20); doc.fontSize(9).fillColor(TEAL).text(k + ": ", { continued: true }).fillColor(DARK).text(v || "N/A"); };

      // Helper: draw a simple table
      const drawTable = (headers: string[], rows: string[][], colWidths: number[]) => {
        const rowH = 18;
        const startX = 45;
        // Header row
        checkPage(rowH * (rows.length + 2));
        let x = startX;
        doc.rect(startX, doc.y, contentW, rowH).fill(TABLE_HEADER);
        headers.forEach((h, i) => {
          doc.fontSize(8).fillColor(WHITE).text(h, x + 4, doc.y + 4, { width: colWidths[i] - 8, align: "left" });
          x += colWidths[i];
        });
        doc.y += rowH;
        // Data rows
        rows.forEach((row, rowIdx) => {
          if (doc.y > doc.page.height - 80) { doc.addPage(); addHeader(); }
          const bgColor = rowIdx % 2 === 0 ? "#f9fafb" : WHITE;
          doc.rect(startX, doc.y, contentW, rowH).fill(bgColor);
          x = startX;
          row.forEach((cell, i) => {
            doc.fontSize(8).fillColor(DARK).text(cell || "", x + 4, doc.y + 4, { width: colWidths[i] - 8, align: "left" });
            x += colWidths[i];
          });
          doc.y += rowH;
        });
        doc.fillColor(DARK).moveDown(0.4);
      };

      // Helper: draw a simple bar chart
      const drawBarChart = (items: { label: string; value: number; color?: string }[], maxVal: number, chartWidth: number = contentW) => {
        const barH = 16;
        const labelW = 120;
        items.forEach((item) => {
          checkPage(barH + 4);
          const barW = Math.max(2, ((item.value / maxVal) * (chartWidth - labelW - 40)));
          doc.fontSize(8).fillColor(DARK).text(item.label, 55, doc.y + 2, { width: labelW });
          doc.rect(55 + labelW, doc.y, barW, barH - 4).fill(item.color || TEAL);
          doc.fontSize(7).fillColor(MUTED).text(String(item.value), 55 + labelW + barW + 4, doc.y + 2);
          doc.y += barH;
        });
        doc.moveDown(0.4);
      };

      // ========== COVER PAGE ==========
      currentPage++;
      // White background (for print)
      doc.rect(0, 0, pageW, doc.page.height).fill(WHITE);
      // Top teal accent bar
      doc.rect(0, 0, pageW, 8).fill(TEAL);
      // Logo placeholder area
      doc.rect(pageW / 2 - 100, 120, 200, 80).lineWidth(1).strokeColor(MUTED).stroke();
      doc.fontSize(10).fillColor(MUTED).text("YOUR LOGO HERE", pageW / 2 - 100, 152, { width: 200, align: "center" });
      // Title
      doc.fontSize(42).fillColor(TEAL).text("SEO", 45, 240, { align: "center", width: contentW });
      doc.fontSize(20).fillColor(DARK).text("BLUEPRINT", { align: "center", width: contentW });
      doc.moveDown(2);
      doc.fontSize(24).fillColor(DARK).text(analysis.businessName || "Local Business", { align: "center", width: contentW });
      doc.moveDown(0.5);
      doc.fontSize(13).fillColor(MUTED).text(analysis.industry || "", { align: "center", width: contentW });
      doc.text(analysis.location || "", { align: "center", width: contentW });
      doc.moveDown(6);
      // Bottom teal bar
      doc.rect(45, doc.y, contentW, 3).fill(TEAL);
      doc.moveDown(1);
      doc.fontSize(10).fillColor(MUTED)
        .text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, { align: "center", width: contentW })
        .text("Powered by RANKITECT by SCALZ.AI", { align: "center", width: contentW });
      addFooter(currentPage);

      // ========== TOC ==========
      doc.addPage(); addHeader();
      doc.fontSize(20).fillColor(TEAL).text("Table of Contents", { align: "center" });
      doc.moveDown(1.5);
      const toc = [
        "1. Executive Summary",
        "2. Current Site Analysis",
        "3. Competitor Research",
        "4. Keyword Strategy",
        "5. Site Structure",
        "6. Technical SEO Checklist",
        "7. Page-by-Page Content & SEO",
        "8. Implementation Timeline",
        "9. Content Calendar & Ongoing Strategy",
      ];
      toc.forEach(item => {
        doc.fontSize(12).fillColor(DARK).text(item, 70, undefined, { lineGap: 10 });
      });

      // ========== 1. EXECUTIVE SUMMARY ==========
      doc.addPage(); addHeader();
      h1("1. Executive Summary");
      const po = sop.summary?.projectOverview || {};
      kvLine("Business", po.businessName || analysis.businessName || "N/A");
      kvLine("Industry", po.industry || analysis.industry || "N/A");
      kvLine("Location", po.location || analysis.location || "N/A");
      kvLine("Target Audience", po.targetAudience || "Local customers");
      kvLine("Primary Goal", po.primaryGoal || "Generate leads");
      doc.moveDown(0.5);
      if (po.competitivePosition) { h2("Competitive Position"); p(po.competitivePosition); }

      // Score cards
      doc.moveDown(0.5);
      h2("SEO Health Snapshot");
      const scores = [
        { label: "Keyword Opportunities", value: (kw.primaryKeywords?.length || 0) + (kw.longTailKeywords?.length || 0), color: TEAL },
        { label: "Content Gaps", value: analysis.contentGaps?.length || 0, color: "#ef4444" },
        { label: "Competitors Analyzed", value: comp.competitors?.length || 0, color: "#6600FF" },
        { label: "Pages Planned", value: sop.pages?.length || 0, color: "#C41BD1" },
      ];
      drawBarChart(scores, Math.max(...scores.map(s => s.value), 1));

      // ========== 2. SITE ANALYSIS ==========
      doc.addPage(); addHeader();
      h1("2. Current Site Analysis");
      kvLine("URL", project.businessUrl);
      doc.moveDown(0.3);

      if (analysis.currentMeta) {
        h2("Current SEO Meta");
        kvLine("Title Tag", analysis.currentMeta.title || "Not set");
        kvLine("Meta Description", analysis.currentMeta.description || "Not set");
        kvLine("Schema Markup", analysis.currentMeta.hasSchema ? "Yes" : "No");
        kvLine("Open Graph", analysis.currentMeta.hasOpenGraph ? "Yes" : "No");
      }

      if (analysis.services?.length) { h2("Services Identified"); analysis.services.forEach((s: string) => bullet(s)); }
      if (analysis.strengths?.length) { doc.moveDown(0.3); h2("SEO Strengths"); analysis.strengths.forEach((s: string) => bullet(s)); }
      if (analysis.weaknesses?.length) { doc.moveDown(0.3); h2("SEO Weaknesses"); analysis.weaknesses.forEach((w: string) => bullet(w)); }
      if (analysis.contentGaps?.length) { doc.moveDown(0.3); h2("Content Gaps"); analysis.contentGaps.forEach((g: string) => bullet(g)); }

      // ========== 3. COMPETITORS ==========
      doc.addPage(); addHeader();
      h1("3. Competitor Research");
      if (comp.competitors?.length) {
        // Competitor table
        const compHeaders = ["Competitor", "Ranking", "Key Strengths"];
        const compColWidths = [contentW * 0.25, contentW * 0.15, contentW * 0.6];
        const compRows = comp.competitors.map((c: any) => [
          c.name || "N/A",
          (c.estimatedRanking || "N/A").toUpperCase(),
          (c.strengths || []).slice(0, 2).join("; ") || "N/A",
        ]);
        drawTable(compHeaders, compRows, compColWidths);

        // Detailed competitor cards
        comp.competitors.forEach((c: any, i: number) => {
          checkPage(100);
          h2(`${i + 1}. ${c.name} (${c.estimatedRanking || "N/A"} ranking)`);
          if (c.contentStrategy) kvLine("Content Strategy", c.contentStrategy);
          if (c.keyPages?.length) kvLine("Key Pages", c.keyPages.join(", "));
          if (c.estimatedKeywords?.length) kvLine("Target Keywords", c.estimatedKeywords.slice(0, 8).join(", "));
          doc.moveDown(0.3);
        });
      }
      if (comp.industryInsights) {
        doc.moveDown(0.3);
        h2("Industry Insights");
        if (comp.industryInsights.topRankingFactors?.length) { kvLine("Top Ranking Factors", ""); comp.industryInsights.topRankingFactors.forEach((f: string) => bullet(f)); }
        if (comp.industryInsights.localSEOTactics?.length) { kvLine("Local SEO Tactics", ""); comp.industryInsights.localSEOTactics.forEach((t: string) => bullet(t)); }
        if (comp.industryInsights.contentGapOpportunities?.length) { kvLine("Gap Opportunities", ""); comp.industryInsights.contentGapOpportunities.forEach((g: string) => bullet(g)); }
      }
      if (comp.competitiveAdvantage) { doc.moveDown(0.3); h2("Competitive Advantage"); p(comp.competitiveAdvantage); }

      // ========== 4. KEYWORDS ==========
      doc.addPage(); addHeader();
      h1("4. Keyword Strategy");
      if (kw.primaryKeywords?.length) {
        h2("Primary Keywords");
        const kwHeaders = ["Keyword", "Intent", "Difficulty", "Priority"];
        const kwColWidths = [contentW * 0.4, contentW * 0.2, contentW * 0.2, contentW * 0.2];
        const kwRows = kw.primaryKeywords.slice(0, 20).map((k: any) => [
          k.keyword || "",
          k.searchIntent || "",
          k.difficulty || "",
          k.priority || "",
        ]);
        drawTable(kwHeaders, kwRows, kwColWidths);
      }

      // Keyword difficulty distribution chart
      if (kw.primaryKeywords?.length) {
        h2("Keyword Difficulty Distribution");
        const diffCounts = { low: 0, medium: 0, high: 0 };
        kw.primaryKeywords.forEach((k: any) => {
          const d = (k.difficulty || "medium").toLowerCase();
          if (d in diffCounts) diffCounts[d as keyof typeof diffCounts]++;
        });
        drawBarChart([
          { label: "Low Difficulty", value: diffCounts.low, color: "#10b981" },
          { label: "Medium Difficulty", value: diffCounts.medium, color: "#f59e0b" },
          { label: "High Difficulty", value: diffCounts.high, color: "#ef4444" },
        ], Math.max(diffCounts.low, diffCounts.medium, diffCounts.high, 1));
      }

      if (kw.longTailKeywords?.length) {
        h2("Long-Tail Keywords");
        kw.longTailKeywords.slice(0, 15).forEach((k: any) => {
          bullet(`${k.keyword} → ${k.targetPage || "unassigned"} (${k.searchIntent || "N/A"})`);
        });
      }
      if (kw.localKeywords?.length) {
        doc.moveDown(0.3);
        h2("Local Keywords");
        kw.localKeywords.slice(0, 10).forEach((k: any) => { bullet(`${k.keyword} (${k.type || "local"})`); });
      }
      if (kw.questionKeywords?.length) {
        doc.moveDown(0.3);
        h2("Question Keywords");
        kw.questionKeywords.slice(0, 10).forEach((k: any) => { bullet(`${k.question} → ${k.suggestedContentType || "FAQ"}`); });
      }

      // ========== 5. SITE STRUCTURE ==========
      doc.addPage(); addHeader();
      h1("5. Site Structure");
      if (theme.pages?.length) {
        theme.pages.forEach((pg: any, i: number) => {
          checkPage(50);
          h2(`${i + 1}. ${pg.pageName} — ${pg.purpose || ""}`);
          if (pg.sections?.length) {
            pg.sections.forEach((s: any) => {
              bullet(`[${s.type || "content"}] ${s.sectionName}: ${s.description || ""}`);
            });
          }
          doc.moveDown(0.2);
        });
      }
      if (theme.globalElements) {
        h2("Global Elements");
        if (theme.globalElements.header) kvLine("Header", theme.globalElements.header);
        if (theme.globalElements.footer) kvLine("Footer", theme.globalElements.footer);
        if (theme.globalElements.navigation) kvLine("Navigation", theme.globalElements.navigation);
      }

      // ========== 6. TECHNICAL SEO ==========
      doc.addPage(); addHeader();
      h1("6. Technical SEO Checklist");
      if (sop.summary?.technicalSEOChecklist?.length) {
        const checkHeaders = ["Task", "Priority", "Category"];
        const checkColWidths = [contentW * 0.55, contentW * 0.2, contentW * 0.25];
        const checkRows = sop.summary.technicalSEOChecklist.map((item: any) => [
          item.task || "",
          (item.priority || "").toUpperCase(),
          item.category || "",
        ]);
        drawTable(checkHeaders, checkRows, checkColWidths);
      }
      const swr = sop.summary?.siteWideRequirements;
      if (swr) {
        h2("Site-Wide Requirements");
        if (swr.xmlSitemap) kvLine("XML Sitemap", swr.xmlSitemap);
        if (swr.robotsTxt) kvLine("robots.txt", swr.robotsTxt);
        if (swr.sslCertificate) kvLine("SSL", swr.sslCertificate);
        if (swr.mobileResponsive) kvLine("Mobile", swr.mobileResponsive);
        if (swr.pageSpeed) kvLine("Page Speed", swr.pageSpeed);
        if (swr.coreWebVitals) kvLine("Core Web Vitals", swr.coreWebVitals);
        if (swr.analytics) kvLine("Analytics", swr.analytics);
        if (swr.localSEO) {
          doc.moveDown(0.3); h2("Local SEO Requirements");
          kvLine("Google Business Profile", swr.localSEO.googleBusinessProfile || "Optimize listing");
          kvLine("Local Citations", swr.localSEO.localCitations || "Ensure NAP consistency");
          kvLine("Schema", swr.localSEO.localSchema || "LocalBusiness markup");
          kvLine("Reviews", swr.localSEO.reviewStrategy || "Encourage reviews");
        }
      }

      // ========== 7. PAGE-BY-PAGE ==========
      if (sop.pages?.length) {
        sop.pages.forEach((sopPage: any, idx: number) => {
          doc.addPage(); addHeader();
          h1(`7.${idx + 1} Page: ${sopPage.pageName || "Page " + (idx + 1)}`);

          if (sopPage.seo) {
            h2("SEO Meta Tags");
            kvLine("Title Tag", sopPage.seo.titleTag || "N/A");
            kvLine("Meta Description", sopPage.seo.metaDescription || "N/A");
            kvLine("H1", sopPage.seo.h1 || "N/A");
            kvLine("Canonical", sopPage.seo.canonicalUrl || "N/A");
            kvLine("OG Title", sopPage.seo.ogTitle || "N/A");
            kvLine("OG Description", sopPage.seo.ogDescription || "N/A");
            kvLine("OG Image", sopPage.seo.ogImage || "N/A");
          }

          if (sopPage.schema) {
            doc.moveDown(0.3); h2(`Schema Markup (${sopPage.schema.type || "N/A"})`);
            if (sopPage.schema.markup) {
              const schemaStr = typeof sopPage.schema.markup === "string" ? sopPage.schema.markup : JSON.stringify(sopPage.schema.markup, null, 2);
              checkPage(50);
              doc.fontSize(7).fillColor(MUTED).text(schemaStr.slice(0, 800), { lineGap: 1 });
              doc.fillColor(DARK);
            }
          }

          if (sopPage.sections?.length) {
            sopPage.sections.forEach((section: any) => {
              checkPage(60);
              const sType = section.sectionType ? ` [${section.sectionType}]` : "";
              h2(`Section: ${section.sectionName || "Content"}${sType}`);
              if (section.heading) kvLine("H2", section.heading);
              if (section.subheading) kvLine("H3", section.subheading);
              if (section.content) { doc.moveDown(0.2); p(section.content); }
              if (section.bulletPoints?.length) section.bulletPoints.forEach((bp: string) => bullet(bp));

              // Card items (services, features)
              if (section.cardItems?.length) {
                doc.moveDown(0.1);
                section.cardItems.forEach((card: any) => {
                  checkPage(25);
                  doc.fontSize(9).fillColor(TEAL).text(`  \u25B8 ${card.title}`, { continued: false });
                  if (card.description) pMuted(`    ${card.description}`);
                });
              }

              // Testimonials
              if (section.testimonials?.length) {
                doc.moveDown(0.1);
                section.testimonials.forEach((t: any) => {
                  checkPage(35);
                  doc.fontSize(8.5).fillColor(MUTED).text(`  "${t.quote}"`, { indent: 8, lineGap: 1.5 });
                  doc.fontSize(8).fillColor(DARK).text(`    — ${t.author}${t.role ? ", " + t.role : ""}${t.rating ? " (" + "\u2605".repeat(t.rating) + ")" : ""}`);
                  doc.moveDown(0.2);
                });
              }

              // Stats
              if (section.stats?.length) {
                doc.moveDown(0.1);
                section.stats.forEach((s: any) => { checkPage(18); bullet(`${s.number} — ${s.label}`); });
              }

              // FAQ items
              if (section.faqItems?.length) {
                doc.moveDown(0.1);
                section.faqItems.forEach((faq: any) => {
                  checkPage(35);
                  doc.fontSize(9).fillColor(TEAL).text(`  Q: ${faq.question}`);
                  doc.fontSize(8.5).fillColor(MUTED).text(`  A: ${faq.answer}`, { indent: 8, lineGap: 1.5 });
                  doc.moveDown(0.15);
                });
              }

              // Form config
              if (section.formConfig) {
                doc.moveDown(0.1);
                kvLine("Form", section.formConfig.heading || "Contact Form");
                if (section.formConfig.fields?.length) kvLine("Fields", section.formConfig.fields.join(", "));
                if (section.formConfig.submitText) kvLine("Submit Button", section.formConfig.submitText);
                if (section.formConfig.privacyNote) pMuted(`Privacy: ${section.formConfig.privacyNote}`);
              }

              // CTA
              if (section.cta) {
                doc.moveDown(0.1);
                kvLine("CTA Button", `"${section.cta.text}" → ${section.cta.action}`);
                if (section.cta.subtext) pMuted(`  ${section.cta.subtext}`);
              }

              // Images
              if (section.images?.length) {
                section.images.forEach((img: any) => {
                  checkPage(30);
                  doc.moveDown(0.1);
                  kvLine("Image", img.description || "N/A");
                  kvLine("Alt Text", `"${img.altText || "N/A"}"`);
                  if (img.titleAttr) kvLine("Title", `"${img.titleAttr}"`);
                  if (img.dimensions) kvLine("Size", img.dimensions);
                });
              }
            });
          }

          if (sopPage.internalLinks?.length) {
            doc.moveDown(0.3); h2("Internal Links");
            sopPage.internalLinks.forEach((link: any) => { bullet(`"${link.anchorText}" → ${link.targetPage} (${link.context})`); });
          }
          if (sopPage.devNotes) {
            doc.moveDown(0.3); h2("Developer Notes");
            if (sopPage.devNotes.technicalSEO?.length) sopPage.devNotes.technicalSEO.forEach((n: string) => bullet(n));
            if (sopPage.devNotes.performanceNotes) kvLine("Performance", sopPage.devNotes.performanceNotes);
            if (sopPage.devNotes.accessibilityNotes) kvLine("Accessibility", sopPage.devNotes.accessibilityNotes);
          }
        });
      }

      // ========== 8. TIMELINE ==========
      doc.addPage(); addHeader();
      h1("8. Implementation Timeline");
      if (sop.summary?.implementationPriority?.length) {
        sop.summary.implementationPriority.forEach((phase: any) => {
          checkPage(60);
          h2(`${phase.phase} (${phase.timeline || "TBD"})`);
          if (phase.tasks?.length) phase.tasks.forEach((task: string) => bullet(task));
          doc.moveDown(0.4);
        });
      }

      // ========== 9. CONTENT CALENDAR ==========
      doc.addPage(); addHeader();
      h1("9. Content Calendar & Ongoing Strategy");
      if (sop.summary?.contentStrategy) {
        const cs = sop.summary.contentStrategy;
        if (cs.blogCalendar?.length) {
          h2("Blog Content Calendar");
          cs.blogCalendar.forEach((month: any) => {
            checkPage(40);
            doc.fontSize(9).fillColor(TEAL).text(month.month + ":");
            if (month.topics?.length) month.topics.forEach((topic: string) => bullet(topic));
            doc.moveDown(0.2);
          });
        }
        if (cs.linkBuildingStrategy) { doc.moveDown(0.3); h2("Link Building Strategy"); p(cs.linkBuildingStrategy); }
        if (cs.socialMediaIntegration) { doc.moveDown(0.3); h2("Social Media Integration"); p(cs.socialMediaIntegration); }
      }
      if (kw.contentCalendarKeywords?.length) {
        doc.moveDown(0.4); h2("Content Ideas by Keyword");
        kw.contentCalendarKeywords.forEach((item: any) => {
          checkPage(25);
          bullet(`${item.topic} (${item.contentType || "blog"}) — Keywords: ${item.targetKeywords?.join(", ") || "N/A"}`);
        });
      }

      doc.end();
      const pdfBuffer = await pdfPromise;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="SEO-Blueprint-${(analysis?.businessName || "Report").replace(/[^a-zA-Z0-9]/g, "-")}.pdf"`);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error("PDF generation error:", e);
      res.status(422).json({ error: "Failed to generate PDF: " + e.message });
    }
  });

  // =============================================
  // FREE AUDIT LEAD GEN
  // =============================================
  const leads: Array<{ id: number; name: string; email: string; url: string; createdAt: string; auditScore: number | null }> = [];
  let leadId = 1;

  // Save lead + run lite audit
  app.post("/api/free-audit", async (req: Request, res: Response) => {
    const { name, email, url } = req.body;
    if (!name || !email || !url) return res.status(400).json({ error: "Name, email, and URL are required" });
    try {
      console.log(`[Free Audit] Lead: ${name} <${email}> — ${url}`);
      const lead = { id: leadId++, name, email, url, createdAt: new Date().toISOString(), auditScore: null as number | null };
      leads.push(lead);
      const result = await runLiteAnalysis(url);
      lead.auditScore = result.overallScore || null;
      res.json({ leadId: lead.id, audit: result });
    } catch (err: any) {
      console.error("Free audit error:", err);
      res.status(500).json({ error: "Analysis failed: " + err.message });
    }
  });

  // Get all leads (admin)
  app.get("/api/leads", (_req: Request, res: Response) => {
    res.json(leads);
  });

  // Export leads as CSV
  app.get("/api/leads/export", (_req: Request, res: Response) => {
    const header = "ID,Name,Email,URL,Score,Date";
    const rows = leads.map(l => `${l.id},"${l.name}","${l.email}","${l.url}",${l.auditScore ?? ""},"${l.createdAt}"`);
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=rankitect-leads.csv");
    res.send(csv);
  });

  // Free audit PDF download
  app.post("/api/free-audit/pdf", async (req: Request, res: Response) => {
    const { audit, name, url } = req.body;
    if (!audit) return res.status(400).json({ error: "Audit data required" });
    try {
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ size: "A4", margin: 45, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));

      const TEAL = "#159394";
      const PURPLE = "#C41BD1";
      const DARK = "#1a1a1a";
      const MUTED = "#6b7280";
      const GREEN = "#22c55e";
      const RED = "#ef4444";
      const YELLOW = "#f59e0b";
      const WHITE = "#ffffff";
      const TABLE_HEADER = "#1B1B1B";
      const LIGHT_GREEN_BG = "#f0fdf4";
      const LIGHT_RED_BG = "#fef2f2";
      const LIGHT_TEAL_BG = "#f0fdfa";
      const LIGHT_YELLOW_BG = "#fffbeb";
      const LIGHT_GRAY = "#f3f4f6";
      const pageW = doc.page.width;
      const contentW = pageW - 90;

      const score = audit.overallScore || 0;
      const scoreColor = score >= 75 ? GREEN : score >= 50 ? YELLOW : RED;
      const scoreLabel = score >= 75 ? "Good" : score >= 50 ? "Needs Work" : "Critical";
      const bizName = audit.businessName || name || "Website";
      const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      let currentPage = 0;
      const addFooter = (pageNum: number) => {
        const y = doc.page.height - 35;
        doc.save();
        doc.moveTo(45, y).lineTo(45 + contentW, y).strokeColor(TEAL).lineWidth(0.5).stroke();
        doc.fontSize(7).fillColor(MUTED)
          .text(`RANKITECT by SCALZ.AI  \u2022  SEO Audit Report  \u2022  ${dateStr}`, 45, y + 6, { width: contentW / 2, align: "left", lineBreak: false })
          .text(`Page ${pageNum}`, 45, y + 6, { width: contentW, align: "right", lineBreak: false });
        doc.restore();
      };
      const addHeader = () => {
        currentPage++;
        doc.rect(0, 0, pageW, 32).fill(TEAL);
        doc.fontSize(8).fillColor(WHITE).text(`SEO AUDIT  \u2014  ${bizName}`, 45, 10, { align: "center", width: contentW });
        doc.fillColor(DARK); doc.y = 46;
        addFooter(currentPage);
      };
      const checkPage = (n: number = 80) => {
        if (doc.y > doc.page.height - 60 - n) { doc.addPage(); addHeader(); }
      };
      const h1 = (t: string) => { checkPage(60); doc.moveDown(0.3); doc.rect(45, doc.y, contentW, 28).fill(TEAL); doc.fontSize(13).fillColor(WHITE).text(t.toUpperCase(), 55, doc.y + 7, { width: contentW - 20 }); doc.fillColor(DARK).moveDown(1.2); };
      const h2 = (t: string) => { checkPage(40); doc.moveDown(0.2); doc.fontSize(11).fillColor(TEAL).text(t); doc.moveTo(45, doc.y).lineTo(45 + contentW, doc.y).strokeColor(TEAL).lineWidth(0.5).stroke(); doc.fillColor(DARK).moveDown(0.4); };
      const p = (t: string) => { checkPage(25); doc.fontSize(9).fillColor(DARK).text(t, { lineGap: 2.5 }); doc.moveDown(0.2); };
      const pMuted = (t: string) => { checkPage(20); doc.fontSize(8.5).fillColor(MUTED).text(t, { lineGap: 2 }); doc.moveDown(0.15); };
      const bullet = (t: string) => { checkPage(20); doc.fontSize(9).fillColor(DARK).text(`  \u2022  ${t}`, { indent: 8, lineGap: 1.5 }); };
      const kvLine = (k: string, v: string) => { checkPage(20); doc.fontSize(9).fillColor(TEAL).text(k + ": ", { continued: true }).fillColor(DARK).text(v || "N/A"); };

      // Table helper
      const drawTable = (headers: string[], rows: string[][], colWidths: number[]) => {
        const rowH = 20;
        const startX = 45;
        checkPage(rowH * Math.min(rows.length + 2, 8));
        let x = startX;
        doc.rect(startX, doc.y, contentW, rowH).fill(TABLE_HEADER);
        headers.forEach((h, i) => {
          doc.fontSize(7.5).fillColor(WHITE).text(h.toUpperCase(), x + 4, doc.y + 5, { width: colWidths[i] - 8, align: "left" });
          x += colWidths[i];
        });
        doc.y += rowH;
        rows.forEach((row, rowIdx) => {
          if (doc.y > doc.page.height - 80) { doc.addPage(); addHeader(); }
          const bgColor = rowIdx % 2 === 0 ? "#f9fafb" : WHITE;
          doc.rect(startX, doc.y, contentW, rowH).fill(bgColor);
          x = startX;
          row.forEach((cell, i) => {
            const isStatus = i === 1 && (cell === "PASS" || cell === "WARN" || cell === "FAIL");
            const clr = isStatus ? (cell === "PASS" ? GREEN : cell === "WARN" ? YELLOW : RED) : DARK;
            doc.fontSize(8).fillColor(clr).text(cell || "", x + 4, doc.y + 5, { width: colWidths[i] - 8, align: "left" });
            x += colWidths[i];
          });
          doc.y += rowH;
        });
        doc.fillColor(DARK).moveDown(0.4);
      };

      // Bar chart helper
      const drawBarChart = (items: { label: string; value: number; color?: string }[], maxVal: number) => {
        const barH = 18;
        const labelW = 100;
        items.forEach((item) => {
          checkPage(barH + 4);
          const barW = Math.max(4, ((item.value / maxVal) * (contentW - labelW - 60)));
          doc.fontSize(8).fillColor(DARK).text(item.label, 55, doc.y + 3, { width: labelW });
          doc.rect(55 + labelW, doc.y, barW, barH - 6).fill(item.color || TEAL);
          doc.fontSize(7.5).fillColor(MUTED).text(String(item.value), 55 + labelW + barW + 4, doc.y + 3);
          doc.y += barH;
        });
        doc.moveDown(0.4);
      };

      const statusIcon = (s: string) => s === "PASS" ? "\u2705" : s === "WARN" ? "\u26A0" : "\u274C";

      // ================================================================
      // COVER PAGE
      // ================================================================
      currentPage++;
      doc.rect(0, 0, pageW, doc.page.height).fill(WHITE);
      doc.rect(0, 0, pageW, 8).fill(TEAL);
      doc.rect(0, doc.page.height - 8, pageW, 8).fill(TEAL);
      // Left accent bars
      doc.rect(45, 90, 4, 60).fill(TEAL);
      doc.rect(52, 100, 2, 30).fill(PURPLE);

      doc.fontSize(10).fillColor(TEAL).text("SEO AUDIT REPORT", 60, 95);
      doc.fontSize(38).fillColor(DARK).text("Website", 60, 112);
      doc.fontSize(38).fillColor(TEAL).text("Health Check", 60, 148);

      // Client info card
      const ciY = 210;
      doc.rect(45, ciY, contentW, 65).fill(LIGHT_TEAL_BG);
      doc.rect(45, ciY, contentW, 3).fill(TEAL);
      doc.fontSize(8).fillColor(MUTED).text("PREPARED FOR", 60, ciY + 12);
      doc.fontSize(20).fillColor(DARK).text(bizName, 60, ciY + 25);
      doc.fontSize(9).fillColor(MUTED).text(url || "", 60, ciY + 48);
      if (audit.industry) doc.fontSize(9).fillColor(MUTED).text(audit.industry, 60 + contentW / 2, ciY + 48);

      // Score card
      const scoreBoxY = 295;
      doc.rect(45, scoreBoxY, contentW, 110).fill(LIGHT_GRAY);
      doc.rect(45, scoreBoxY, contentW, 3).fill(scoreColor);
      doc.fontSize(9).fillColor(MUTED).text("OVERALL SEO HEALTH SCORE", 45, scoreBoxY + 10, { width: contentW, align: "center" });
      doc.fontSize(56).fillColor(scoreColor).text(String(score), 45, scoreBoxY + 26, { width: contentW, align: "center" });
      doc.fontSize(14).fillColor(scoreColor).text(scoreLabel.toUpperCase(), 45, scoreBoxY + 84, { width: contentW, align: "center" });

      // Category score cards
      const cs = audit.categoryScores || {};
      const catScores = [
        { label: "Technical SEO", val: cs.technicalSEO || 0 },
        { label: "On-Page SEO", val: cs.onPageSEO || 0 },
        { label: "Content", val: cs.content || 0 },
        { label: "Social", val: cs.socialPresence || 0 },
        { label: "Performance", val: cs.performance || 0 },
      ];
      const csY = 425;
      const csW = contentW / 5;
      catScores.forEach((c, i) => {
        const sx = 45 + i * csW;
        const clr = c.val >= 75 ? GREEN : c.val >= 50 ? YELLOW : RED;
        const bg = c.val >= 75 ? LIGHT_GREEN_BG : c.val >= 50 ? LIGHT_YELLOW_BG : LIGHT_RED_BG;
        doc.rect(sx + 2, csY, csW - 4, 55).fill(bg);
        doc.rect(sx + 2, csY, csW - 4, 2).fill(clr);
        doc.fontSize(24).fillColor(clr).text(String(c.val), sx + 2, csY + 10, { width: csW - 4, align: "center" });
        doc.fontSize(7).fillColor(MUTED).text(c.label.toUpperCase(), sx + 2, csY + 38, { width: csW - 4, align: "center" });
      });

      // Summary text on cover
      if (audit.summary) {
        doc.fontSize(9).fillColor(DARK).text(audit.summary, 45, 500, { width: contentW, lineGap: 3 });
      }

      doc.fontSize(8).fillColor(MUTED).text(
        `Generated ${dateStr}  \u2022  Powered by RANKITECT by SCALZ.AI`,
        45, doc.page.height - 55, { width: contentW, align: "center" }
      );
      addFooter(currentPage);

      // ================================================================
      // PAGE 2: TECHNICAL SEO AUDIT
      // ================================================================
      doc.addPage(); addHeader();
      h1("Technical SEO Audit");
      if (audit.technicalSEO?.length) {
        const techHeaders = ["Check", "Status", "Finding", "Recommendation"];
        const techColW = [contentW * 0.16, contentW * 0.1, contentW * 0.37, contentW * 0.37];
        const techRows = audit.technicalSEO.map((t: any) => [t.check, t.status, t.finding, t.recommendation || ""]);
        drawTable(techHeaders, techRows, techColW);
      }
      // Technical score bar chart
      if (audit.technicalSEO?.length) {
        h2("Check Results");
        const passCount = audit.technicalSEO.filter((t: any) => t.status === "PASS").length;
        const warnCount = audit.technicalSEO.filter((t: any) => t.status === "WARN").length;
        const failCount = audit.technicalSEO.filter((t: any) => t.status === "FAIL").length;
        drawBarChart([
          { label: "Passing", value: passCount, color: GREEN },
          { label: "Warnings", value: warnCount, color: YELLOW },
          { label: "Failing", value: failCount, color: RED },
        ], Math.max(passCount, warnCount, failCount, 1));
      }

      // ================================================================
      // PAGE 3: ON-PAGE SEO
      // ================================================================
      doc.addPage(); addHeader();
      h1("On-Page SEO Analysis");
      if (audit.onPageSEO?.length) {
        audit.onPageSEO.forEach((item: any) => {
          checkPage(55);
          const bgClr = item.status === "PASS" ? LIGHT_GREEN_BG : item.status === "WARN" ? LIGHT_YELLOW_BG : LIGHT_RED_BG;
          const accentClr = item.status === "PASS" ? GREEN : item.status === "WARN" ? YELLOW : RED;
          doc.rect(45, doc.y, contentW, 3).fill(accentClr);
          doc.rect(45, doc.y + 3, contentW, 42).fill(bgClr);
          const cardY = doc.y + 7;
          doc.fontSize(10).fillColor(DARK).text(`${statusIcon(item.status)}  ${item.check}`, 55, cardY);
          doc.fontSize(8).fillColor(MUTED).text(item.finding, 55, cardY + 14, { width: contentW - 30 });
          if (item.recommendation && item.status !== "PASS") {
            doc.fontSize(8).fillColor(TEAL).text(`Fix: ${item.recommendation}`, 55, cardY + 28, { width: contentW - 30 });
          }
          doc.y += 50;
          doc.moveDown(0.15);
        });
      }

      // ================================================================
      // PAGE 4: SOCIAL & SHARING
      // ================================================================
      doc.addPage(); addHeader();
      h1("Social Media & Sharing");
      if (audit.socialMedia?.length) {
        audit.socialMedia.forEach((item: any) => {
          checkPage(55);
          const bgClr = item.status === "PASS" ? LIGHT_GREEN_BG : item.status === "WARN" ? LIGHT_YELLOW_BG : LIGHT_RED_BG;
          const accentClr = item.status === "PASS" ? GREEN : item.status === "WARN" ? YELLOW : RED;
          doc.rect(45, doc.y, contentW, 3).fill(accentClr);
          doc.rect(45, doc.y + 3, contentW, 42).fill(bgClr);
          const cardY = doc.y + 7;
          doc.fontSize(10).fillColor(DARK).text(`${statusIcon(item.status)}  ${item.check}`, 55, cardY);
          doc.fontSize(8).fillColor(MUTED).text(item.finding, 55, cardY + 14, { width: contentW - 30 });
          if (item.recommendation && item.status !== "PASS") {
            doc.fontSize(8).fillColor(TEAL).text(`Fix: ${item.recommendation}`, 55, cardY + 28, { width: contentW - 30 });
          }
          doc.y += 50;
          doc.moveDown(0.15);
        });
      }

      // Performance & Accessibility
      doc.moveDown(0.5);
      h1("Performance & Accessibility");
      if (audit.performance?.length) {
        audit.performance.forEach((item: any) => {
          checkPage(55);
          const bgClr = item.status === "PASS" ? LIGHT_GREEN_BG : item.status === "WARN" ? LIGHT_YELLOW_BG : LIGHT_RED_BG;
          const accentClr = item.status === "PASS" ? GREEN : item.status === "WARN" ? YELLOW : RED;
          doc.rect(45, doc.y, contentW, 3).fill(accentClr);
          doc.rect(45, doc.y + 3, contentW, 42).fill(bgClr);
          const cardY = doc.y + 7;
          doc.fontSize(10).fillColor(DARK).text(`${statusIcon(item.status)}  ${item.check}`, 55, cardY);
          doc.fontSize(8).fillColor(MUTED).text(item.finding, 55, cardY + 14, { width: contentW - 30 });
          if (item.recommendation && item.status !== "PASS") {
            doc.fontSize(8).fillColor(TEAL).text(`Fix: ${item.recommendation}`, 55, cardY + 28, { width: contentW - 30 });
          }
          doc.y += 50;
          doc.moveDown(0.15);
        });
      }

      // ================================================================
      // PAGE 5: STRENGTHS
      // ================================================================
      doc.addPage(); addHeader();
      h1("What's Working Well");
      if (audit.strengths?.length) {
        audit.strengths.forEach((s: string) => {
          checkPage(25);
          doc.rect(45, doc.y, contentW, 20).fill(LIGHT_GREEN_BG);
          doc.rect(45, doc.y, 3, 20).fill(GREEN);
          doc.fontSize(9).fillColor(GREEN).text("  \u2713  ", 52, doc.y + 5, { continued: true }).fillColor(DARK).text(s);
          doc.moveDown(0.3);
        });
      } else { p("No specific strengths identified."); }

      // ================================================================
      // PAGE 6: WEAKNESSES
      // ================================================================
      doc.moveDown(0.5);
      h1("Issues & Weaknesses Found");
      if (audit.weaknesses?.length) {
        audit.weaknesses.forEach((w: string) => {
          checkPage(25);
          doc.rect(45, doc.y, contentW, 20).fill(LIGHT_RED_BG);
          doc.rect(45, doc.y, 3, 20).fill(RED);
          doc.fontSize(9).fillColor(RED).text("  \u2717  ", 52, doc.y + 5, { continued: true }).fillColor(DARK).text(w);
          doc.moveDown(0.3);
        });
      } else { p("No critical weaknesses found."); }

      // ================================================================
      // PAGE 7: QUICK WINS
      // ================================================================
      doc.addPage(); addHeader();
      h1("Quick Wins \u2014 Priority Actions");
      pMuted("These are the highest-impact, lowest-effort improvements you can make right now.");
      doc.moveDown(0.3);
      if (audit.quickWins?.length) {
        audit.quickWins.forEach((q: any, i: number) => { const qText = typeof q === "string" ? q : q.action ? `${q.action}${q.steps ? " — " + q.steps : ""}` : JSON.stringify(q);
          checkPage(30);
          doc.rect(45, doc.y, contentW, 24).fill(LIGHT_TEAL_BG);
          doc.rect(45, doc.y, 3, 24).fill(TEAL);
          // Priority number circle
          doc.circle(62, doc.y + 12, 8).fill(TEAL);
          doc.fontSize(9).fillColor(WHITE).text(String(i + 1), 55, doc.y + 7, { width: 14, align: "center" });
          doc.fontSize(9).fillColor(DARK).text(qText, 78, doc.y + 7, { width: contentW - 50 });
          doc.moveDown(0.35);
        });
      }

      // ================================================================
      // SCORE SUMMARY BAR CHART
      // ================================================================
      doc.moveDown(0.5);
      h1("Score Breakdown");
      drawBarChart(
        catScores.map(c => ({ label: c.label, value: c.val, color: c.val >= 75 ? GREEN : c.val >= 50 ? YELLOW : RED })),
        100
      );

      // ================================================================
      // CTA PAGE
      // ================================================================
      doc.addPage(); addHeader();
      doc.moveDown(2);

      // CTA box
      doc.rect(45, doc.y, contentW, 200).fill(LIGHT_TEAL_BG);
      doc.rect(45, doc.y, contentW, 4).fill(TEAL);
      const ctaY = doc.y + 20;
      doc.fontSize(22).fillColor(DARK).text("Ready for the Full", 60, ctaY, { width: contentW - 30 });
      doc.fontSize(22).fillColor(TEAL).text("SEO Blueprint?", 60, ctaY + 28, { width: contentW - 30 });
      doc.fontSize(10).fillColor(MUTED).text(
        "This audit shows you what's wrong. The full SOP shows you exactly how to fix it \u2014 with page-by-page content blueprints, keyword targeting, and implementation timelines.",
        60, ctaY + 62, { width: contentW - 40, lineGap: 3 }
      );
      const sopFeatures = [
        "Deep competitor analysis with gap identification",
        "Full keyword research with difficulty scoring",
        "Page-by-page content blueprints with H1/H2/H3 structure",
        "Technical SEO implementation checklist",
        "Content calendar with publishing schedule",
        "Prioritized action plan with timelines",
      ];
      sopFeatures.forEach((f, i) => {
        doc.fontSize(9).fillColor(TEAL).text("\u2713", 72, ctaY + 100 + i * 15).fillColor(DARK).text(`  ${f}`, 82, ctaY + 100 + i * 15);
      });

      doc.moveDown(6);
      doc.rect(45, doc.y, contentW, 40).fill(TEAL);
      doc.fontSize(16).fillColor(WHITE).text("Get Your Full SOP", 45, doc.y + 8, { width: contentW, align: "center" });
      doc.fontSize(10).fillColor(WHITE).text("rankitect.com  \u2022  Starting at $37", 45, doc.y + 26, { width: contentW, align: "center" });

      doc.moveDown(3);
      doc.rect(45, doc.y, contentW, 1).fill(LIGHT_GRAY);
      doc.moveDown(0.5);
      doc.fontSize(8).fillColor(MUTED).text(
        "This report was generated by RANKITECT, an AI-powered SEO analysis platform by SCALZ.AI. For questions or custom enterprise audits, contact us at scalz.ai.",
        45, undefined, { width: contentW, align: "center", lineGap: 2 }
      );

      doc.end();
      await new Promise<void>((resolve) => doc.on("end", resolve));
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="SEO-Audit-${bizName.replace(/[^a-zA-Z0-9]/g, "-")}.pdf"`);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error("Free audit PDF error:", e);
      res.status(500).json({ error: "PDF generation failed: " + e.message });
    }
  });
}

// Background analysis pipeline — pauses after theme analysis for page selection
async function runPipeline(projectId: number, input: any) {
  try {
    await storage.updateProject(projectId, { status: "analyzing_site" });
    const siteAnalysis = await analyzeSite(input.businessUrl);
    await storage.updateProject(projectId, { siteAnalysis });

    if (input.businessName) siteAnalysis.businessName = input.businessName;
    if (input.industry) siteAnalysis.industry = input.industry;
    if (input.location) siteAnalysis.location = input.location;

    await storage.updateProject(projectId, { status: "analyzing_competitors" });
    const competitors = await discoverCompetitors(siteAnalysis);
    await storage.updateProject(projectId, { competitors });

    await storage.updateProject(projectId, { status: "generating_keywords" });
    const keywords = await generateKeywords(siteAnalysis, competitors);
    await storage.updateProject(projectId, { keywords });

    let themeStructure = null;
    if (input.themeUrl) {
      await storage.updateProject(projectId, { status: "analyzing_theme" });
      themeStructure = await analyzeTheme(input.themeUrl);
      await storage.updateProject(projectId, { themeStructure });
    }

    // Update business info and pause for page selection
    await storage.updateProject(projectId, {
      status: "selecting_pages",
      businessName: siteAnalysis.businessName,
      industry: siteAnalysis.industry,
      location: siteAnalysis.location,
    });
    // Pipeline pauses here — user selects pages, then POST /generate-sop triggers the rest
  } catch (e: any) {
    console.error("Pipeline error:", e);
    await storage.updateProject(projectId, { status: "error" });
  }
}

// SOP generation triggered by user after page selection
async function runSOPGeneration(projectId: number, selectedPages: any[]) {
  try {
    await storage.updateProject(projectId, { status: "generating_sop" });
    const project = await storage.getProject(projectId);
    if (!project) throw new Error("Project not found");

    const analysis = recoverData(project.siteAnalysis) || {};
    const competitors = recoverData(project.competitors) || {};
    const keywords = recoverData(project.keywords) || {};
    const themeStructure = recoverData(project.themeStructure) || {};

    // Override theme pages with the user's selected pages
    const customTheme = {
      ...themeStructure,
      pages: selectedPages,
    };

    const sopContent = await generateSOP(analysis, competitors, keywords, customTheme);
    await storage.updateProject(projectId, {
      sopContent,
      status: "complete",
    });
  } catch (e: any) {
    console.error("SOP generation error:", e);
    await storage.updateProject(projectId, { status: "error" });
  }
}
