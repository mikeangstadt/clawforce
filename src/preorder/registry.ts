import type { PreOrderer, PreOrderRequest, PreOrderResult } from './interface.js';
import { WebOrderer } from './web-orderer.js';
import { logger } from '../util/logger.js';

const orderers: PreOrderer[] = [];

function init(): void {
  if (orderers.length > 0) return;
  orderers.push(new WebOrderer());
}

/**
 * Find a pre-orderer that can handle the given business.
 */
export function findOrderer(businessName: string): PreOrderer | null {
  init();
  return orderers.find(o => o.canHandle(businessName)) || null;
}

/**
 * Attempt to pre-order from a business. Returns null if no orderer can handle it.
 */
export async function preOrder(request: PreOrderRequest): Promise<PreOrderResult | null> {
  init();
  const orderer = findOrderer(request.businessName);

  if (!orderer) {
    logger.info({ business: request.businessName }, 'No pre-orderer available for this business');
    return null;
  }

  logger.info({
    business: request.businessName,
    orderer: orderer.name,
    items: request.items.length,
  }, 'Placing pre-order');

  return orderer.placeOrder(request);
}
