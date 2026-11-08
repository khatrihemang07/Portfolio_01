import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.yaml", base: "./src/content/projects" }),
  schema: ({ image }) =>
    z.object({
      name: z.string().min(1),
      pitch: z.string().min(1),
      // Story tab: one to three short paragraphs.
      story: z.array(z.string().min(1)).min(1).max(3),
      // Features tab: three to six one-line bullets.
      features: z.array(z.string().min(1)).min(3).max(6),
      // Exactly four Facts, each with the real source it was checked against.
      facts: z
        .array(
          z.object({
            text: z.string().min(1),
            source: z.string().min(1),
          }),
        )
        .length(4),
      // Under the hood tab.
      hood: z.string().min(1),
      stack: z.string().min(1),
      repo: z.url(),
      download: z.url().optional(),
      // Gallery Slides: one picture, its alt text and a visible caption each.
      slides: z
        .array(
          z.object({
            image: image(),
            alt: z.string().min(1),
            caption: z.string().min(1),
          }),
        )
        .min(1)
        .max(5),
      order: z.number(),
    }),
});

export const collections = { projects };
