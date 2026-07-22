import type { FrameworkGenerator } from './types.js';
import { HonoGenerator } from './hono/index.js';
import { ExpressGenerator } from './express/index.js';
import { FastifyGenerator } from './fastify/index.js';
import { NextJsGenerator } from './nextjs/index.js';

export type { FrameworkGenerator, GeneratedFile, GeneratorOptions } from './types.js';

const generators: Map<string, FrameworkGenerator> = new Map();

function registerGenerator(generator: FrameworkGenerator): void {
  generators.set(generator.name, generator);
}

registerGenerator(new HonoGenerator());
registerGenerator(new ExpressGenerator());
registerGenerator(new FastifyGenerator());
registerGenerator(new NextJsGenerator());

export function getGenerator(name: string): FrameworkGenerator | undefined {
  return generators.get(name);
}

export function getAvailableFrameworks(): string[] {
  return Array.from(generators.keys());
}
