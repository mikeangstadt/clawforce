import { chromium, type Browser, type Page } from 'playwright';
import type { PreOrderer, PreOrderRequest, PreOrderResult } from './interface.js';
import { logger } from '../util/logger.js';

/**
 * Known ordering platforms and their URL patterns.
 * Maps business name patterns to their online ordering URLs.
 */
const ORDERING_URLS: Record<string, string> = {
  "p. terry": "https://pterrys.olo.com",
  "p terry": "https://pterrys.olo.com",
  "pterrys": "https://pterrys.olo.com",
  "p.terry": "https://pterrys.olo.com",
};

export class WebOrderer implements PreOrderer {
  name = 'web-orderer';

  canHandle(businessName: string): boolean {
    const lower = businessName.toLowerCase().replace(/['']/g, '');
    return Object.keys(ORDERING_URLS).some(k => lower.includes(k));
  }

  async placeOrder(request: PreOrderRequest): Promise<PreOrderResult> {
    const lower = request.businessName.toLowerCase().replace(/['']/g, '');
    const urlKey = Object.keys(ORDERING_URLS).find(k => lower.includes(k));

    if (!urlKey) {
      return { success: false, error: `No ordering URL known for ${request.businessName}` };
    }

    const orderUrl = ORDERING_URLS[urlKey];

    logger.info({
      business: request.businessName,
      url: orderUrl,
      items: request.items.map(i => `${i.quantity}x ${i.name}`),
    }, 'Starting web order via Playwright');

    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({ headless: false }); // Visible so user can see/intervene
      const context = await browser.newContext();
      const page = await context.newPage();

      // Navigate to ordering site
      await page.goto(orderUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for Cloudflare challenge to pass
      await page.waitForURL(/pterrys\.olo\.com/, { timeout: 15000 }).catch(() => {});

      // Find and select the nearest location
      await this.selectLocation(page, request.locationAddress);

      // Add items to cart
      for (const item of request.items) {
        await this.addItem(page, item);
      }

      // Proceed to checkout
      await this.checkout(page, request);

      // Get confirmation
      const confirmation = await this.getConfirmation(page);

      await browser.close();

      return {
        success: true,
        orderConfirmation: confirmation.confirmationId,
        estimatedReadyTime: confirmation.readyTime,
        totalCents: confirmation.totalCents,
        pickupInstructions: `Order confirmed at ${request.businessName}. Confirmation: ${confirmation.confirmationId}. Pick up under name ${request.pickupName}.`,
      };
    } catch (err) {
      const error = (err as Error).message;
      logger.error({ error, business: request.businessName }, 'Web order failed');

      if (browser) {
        // Leave browser open so user can complete manually
        logger.info('Browser left open for manual completion. Close when done.');
      }

      return {
        success: false,
        error: `Automated ordering failed: ${error}. Browser left open for manual completion.`,
        orderUrl,
      };
    }
  }

  private async selectLocation(page: Page, address: string): Promise<void> {
    // Olo typically shows a location picker or list of stores
    // Look for the location that matches our address
    try {
      // Wait for store list to load
      await page.waitForSelector('[class*="location"], [class*="store"], [class*="restaurant"]', { timeout: 10000 });

      // Try to find address match or search box
      const searchInput = await page.$('input[type="search"], input[placeholder*="address"], input[placeholder*="location"], input[placeholder*="zip"]');
      if (searchInput) {
        // Extract zip from address
        const zipMatch = address.match(/\d{5}/);
        if (zipMatch) {
          await searchInput.fill(zipMatch[0]);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }
      }

      // Click the first/nearest location's order button
      const orderButton = await page.$('button:has-text("Order"), a:has-text("Order"), button:has-text("Start"), a:has-text("Start")');
      if (orderButton) {
        await orderButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Could not auto-select location, continuing...');
    }
  }

  private async addItem(page: Page, item: { name: string; quantity: number; modifications?: string[] }): Promise<void> {
    try {
      // Search for the menu item by name
      const menuItem = await page.$(`text=${item.name}`);
      if (menuItem) {
        await menuItem.click();
        await page.waitForTimeout(1000);

        // Handle modifications (like "NO ONIONS")
        if (item.modifications) {
          for (const mod of item.modifications) {
            const modElement = await page.$(`text=${mod.replace('NO ', '')}`);
            if (modElement) {
              await modElement.click(); // Toggle off
            }
          }
        }

        // Set quantity if > 1
        if (item.quantity > 1) {
          const qtyInput = await page.$('input[type="number"], [class*="quantity"] input');
          if (qtyInput) {
            await qtyInput.fill(String(item.quantity));
          }
        }

        // Add to cart
        const addButton = await page.$('button:has-text("Add to"), button:has-text("Add To"), button:has-text("Add Item")');
        if (addButton) {
          await addButton.click();
          await page.waitForTimeout(1000);
        }
      } else {
        logger.warn({ item: item.name }, 'Menu item not found on page');
      }
    } catch (err) {
      logger.warn({ item: item.name, error: (err as Error).message }, 'Could not add item');
    }
  }

  private async checkout(page: Page, request: PreOrderRequest): Promise<void> {
    try {
      // Click cart/checkout
      const cartButton = await page.$('button:has-text("Checkout"), button:has-text("Cart"), a:has-text("Checkout"), [class*="cart"]');
      if (cartButton) {
        await cartButton.click();
        await page.waitForTimeout(2000);
      }

      // Fill in pickup name
      const nameInput = await page.$('input[name*="name"], input[placeholder*="name"]');
      if (nameInput) {
        await nameInput.fill(request.pickupName);
      }

      // Fill in phone
      const phoneInput = await page.$('input[name*="phone"], input[placeholder*="phone"], input[type="tel"]');
      if (phoneInput) {
        await phoneInput.fill(request.pickupPhone);
      }

      // Note: payment requires user's stored card — pause here for manual completion
      logger.info('Checkout form filled. Waiting for user to complete payment...');

      // Wait for order confirmation page (user completes payment manually)
      await page.waitForURL(/confirm|receipt|thank/i, { timeout: 300000 }); // 5 min to pay

    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Checkout automation incomplete — user may need to finish manually');
      throw err;
    }
  }

  private async getConfirmation(page: Page): Promise<{
    confirmationId: string;
    readyTime?: string;
    totalCents?: number;
  }> {
    try {
      // Look for confirmation number on the page
      const pageText = await page.textContent('body') || '';

      const confirmMatch = pageText.match(/(?:order|confirmation)\s*(?:#|number|:)\s*(\w+)/i);
      const timeMatch = pageText.match(/(?:ready|pickup)\s*(?:at|by|time)?\s*:?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      const totalMatch = pageText.match(/(?:total)\s*:?\s*\$?([\d.]+)/i);

      return {
        confirmationId: confirmMatch?.[1] || 'unknown',
        readyTime: timeMatch?.[1],
        totalCents: totalMatch ? Math.round(parseFloat(totalMatch[1]) * 100) : undefined,
      };
    } catch {
      return { confirmationId: 'unknown' };
    }
  }
}
