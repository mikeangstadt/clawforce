import type { TaskProvider, TaskType, ErrandCategory } from './interface.js';
import type { Target } from '../util/csv.js';
import { MockProvider } from './mock.js';
import { DoorDashProvider } from './doordash.js';
import { TaskRabbitProvider } from './taskrabbit.js';
import { UberDirectProvider } from './uber-direct.js';
import { FieldNationProvider } from './field-nation.js';
import { FavorProvider } from './favor.js';

const providers = new Map<string, TaskProvider>();

// Register all providers
function init(): void {
  if (providers.size > 0) return;

  const all: TaskProvider[] = [
    new MockProvider(),
    new DoorDashProvider(),
    new TaskRabbitProvider(),
    new UberDirectProvider(),
    new FieldNationProvider(),
    new FavorProvider(),
  ];

  for (const provider of all) {
    providers.set(provider.name, provider);
  }
}

export function getProvider(name: string): TaskProvider {
  init();
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Array.from(providers.keys()).join(', ')}`);
  }
  return provider;
}

export function getProvidersForTaskType(type: TaskType): TaskProvider[] {
  init();
  return Array.from(providers.values()).filter(p =>
    p.capabilities.taskTypes.includes(type)
  );
}

export interface ProviderPrefs {
  preferCheapest?: boolean;
  preferFastest?: boolean;
  excludeProviders?: string[];
  errandCategory?: ErrandCategory;
}

/**
 * Get providers that support a specific errand category.
 * Falls back to all errand/custom-capable providers if no category specified.
 */
export function getProvidersForErrand(category?: ErrandCategory): TaskProvider[] {
  init();
  const errandProviders = Array.from(providers.values()).filter(p =>
    p.capabilities.taskTypes.includes('errand') || p.capabilities.taskTypes.includes('custom')
  );

  if (!category) return errandProviders;

  return errandProviders.filter(p =>
    p.capabilities.errandCategories.includes(category)
  );
}

export function resolveProvider(type: TaskType, _target: Target, prefs?: ProviderPrefs): TaskProvider {
  init();
  let candidates: TaskProvider[];

  // For errand/custom types, use errand category routing if available
  if ((type === 'errand' || type === 'custom') && prefs?.errandCategory) {
    candidates = getProvidersForErrand(prefs.errandCategory)
      .filter(p => p.name !== 'mock');
  } else {
    candidates = getProvidersForTaskType(type)
      .filter(p => p.name !== 'mock');
  }

  if (prefs?.excludeProviders) {
    candidates = candidates.filter(p => !prefs.excludeProviders!.includes(p.name));
  }

  if (candidates.length === 0) {
    throw new Error(`No provider available for task type: ${type}${prefs?.errandCategory ? ` (category: ${prefs.errandCategory})` : ''}`);
  }

  if (prefs?.preferCheapest) {
    candidates.sort((a, b) =>
      a.capabilities.estimatedCostRange.minCents - b.capabilities.estimatedCostRange.minCents
    );
  }

  // For errands requiring judgment or multi-step, prefer providers with worker_rating
  if (prefs?.errandCategory && ['shopping', 'wait_in_line', 'multi_step', 'skilled_labor'].includes(prefs.errandCategory)) {
    const withRating = candidates.filter(p => p.capabilities.features.includes('worker_rating'));
    if (withRating.length > 0) {
      candidates = withRating;
    }
  }

  return candidates[0];
}

export interface ProviderSummary {
  name: string;
  taskTypes: TaskType[];
  errandCategories: ErrandCategory[];
  features: string[];
  coverage: { countries: string[]; excludedRegions?: string[] };
  estimatedCostRange: { minCents: number; maxCents: number };
  maxConcurrency: number;
  implemented: boolean;
}

export function listProviders(taskType?: TaskType): ProviderSummary[] {
  init();
  let all = Array.from(providers.values());
  if (taskType) {
    all = all.filter(p => p.capabilities.taskTypes.includes(taskType));
  }

  return all.map(p => ({
    name: p.name,
    taskTypes: p.capabilities.taskTypes,
    errandCategories: p.capabilities.errandCategories,
    features: p.capabilities.features,
    coverage: p.capabilities.coverage,
    estimatedCostRange: p.capabilities.estimatedCostRange,
    maxConcurrency: p.capabilities.maxConcurrency,
    implemented: !isStub(p),
  }));
}

function isStub(provider: TaskProvider): boolean {
  // Stubs throw with "not yet implemented" — check by attempting to detect stub providers
  return ['taskrabbit', 'uber-direct', 'field-nation', 'favor'].includes(provider.name);
}
