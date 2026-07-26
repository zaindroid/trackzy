// Mirrors the RadarItem contract in the sourcing-portal repo:
// docs/RADAR_INGEST_CONTRACT.md. Keep in sync.
export interface RadarItem {
  id?: string;
  niche: string;
  productTitle: string;
  imageUrl?: string | null;
  ebaySoldCount?: number;
  salesPerDay?: number;
  ebayActiveCount?: number;
  sellThroughPercent?: number;
  ebayMedianSoldPriceCents?: number;
  aliexpressProductId?: string | null;
  aliexpressUrl?: string | null;
  aliexpressCostCents?: number | null;
  aliexpressRating?: number | null;
  aliexpressOrders?: number | null;
  sourceable?: boolean;
  supplierCheck?: 'ok' | 'pending' | 'none';
  marginCents?: number;
  marginPercent?: number;
  opportunityScore?: number;
}

/** eBay active-listing signal for one niche (from the Browse API). */
export interface EbayActiveSignal {
  activeCount: number;
  medianPriceCents: number;
  sampleTitle: string;
  sampleImageUrl?: string;
}

/** eBay confirmed-sold signal (optional — needs a sold-data source). */
export interface EbaySoldSignal {
  soldCount: number;
  salesPerDay: number;
  medianSoldPriceCents: number;
}

/** A matched supplier product (from AliExpress). */
export interface SupplierMatch {
  productId: string;
  url: string;
  costCents: number;
  rating?: number;
  orders?: number;
  imageUrl?: string;
}
