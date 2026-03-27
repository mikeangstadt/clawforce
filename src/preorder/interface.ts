/**
 * Pre-order system — places orders at businesses before dispatching a driver.
 *
 * Flow: Look up business → Place order online → Get confirmation → Dispatch pickup
 */

export interface OrderItem {
  name: string;            // e.g., "Double Cheeseburger"
  quantity: number;
  modifications?: string[];  // e.g., ["NO ONIONS"]
  size?: string;           // e.g., "large"
}

export interface PreOrderRequest {
  businessName: string;      // e.g., "P. Terry's"
  locationAddress: string;   // Resolved address of the specific location
  locationPhone: string;
  items: OrderItem[];
  specialInstructions?: string;
  pickupName: string;        // Name for the order (e.g., "Mike Angstadt")
  pickupPhone: string;
}

export interface PreOrderResult {
  success: boolean;
  orderConfirmation?: string;  // Confirmation number/ID
  estimatedReadyTime?: string; // ISO 8601
  totalCents?: number;
  error?: string;
  orderUrl?: string;          // URL to view/manage the order
  pickupInstructions?: string; // e.g., "Order will be at the pickup counter under name Mike"
}

/**
 * A PreOrderer knows how to place orders at a specific business or ordering platform.
 */
export interface PreOrderer {
  /** Name of this orderer (e.g., "pterrys", "toast", "square") */
  name: string;

  /** Check if this orderer can handle the given business */
  canHandle(businessName: string): boolean;

  /** Place the order and return confirmation details */
  placeOrder(request: PreOrderRequest): Promise<PreOrderResult>;
}
