import { pgTable, text, serial, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Main project table
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  businessUrl: text("business_url").notNull(),
  themeUrl: text("theme_url"),
  businessName: text("business_name"),
  industry: text("industry"),
  location: text("location"),
  status: text("status").notNull().default("pending"),
  // Analysis results stored as JSON
  siteAnalysis: jsonb("site_analysis"),
  competitors: jsonb("competitors"),
  keywords: jsonb("keywords"),
  themeStructure: jsonb("theme_structure"),
  sopContent: jsonb("sop_content"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Zod schemas for API request validation
export const startAnalysisSchema = z.object({
  businessUrl: z.string().url("Please enter a valid URL"),
  themeUrl: z.string().url("Please enter a valid URL").optional().or(z.literal("")),
  businessName: z.string().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
});

export type StartAnalysisInput = z.infer<typeof startAnalysisSchema>;
