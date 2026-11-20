import { z } from 'zod';
export const courseSchema = z.object({
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(3000),
  category: z.enum(['Development', 'Design', 'Personal growth', 'Business', 'Data science']),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced', 'All levels']),
  price: z.number().int().min(0).max(100000),
  color: z.enum(['coral', 'mint', 'lilac', 'sand']).default('coral'),
});
export const lessonSchema = z.object({
  title: z.string().trim().min(3).max(120),
  content: z.string().max(20000).default(''),
  duration: z.number().int().min(1).max(600),
});
export const questionSchema = z
  .object({
    prompt: z.string().trim().min(5).max(500),
    options: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
    correct: z.number().int().min(0),
    explanation: z.string().max(1000).default(''),
  })
  .refine((q) => q.correct < q.options.length, 'Correct answer must be one of the options');
