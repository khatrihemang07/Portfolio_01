import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.yaml", base: "./src/content/projects" }),
  schema: ({ image }) =>
    z.object({
      name: z.string().min(1),
      pitch: z.string().min(1),
      body: z.string().min(1),
      facts: z
        .array(
          z.object({
            text: z.string().min(1),
            source: z.string().min(1),
          }),
        )
        .length(2),
      stack: z.string().min(1),
      repo: z.url(),
      download: z.url().optional(),
      image: image(),
      alt: z.string().min(1),
      order: z.number(),
    }),
});

export const collections = { projects };
